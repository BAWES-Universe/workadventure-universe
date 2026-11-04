/**
 * MCPConnector - Connects bots to MCP (Model Context Protocol) servers
 *
 * Discovers and executes MCP tools for bots, with caching and graceful degradation.
 *
 * Streamable HTTP transport:
 * - tools/list: POST {jsonrpc, method: "tools/list"} to server URL
 * - tools/call: POST {jsonrpc, method: "tools/call", params: {name, arguments}}
 * - Auth: Bearer token or X-API-Key header
 */

import axios from 'axios';
import * as Sentry from '@sentry/node';
import { decryptApiKey } from '../ai/encryption';
import { linkExternalAbort } from '../ai/providers/abortUtils';
import { checkOutboundUrl, guardedLookup } from './outboundGuard';
import {
    MAX_TOOLS_PER_SERVER,
    fingerprintTool,
    keptTools,
    syncCatalog,
    toRawTool,
    type RawTool,
    type SyncResult,
    type ToolListCut,
    type ToolSuggester,
} from './ToolCatalog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
    id: string;
    botId: string;
    name: string;
    serverUrl: string;
    authType: 'none' | 'bearer' | 'api-key' | 'oauth';
    authConfig?: string; // Decrypted auth value (plaintext at this point)
    headers?: Record<string, string>; // Extra headers
    enabled: boolean;
    /** An old server whose tools were never checked: it keeps working in text as it did (#738). */
    notCheckedYet?: boolean;
    policyRevision?: number;
}

export interface McpToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}

interface CachedTools {
    tools: McpToolDefinition[];
    /** Each tool's readable title from tools/list (MCP `title`, or `annotations.title`), by tool name. */
    titles: Record<string, string>;
    /** Every tool as the server listed it (labels and inputs included), for its fingerprint and its heading (#1654). */
    raw: RawTool[];
    cachedAt: number;
    serverId: string;
}

/** Where a tool lives, for routing a call to it and for telling whether it is the tool a person confirmed. */
export interface ToolServerEntry {
    serverId: string;
    serverUrl: string;
    authType: string;
    authConfig?: string;
    headers?: Record<string, string>;
    /** The tool server's own readable name for the tool, when it gave one (shown in the steps line). */
    title?: string;
    /** The server's name in Orbit, for a card that says whose account a tool uses (#1656). */
    serverName?: string;
    /** What the tool is right now: its definition, the server's address and the account it uses (#1654). */
    fingerprint?: string;
    /** The tool's inputs as the server described them, for showing the details of a call on a card in their order (#1657). */
    inputSchema?: unknown;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const toolListCache = new Map<string, CachedTools>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
export const REQUEST_TIMEOUT = 90_000; // 90 seconds
/**
 * A server's list is read page by page; this many pages at most (#1654). Only a guard against a server that never stops
 * (or whose cursor loops): servers page at 50 to 100 tools, so 20 pages is 1,000 to 2,000 tools, well past the 500 that
 * are kept (MAX_TOOLS_PER_SERVER), which leaves room to count a server that has somewhat more. A server that still has
 * pages left after these is reported as cut, with no count.
 */
const MAX_TOOL_PAGES = 20;

/** Bounds for a bot's own tool-call timeout ("Patience"), matching Orbit's validation. */
export const MIN_TOOL_TIMEOUT_SECONDS = 5;
export const MAX_TOOL_TIMEOUT_SECONDS = 600;

/**
 * A bot's saved tool timeout ("Patience", in seconds) as milliseconds for
 * executeToolCall. Unset or invalid values return undefined, so the default
 * REQUEST_TIMEOUT applies; out-of-range values are clamped.
 */
export function toolTimeoutMs(seconds: number | null | undefined): number | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
    const clamped = Math.min(MAX_TOOL_TIMEOUT_SECONDS, Math.max(MIN_TOOL_TIMEOUT_SECONDS, Math.round(seconds)));
    return clamped * 1000;
}

// Cache of initialized MCP sessions per (server URL + auth context).
// Includes auth type/config in the key so bots with different credentials
// on the same URL don't share sessions.
const SESSION_INIT_TTL = 60 * 60 * 1000; // 1 hour
interface SessionEntry {
    sessionId?: string;
    initializedAt: number;
}
const mcpSessionInitCache = new Map<string, SessionEntry>();

function sessionCacheKey(serverUrl: string, authType: string, authConfig?: string, playerUuid?: string): string {
    return `${serverUrl}|${authType}|${authConfig || ''}|${playerUuid || ''}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build proper auth headers based on server config.
 */
function buildAuthHeaders(
    authType: string,
    authConfig?: string,
    extraHeaders?: Record<string, string>
): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    };

    if (authConfig) {
        if (authType === 'bearer') {
            headers['Authorization'] = `Bearer ${authConfig}`;
        } else if (authType === 'api-key') {
            headers['X-API-Key'] = authConfig;
        } else if (authType === 'oauth') {
            // OAuth authConfig is a JSON string with { accessToken, ... }
            try {
                const oauthConfig = JSON.parse(authConfig);
                if (oauthConfig.accessToken) {
                    headers['Authorization'] = `Bearer ${oauthConfig.accessToken}`;
                }
            } catch {
                console.warn('[MCPConnector] Failed to parse OAuth authConfig JSON');
            }
        }
    }

    // Merge extra headers (overrides any defaults with same key)
    if (extraHeaders) {
        for (const [key, value] of Object.entries(extraHeaders)) {
            headers[key] = value;
        }
    }

    return headers;
}

/**
 * Parse an MCP response, handling both standard JSON and SSE (Streamable HTTP).
 *
 * A stream may carry other messages before the answer (log or progress notices), so the answer is the message that
 * replies to `requestId`; failing that, the first message with a result or an error; failing that, the first one.
 */
function parseMcpResponse(response: any, requestId?: string): any {
    const contentType = response.headers?.['content-type'] || '';
    const data = response.data;

    if (
        contentType.includes('text/event-stream') ||
        (typeof data === 'string' && (data.trimStart().startsWith('event:') || data.trimStart().startsWith('data:')))
    ) {
        // Streams may end their lines with \r\n; a blank line separates messages either way
        const text = (typeof data === 'string' ? data : String(data)).replace(/\r\n?/g, '\n');
        const parsedMessages: any[] = [];
        for (const msg of text.split('\n\n')) {
            const dataLines: string[] = [];
            for (const line of msg.trim().split('\n')) {
                if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).replace(/^ /, ''));
                }
            }
            if (dataLines.length > 0) {
                try {
                    parsedMessages.push(JSON.parse(dataLines.join('\n')));
                } catch {
                    continue;
                }
            }
        }
        const isAnswer = (m: any) => m && typeof m === 'object' && ('result' in m || 'error' in m);
        const answer =
            (requestId !== undefined ? parsedMessages.find((m) => isAnswer(m) && String(m.id) === requestId) : undefined) ??
            parsedMessages.find(isAnswer) ??
            parsedMessages[0];
        if (answer !== undefined) {
            // The server may say, along the way, that its tools changed (#1654)
            const listChanged = parsedMessages.some((m) => m && typeof m === 'object' && m.method === 'notifications/tools/list_changed');
            return { data: answer, headers: response.headers, status: response.status, ...(listChanged ? { listChanged } : {}) };
        }
        return response; // fallback to raw
    }

    return response;
}

// Connection errors raised before a single byte of the request went out
const NEVER_CONNECTED_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

/**
 * Whether a failed request provably never ran on the server, so sending it
 * again cannot run it twice: the connection was never made, or the server
 * answered 404 to our session id, which the MCP spec reserves for "session
 * not found" (the request was not processed). Anything else, a 5xx, a reset
 * connection or a timeout, may have run.
 */
function requestNeverRan(error: any, sentSessionId: boolean): boolean {
    const status = error?.response?.status;
    if (status !== undefined) return status === 404 && sentSessionId;
    return NEVER_CONNECTED_CODES.has(error?.code);
}

interface JsonRpcOutcome {
    /** The response, or null on failure */
    data: any;
    /** The request failed and provably never ran on the server (see requestNeverRan) */
    neverRan: boolean;
    /** It never ran, and for a reason a second try may get past */
    retryable: boolean;
    /** The server said, in its answer, that its list of tools changed */
    listChanged?: boolean;
}

/** Sent, or maybe sent, with no answer: the server may have run it */
const NOT_ANSWERED: JsonRpcOutcome = { data: null, neverRan: false, retryable: false };
/** Stopped before anything was sent, for a reason a second try would meet again */
const NOT_SENT: JsonRpcOutcome = { data: null, neverRan: true, retryable: false };

/**
 * What became of a tool call that brought back no result: never ran (safe to
 * try again), ran and failed (the server said so), or unknown (it may have run).
 */
export type ToolCallOutcome = 'not_sent' | 'failed' | 'uncertain';

/**
 * What a call that brought back no result reads as (#1692). The error is the short note the steps line shows under the
 * call, so it stays under about 30 characters; the hint tells the bot what that means for trying again. Only a call
 * that provably never reached the server is safe to send again.
 */
const NOT_SENT_ERROR = "Couldn't reach it. Nothing ran";
const NOT_SENT_HINT = 'The call never reached the tool server, so nothing was done. Trying again is safe.';
const NO_ANSWER_ERROR = 'No answer. May have finished';
const EMPTY_ANSWER_ERROR = 'Empty answer. May have finished';
const MAY_HAVE_RUN_HINT =
    'The call reached the tool server but no answer came back. It may have run. Do not call this tool again in this ' +
    'reply. Tell the person it may have worked and to check before asking again.';

/**
 * Execute a JSON-RPC request to an MCP server with timeout and error handling.
 * Never throws — returns the response data or null on failure.
 *
 * `timeoutMs` is how long the caller waits in total, including any session
 * initialize this call has to wait for (a bot's "Patience" for tool calls).
 * Without it, the initialize and the request each get REQUEST_TIMEOUT.
 */
async function jsonRpcRequest(...args: Parameters<typeof sendJsonRpc>): Promise<any> {
    return (await sendJsonRpc(...args)).data;
}

/** jsonRpcRequest, also telling whether a failed request never ran */
async function sendJsonRpc(
    serverUrl: string,
    method: string,
    params: Record<string, any> | undefined,
    authType: string,
    authConfig?: string,
    extraHeaders?: Record<string, string>,
    playerUuid?: string,
    signal?: AbortSignal,
    timeoutMs?: number
): Promise<JsonRpcOutcome> {
    const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
    const remaining = () => (deadline !== undefined ? Math.max(0, deadline - Date.now()) : REQUEST_TIMEOUT);
    // Checked before every request, DNS included: the name may point somewhere else than when it was saved
    const urlCheck = await checkOutboundUrl(serverUrl);
    if (!urlCheck.allowed) {
        console.warn(`[MCPConnector] Invalid server URL for ${method}: ${urlCheck.error}`);
        // Nothing was sent; a name that did not resolve may resolve on a second try
        return { data: null, neverRan: true, retryable: urlCheck.unresolved === true };
    }

    const baseHeaders = buildAuthHeaders(authType, authConfig, extraHeaders);

    // Auto-initialize MCP session (required by MCP Streamable HTTP spec).
    // Some servers (like Linear) tolerate tools/list without initialize,
    // but spec-compliant servers (like Brick) require it.
    // Cache sessions per server URL + playerUuid so each player gets their
    // own session with the correct player_id in clientInfo.
    // When playerUuid is empty (tools/list during discovery), we still init
    // for spec compliance but skip caching — the generic session will never
    // be reused by a per-player tool call with a different cache key.
    let sessionId: string | undefined;
    const skipSessionCache = !playerUuid;
    if (method !== 'initialize') {
        const cachedSession = mcpSessionInitCache.get(sessionCacheKey(serverUrl, authType, authConfig, playerUuid));
        if (cachedSession && Date.now() < cachedSession.initializedAt + SESSION_INIT_TTL) {
            // Reuse cached session without redundant init
            if (cachedSession.sessionId) {
                sessionId = cachedSession.sessionId;
            }
        } else {
            const initController = new AbortController();
            // The initialize request itself gets at least the default timeout,
            // even when the caller is less patient: it runs detached and its
            // session-cache update helps the next call.
            const initTimeoutId = setTimeout(() => initController.abort(), Math.max(REQUEST_TIMEOUT, timeoutMs ?? 0));

            // Run initialize as a detached task. The MCP spec forbids
            // cancelling initialize ("The initialize request MUST NOT be
            // cancelled") and its session-cache update must land even if the
            // caller gives up — so the request itself is never aborted by the
            // caller's signal; we only race our wait against it so a cancelled
            // turn returns promptly instead of blocking on a slow init (cold
            // ComfyUI start, dead server, etc.).
            const initPromise = (async () => {
                try {
                    const initResponse = await axios.post(
                        serverUrl,
                        {
                            jsonrpc: '2.0',
                            id: 'init',
                            method: 'initialize',
                            params: {
                                protocolVersion: '2024-11-05',
                                capabilities: {},
                                clientInfo: {
                                    name: 'workadventure-mcp-bot',
                                    version: '1.0.0',
                                    player_id: playerUuid || null,
                                },
                            },
                        },
                        {
                            headers: baseHeaders,
                            signal: initController.signal,
                            // A redirect's target is never checked, so none is followed
                            maxRedirects: 0,
                            // The connection goes only to an address that passes the same check
                            lookup: guardedLookup,
                        }
                    );
                    const parsed = parseMcpResponse(initResponse, 'init');
                    // Per MCP Streamable HTTP spec, session ID is transmitted in the
                    // Mcp-Session-Id HTTP response header, not in the JSON body.
                    // Check header first, then fall back to body for non-spec servers.
                    const sessionFromHeader = initResponse.headers?.['mcp-session-id'];
                    const sessionFromBody = parsed?.data?.result?.sessionId;
                    const newSessionId = sessionFromHeader || sessionFromBody;
                    if (newSessionId) {
                        sessionId = newSessionId;
                    }
                    // Cache the result so subsequent calls skip init revalidation
                    if (!skipSessionCache) {
                        mcpSessionInitCache.set(sessionCacheKey(serverUrl, authType, authConfig, playerUuid), {
                            sessionId: newSessionId || undefined,
                            initializedAt: Date.now(),
                        });
                    }
                } catch {
                    // Init timed out or failed: nothing is cached, so the next call initializes again
                } finally {
                    clearTimeout(initTimeoutId);
                }
            })();

            // Race the init against caller cancellation and the caller's
            // deadline, so a cancelled turn or a short Patience returns
            // promptly, without aborting the initialize request.
            let cleanupAbortListener: (() => void) | undefined;
            let initWaitTimer: ReturnType<typeof setTimeout> | undefined;
            const abortPromise = new Promise<'cancelled'>((resolve) => {
                if (!signal) return;
                if (signal.aborted) {
                    resolve('cancelled');
                    return;
                }
                const onAbort = () => resolve('cancelled');
                signal.addEventListener('abort', onAbort, { once: true });
                cleanupAbortListener = () => signal.removeEventListener('abort', onAbort);
            });
            const deadlinePromise = new Promise<'timeout'>((resolve) => {
                if (deadline === undefined) return;
                initWaitTimer = setTimeout(() => resolve('timeout'), remaining());
            });
            const initDone = initPromise.then(() => 'done' as const);
            const outcome = await Promise.race([initDone, abortPromise, deadlinePromise]);
            cleanupAbortListener?.();
            clearTimeout(initWaitTimer);
            if (outcome === 'cancelled') {
                console.log(`[MCPConnector] Request cancelled for ${method} (during initialize)`);
                return NOT_SENT;
            }
            if (outcome === 'timeout') {
                console.warn(`[MCPConnector] Request timed out after ${timeoutMs}ms for ${method} (during initialize)`);
                return NOT_SENT;
            }
        }
    }

    const headers = { ...baseHeaders };
    if (sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
    }

    const controller = new AbortController();
    const requestTimeout = remaining();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);
    // Link an external abort (e.g. the conversation's per-turn AbortController
    // from the interruption/cancel feature) to this request so cancelling the
    // turn also cancels in-flight MCP tool calls instead of letting them hang
    // for the full 90s timeout. Per the MCP Streamable HTTP spec, closing the
    // HTTP response stream IS the cancellation signal for this transport, so
    // aborting the axios request is exactly the spec-compliant behaviour.
    // Deliberately NOT linked to the initialize request above — the spec
    // forbids cancelling initialize ("The initialize request MUST NOT be
    // cancelled"), and a cancelled init would leave the session in an
    // undefined state.
    const unlinkExternalAbort = linkExternalAbort(signal, controller);

    try {
        const requestId = method === 'tools/list' ? '1' : '2';
        const body: Record<string, any> = {
            jsonrpc: '2.0',
            id: requestId,
            method,
        };
        if (params !== undefined) {
            body.params = params;
        }

        const response = await axios.post(serverUrl, body, {
            headers,
            signal: controller.signal,
            maxRedirects: 0,
            lookup: guardedLookup,
        });

        const parsed = parseMcpResponse(response, requestId);
        return { data: parsed.data, neverRan: false, retryable: false, ...(parsed.listChanged ? { listChanged: true } : {}) };
    } catch (error: any) {
        if (axios.isCancel(error)) {
            if (signal?.aborted) {
                // Cancelled by the caller (turn aborted), not by the timeout.
                // Distinguishable from a timeout so operators don't chase a
                // 90s-timeout warning on every cancelled turn.
                console.log(`[MCPConnector] Request cancelled for ${method}`);
            } else {
                console.warn(`[MCPConnector] Request timed out after ${timeoutMs ?? REQUEST_TIMEOUT}ms for ${method}`);
            }
        } else if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const detail = error.response?.data
                ? typeof error.response.data === 'string'
                    ? error.response.data.slice(0, 200)
                    : JSON.stringify(error.response.data).slice(0, 200)
                : error.message;
            const sanitizedUrl = (() => {
                try {
                    const u = new URL(serverUrl);
                    return `${u.protocol}//${u.host}${u.pathname}`;
                } catch {
                    return '(invalid url)';
                }
            })();
            console.warn(
                `[MCPConnector] HTTP ${status || 'error'} on ${method} at ${sanitizedUrl}: ${detail}`
            );
            Sentry.captureException(new Error(`MCPConnector HTTP ${status || 'error'} on ${method}`));
            // Invalidate session cache on HTTP errors for non-initialize methods.
            // Handles server restarts, session expiry, and stale session reuse
            // after bot respawn — without this, a dead session is retried for up
            // to 1 hour (SESSION_INIT_TTL).
            if (method !== 'initialize') {
                mcpSessionInitCache.delete(sessionCacheKey(serverUrl, authType, authConfig, playerUuid));
            }
            const neverRan = requestNeverRan(error, sessionId !== undefined);
            return { data: null, neverRan, retryable: neverRan };
        } else {
            console.warn(`[MCPConnector] Error on ${method}: ${error.message || error}`);
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        }
        return NOT_ANSWERED;
    } finally {
        clearTimeout(timeoutId);
        unlinkExternalAbort();
    }
}

// ---------------------------------------------------------------------------
// MCPConnector
// ---------------------------------------------------------------------------

export class MCPConnector {
    /**
     * Discover MCP tools for a given bot from all enabled MCP servers.
     *
     * 1. Fetches MCP server configs from the admin API at:
     *    `${adminApiUrl}/api/bots/${botId}/mcp-servers`
     * 2. For each enabled server, calls tools/list via Streamable HTTP.
     * 3. Caches results with 1h TTL.
     * 4. Graceful degradation: unreachable servers return empty tool list.
     */
    static async discoverTools(
        botId: string,
        adminApiUrl: string,
        adminApiToken: string,
        botServiceToken: string
    ): Promise<McpToolDefinition[]> {
        const { tools } = await this.discoverToolsWithMapping(
            botId,
            adminApiUrl,
            adminApiToken,
            botServiceToken
        );
        return tools;
    }

    /**
     * The bot's MCP server configs from the admin API, with their credentials decrypted. Empty when the bot has none; throws
     * when Orbit can't be asked (the caller decides what that means).
     */
    private static async loadServers(botId: string, adminApiUrl: string, adminApiToken: string): Promise<McpServerConfig[]> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        let servers: McpServerConfig[] = [];
        try {
            const response = await axios.get(`${adminApiUrl}/api/bots/${botId}/mcp-servers`, {
                headers: {
                    Authorization: `Bearer ${adminApiToken}`,
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });
            servers = response.data || [];
        } finally {
            clearTimeout(timeoutId);
        }

        // Decrypt authConfig for each server (admin API stores it encrypted)
        for (const server of servers) {
            if (server.authConfig) {
                try {
                    server.authConfig = decryptApiKey(server.authConfig) || undefined;
                } catch (e) {
                    console.warn(
                        `[MCPConnector] Failed to decrypt authConfig for server ${server.name} (${server.id}):`,
                        e
                    );
                    server.authConfig = undefined;
                }
            }
        }
        return servers;
    }

    /**
     * Every tool a server lists, page after page (`nextCursor`), as the server gave them, and no more than are kept
     * (MAX_TOOLS_PER_SERVER): the list the model gets is the list Orbit saves. When the server has more, `cut` says so, with
     * how many it has when every page was read (null when pages were left, so there was no count to give); a server with
     * exactly as many as are kept is not cut. Null when any page brings nothing usable: a half-read list is never kept or
     * saved to Orbit as if it were the whole one, so the tools of the pages that were not read can't look removed or
     * unconfirmed. The next read tries again.
     */
    private static async listAllTools(server: McpServerConfig): Promise<{ tools: RawTool[]; cut: ToolListCut | null } | null> {
        const all: RawTool[] = [];
        let cursor: string | undefined;
        let moreLeft = false;
        for (let page = 0; page < MAX_TOOL_PAGES; page++) {
            const response = await jsonRpcRequest(
                server.serverUrl,
                'tools/list',
                cursor ? { cursor } : undefined,
                server.authType,
                server.authConfig,
                server.headers
            );
            if (!response || !response.result || !Array.isArray(response.result.tools)) {
                return null;
            }
            for (const item of response.result.tools) {
                const tool = toRawTool(item);
                if (tool) all.push(tool);
            }
            const next = response.result.nextCursor;
            moreLeft = typeof next === 'string' && !!next && next !== cursor;
            if (!moreLeft) break;
            cursor = next;
        }
        const tools = keptTools(all);
        const total = new Set(all.map((tool) => tool.name)).size;
        const cut: ToolListCut | null = moreLeft ? { total: null } : total > MAX_TOOLS_PER_SERVER ? { total } : null;
        return { tools, cut };
    }

    /** A tool list as the model gets it, with the readable titles the servers gave. */
    private static toDefinitions(raw: readonly RawTool[]): { tools: McpToolDefinition[]; titles: Record<string, string> } {
        const titles: Record<string, string> = {};
        const tools = raw.map(
            (tool): McpToolDefinition => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description || '',
                    parameters: (tool.inputSchema as Record<string, any>) || {},
                },
            })
        );
        for (const tool of raw) if (tool.title) titles[tool.name] = tool.title;
        return { tools, titles };
    }

    /**
     * Discover MCP tools AND build a tool-name → server-config mapping.
     *
     * Returns both the tool definitions and a map that can be used to route
     * tool calls to the correct MCP server at execution time. Each entry also carries the tool's fingerprint (#1654), so a
     * call can be checked against the tool a person confirmed.
     *
     * Whenever a server's list is read fresh, it is also saved to Orbit with a suggested heading per tool, without making
     * the caller wait for it (`options.suggest` is the small model for tools the server's labels leave open).
     */
    static async discoverToolsWithMapping(
        botId: string,
        adminApiUrl: string,
        adminApiToken: string,
        botServiceToken: string,
        options: { suggest?: ToolSuggester } = {}
    ): Promise<{
        tools: McpToolDefinition[];
        toolServerMap: Map<string, ToolServerEntry>;
    }> {
        void botServiceToken;
        const toolServerMap = new Map<string, ToolServerEntry>();

        // Fetch MCP server configs from admin API
        let servers: McpServerConfig[] = [];
        try {
            servers = await this.loadServers(botId, adminApiUrl, adminApiToken);
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                // No MCP servers configured — not an error
                console.log(`[MCPConnector] No MCP servers configured for bot ${botId}`);
            } else {
                console.warn(
                    `[MCPConnector] Failed to fetch MCP server configs for bot ${botId}:`,
                    error.message || error
                );
                Sentry.captureException(
                    error instanceof Error ? error : new Error(String(error))
                );
            }
            return { tools: [], toolServerMap };
        }

        // Query each enabled server and collect tools
        const allTools: McpToolDefinition[] = [];
        const enabledServers = servers.filter((s) => s.enabled);

        // Track seen tool names across all servers to avoid duplicates
        const seenToolNames = new Set<string>();

        // Helper to push a tool def only if its name is unique
        function addUniqueTool(tool: McpToolDefinition, server: McpServerConfig, title: string | undefined, raw: RawTool | undefined) {
            if (!seenToolNames.has(tool.function.name)) {
                seenToolNames.add(tool.function.name);
                allTools.push(tool);
                toolServerMap.set(tool.function.name, {
                    serverId: server.id,
                    serverUrl: server.serverUrl,
                    authType: server.authType,
                    authConfig: server.authConfig,
                    headers: server.headers,
                    serverName: server.name,
                    ...(raw ? { fingerprint: fingerprintTool(raw, server) } : {}),
                    ...(raw?.inputSchema !== undefined ? { inputSchema: raw.inputSchema } : {}),
                    ...(title ? { title } : {}),
                });
            }
        }

        // Process all servers concurrently with a concurrency cap
        async function discoverServerTools(
            server: McpServerConfig
        ): Promise<void> {
            const cacheKey = `${botId}:${server.id}`;
            const cached = toolListCache.get(cacheKey);

            if (cached && Date.now() < cached.cachedAt + CACHE_TTL) {
                const rawByName = new Map(cached.raw.map((tool) => [tool.name, tool]));
                for (const tool of cached.tools) {
                    addUniqueTool(tool, server, cached.titles[tool.function.name], rawByName.get(tool.function.name));
                }
                return;
            }

            const read = await MCPConnector.listAllTools(server);

            if (read) {
                const raw = read.tools;
                const { tools: toolDefs, titles } = MCPConnector.toDefinitions(raw);

                // Cache the result
                toolListCache.set(cacheKey, {
                    tools: toolDefs,
                    titles,
                    raw,
                    cachedAt: Date.now(),
                    serverId: server.id,
                });

                const rawByName = new Map(raw.map((tool) => [tool.name, tool]));
                for (const toolDef of toolDefs) {
                    addUniqueTool(toolDef, server, titles[toolDef.function.name], rawByName.get(toolDef.function.name));
                }
                const cachedAt = toolListCache.get(cacheKey)?.cachedAt;
                void MCPConnector.saveListToOrbit(botId, server, raw, { adminApiUrl, adminApiToken }, options.suggest, read.cut).then((outcome) => {
                    // Orbit did not get the list: forget it here too, so the next read tries to save it again (not in an hour)
                    if (outcome.result === 'skipped' && toolListCache.get(cacheKey)?.cachedAt === cachedAt) toolListCache.delete(cacheKey);
                });
            } else {
                console.warn(
                    `[MCPConnector] Server ${server.name} (${server.id}) returned no tools or invalid response`
                );
            }
        }

        // Run all server discovery tasks concurrently
        const results = await Promise.allSettled(
            enabledServers.map((server) => discoverServerTools(server))
        );
        for (const result of results) {
            if (result.status === 'rejected') {
                console.warn(
                    `[MCPConnector] Server discovery failed: ${result.reason?.message || result.reason}`
                );
            }
        }

        return { tools: allTools, toolServerMap };
    }

    /** Saves one server's list to Orbit in the background. A failure is logged; Orbit keeps what it had. */
    private static saveListToOrbit(
        botId: string,
        server: McpServerConfig,
        raw: readonly RawTool[],
        orbit: { adminApiUrl: string; adminApiToken: string },
        ask?: ToolSuggester,
        cut?: ToolListCut | null
    ): Promise<SyncResult> {
        return syncCatalog({ orbit, botId, serverId: server.id, server, raw, cut, ask }).then((outcome) => {
            if (outcome.result === 'skipped') console.warn(`[MCPConnector] Tool list of ${server.name} (${server.id}) not saved: ${outcome.reason}`);
            else if (outcome.result === 'saved' && outcome.saved.changed.length > 0) {
                console.log(`[MCPConnector] ${outcome.saved.changed.length} tool(s) of ${server.name} changed and wait to be confirmed again`);
            }
            return outcome;
        });
    }

    /**
     * Reads one server's whole tool list now (not from the cache), keeps it for the bot, and saves it to Orbit with suggested
     * headings. For connecting a server and Test server (#1654). Resolves with how it went; null when the bot has no such server.
     */
    static async refreshServerTools(
        botId: string,
        serverId: string,
        adminApiUrl: string,
        adminApiToken: string,
        suggest?: ToolSuggester
    ): Promise<{ read: false; reason: string } | { read: true; tools: number; saved: SyncResult } | null> {
        const server = (await this.loadServers(botId, adminApiUrl, adminApiToken)).find((candidate) => candidate.id === serverId);
        if (!server) return null;
        const read = await this.listAllTools(server);
        if (!read) return { read: false, reason: 'The server did not answer with a list of tools' };
        const raw = read.tools;
        const { tools, titles } = this.toDefinitions(raw);
        toolListCache.set(`${botId}:${server.id}`, { tools, titles, raw, cachedAt: Date.now(), serverId: server.id });
        const saved = await this.saveListToOrbit(botId, server, raw, { adminApiUrl, adminApiToken }, suggest, read.cut);
        // Orbit did not get it: the next read tries to save it again
        if (saved.result === 'skipped') toolListCache.delete(`${botId}:${server.id}`);
        return { read: true, tools: raw.length, saved };
    }

    /**
     * Execute a tool call on an MCP server.
     *
     * Posts tools/call via JSON-RPC, returns result.content array on success,
     * or an error object on failure. Never throws.
     */
    static async executeToolCall(
        serverId: string,
        serverUrl: string,
        toolName: string,
        args: any,
        authType: string,
        authConfig?: string,
        extraHeaders?: Record<string, string>,
        playerUuid?: string,
        signal?: AbortSignal,
        timeoutMs?: number
    ): Promise<any> {
        // Patience covers the whole call, the retry below included
        const deadline = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
        let attempt = await sendJsonRpc(
            serverUrl,
            'tools/call',
            { name: toolName, arguments: args },
            authType,
            authConfig,
            extraHeaders,
            playerUuid,
            signal,
            timeoutMs
        );
        let response = attempt.data;
        if (attempt.listChanged) MCPConnector.forgetServerList(serverId);

        if (!response) {
            // Send the call again only when it provably never ran (never
            // connected, or the server dropped our stale session): a server
            // that answered 5xx, reset the connection or timed out may have
            // done the work already, and a second send would do it twice.
            // The failed call dropped the cached session, so the retry
            // initializes a fresh one. A cancelled turn never retries.
            // With a Patience, the retry only gets the time that is left of it.
            const retryTimeoutMs = deadline !== undefined ? deadline - Date.now() : undefined;
            if (attempt.retryable && !signal?.aborted && (retryTimeoutMs === undefined || retryTimeoutMs > 0)) {
                attempt = await sendJsonRpc(
                serverUrl,
                'tools/call',
                { name: toolName, arguments: args },
                authType,
                authConfig,
                extraHeaders,
                playerUuid,
                signal,
                retryTimeoutMs
                );
                response = attempt.data;
            }
        }

        if (!response) {
            // A call that went out and got no answer may have run: say so, so nothing takes it as never sent
            const outcome: ToolCallOutcome = attempt.neverRan ? 'not_sent' : 'uncertain';
            if (signal?.aborted) {
                // Turn was cancelled while the tool call was in flight. Return
                // a distinct marker so callers can tell a cancellation apart
                // from a genuinely unreachable server.
                return { error: `Tool call cancelled: ${toolName}`, outcome, cancelled: true };
            }
            return outcome === 'not_sent'
                ? { error: NOT_SENT_ERROR, outcome, hint: NOT_SENT_HINT }
                : { error: NO_ANSWER_ERROR, outcome, hint: MAY_HAVE_RUN_HINT };
        }

        if (response.error) {
            const errMsg = response.error.message || JSON.stringify(response.error);
            console.warn(`[MCPConnector] Tool ${toolName} returned error: ${errMsg}`);
            return { error: `Tool error: ${errMsg}`, outcome: 'failed' satisfies ToolCallOutcome };
        }

        // A tool that ran but failed answers with isError and its reason as content: an error like the ones above
        if (response.result?.isError === true) {
            const content: any[] = Array.isArray(response.result.content) ? response.result.content : [];
            const why = content
                .filter((item) => item?.type === 'text' && typeof item.text === 'string')
                .map((item) => item.text)
                .join(' ')
                .trim();
            console.warn(`[MCPConnector] Tool ${toolName} failed: ${why || 'no reason given'}`);
            return { error: `Tool error: ${why || `${toolName} failed`}`, outcome: 'failed' satisfies ToolCallOutcome };
        }

        if (response.result && Array.isArray(response.result.content)) {
            const content: any[] = response.result.content;
            // A tool may answer with data only in structuredContent (a server SHOULD also put it in a text item): give
            // the bot that data as text when no text item carries it (#1566)
            const structured = response.result.structuredContent;
            const hasText = content.some((item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim());
            if (structured !== undefined && structured !== null && !hasText) {
                return [...content, { type: 'text', text: typeof structured === 'string' ? structured : JSON.stringify(structured) }];
            }
            return content;
        }

        if (response.result !== undefined) {
            return response.result;
        }

        // An answer that is neither a result nor an error proves nothing about what the server did
        return { error: EMPTY_ANSWER_ERROR, outcome: 'uncertain' satisfies ToolCallOutcome, hint: MAY_HAVE_RUN_HINT };
    }

    /** A server said its tools changed: the next read of any bot's list for it comes from the server and is saved again. */
    static forgetServerList(serverId: string): void {
        for (const key of toolListCache.keys()) {
            if (key.endsWith(`:${serverId}`)) toolListCache.delete(key);
        }
    }

    /**
     * Clear the cached tool list for a given bot.
     * Useful on bot respawn.
     */
    static clearCache(botId?: string): void {
        if (botId) {
            const prefix = `${botId}:`;
            for (const key of toolListCache.keys()) {
                if (key.startsWith(prefix)) {
                    toolListCache.delete(key);
                }
            }
        } else {
            toolListCache.clear();
            mcpSessionInitCache.clear();
        }
    }

    /**
     * Get the cache entry count (for testing/debugging).
     */
    static get cacheSize(): number {
        return toolListCache.size;
    }
}
