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
    cachedAt: number;
    serverId: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const toolListCache = new Map<string, CachedTools>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
export const REQUEST_TIMEOUT = 90_000; // 90 seconds

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
            return { data: answer, headers: response.headers, status: response.status };
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
}

const NOT_ANSWERED: JsonRpcOutcome = { data: null, neverRan: false };

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
        return { data: null, neverRan: urlCheck.unresolved === true };
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
                return NOT_ANSWERED;
            }
            if (outcome === 'timeout') {
                console.warn(`[MCPConnector] Request timed out after ${timeoutMs}ms for ${method} (during initialize)`);
                return NOT_ANSWERED;
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
        return { data: parsed.data, neverRan: false };
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
            return { data: null, neverRan: requestNeverRan(error, sessionId !== undefined) };
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
     * Discover MCP tools AND build a tool-name → server-config mapping.
     *
     * Returns both the tool definitions and a map that can be used to route
     * tool calls to the correct MCP server at execution time.
     */
    static async discoverToolsWithMapping(
        botId: string,
        adminApiUrl: string,
        adminApiToken: string,
        botServiceToken: string
    ): Promise<{
        tools: McpToolDefinition[];
        toolServerMap: Map<
            string,
            {
                serverId: string;
                serverUrl: string;
                authType: string;
                authConfig?: string;
                headers?: Record<string, string>;
                /** The tool server's own readable name for the tool, when it gave one (shown in the steps line). */
                title?: string;
            }
        >;
    }> {
        const toolServerMap = new Map<
            string,
            {
                serverId: string;
                serverUrl: string;
                authType: string;
                authConfig?: string;
                headers?: Record<string, string>;
                /** The tool server's own readable name for the tool, when it gave one (shown in the steps line). */
                title?: string;
            }
        >();

        // Fetch MCP server configs from admin API
        let servers: McpServerConfig[] = [];
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
            try {
                const response = await axios.get(
                    `${adminApiUrl}/api/bots/${botId}/mcp-servers`,
                    {
                        headers: {
                            Authorization: `Bearer ${adminApiToken}`,
                            'Content-Type': 'application/json',
                        },
                        signal: controller.signal,
                    }
                );
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
        function addUniqueTool(tool: McpToolDefinition, server: McpServerConfig, title?: string) {
            if (!seenToolNames.has(tool.function.name)) {
                seenToolNames.add(tool.function.name);
                allTools.push(tool);
                toolServerMap.set(tool.function.name, {
                    serverId: server.id,
                    serverUrl: server.serverUrl,
                    authType: server.authType,
                    authConfig: server.authConfig,
                    headers: server.headers,
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
                for (const tool of cached.tools) {
                    addUniqueTool(tool, server, cached.titles[tool.function.name]);
                }
                return;
            }

            const response = await jsonRpcRequest(
                server.serverUrl,
                'tools/list',
                undefined,
                server.authType,
                server.authConfig,
                server.headers
            );

            if (response && response.result && Array.isArray(response.result.tools)) {
                const toolDefs: McpToolDefinition[] = response.result.tools.map(
                    (tool: any) => ({
                        type: 'function' as const,
                        function: {
                            name: tool.name,
                            description: tool.description || '',
                            parameters: tool.inputSchema || tool.parameters || {},
                        },
                    })
                );

                const titles: Record<string, string> = {};
                for (const tool of response.result.tools) {
                    const title = tool?.title ?? tool?.annotations?.title;
                    if (typeof tool?.name === 'string' && typeof title === 'string' && title.trim()) {
                        titles[tool.name] = title.trim();
                    }
                }

                // Cache the result
                toolListCache.set(cacheKey, {
                    tools: toolDefs,
                    titles,
                    cachedAt: Date.now(),
                    serverId: server.id,
                });

                for (const toolDef of toolDefs) {
                    addUniqueTool(toolDef, server, titles[toolDef.function.name]);
                }
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
        const first = await sendJsonRpc(
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
        let response = first.data;

        if (!response) {
            // Send the call again only when it provably never ran (never
            // connected, or the server dropped our stale session): a server
            // that answered 5xx, reset the connection or timed out may have
            // done the work already, and a second send would do it twice.
            // The failed call dropped the cached session, so the retry
            // initializes a fresh one. A cancelled turn never retries.
            // With a Patience, the retry only gets the time that is left of it.
            const retryTimeoutMs = deadline !== undefined ? deadline - Date.now() : undefined;
            if (first.neverRan && !signal?.aborted && (retryTimeoutMs === undefined || retryTimeoutMs > 0)) {
                response = await jsonRpcRequest(
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
            }
        }

        if (!response) {
            if (signal?.aborted) {
                // Turn was cancelled while the tool call was in flight. Return
                // a distinct marker so callers can tell a cancellation apart
                // from a genuinely unreachable server.
                return { error: `Tool call cancelled: ${toolName}` };
            }
            return { error: `Tool unavailable: ${toolName} (server not reachable)` };
        }

        if (response.error) {
            const errMsg = response.error.message || JSON.stringify(response.error);
            console.warn(`[MCPConnector] Tool ${toolName} returned error: ${errMsg}`);
            return { error: `Tool error: ${errMsg}` };
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
            return { error: `Tool error: ${why || `${toolName} failed`}` };
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

        return { error: `Tool ${toolName} returned no content` };
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
