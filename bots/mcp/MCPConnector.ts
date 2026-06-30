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
import { isIP } from 'net';
import { decryptApiKey } from '../ai/encryption';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerConfig {
    id: string;
    botId: string;
    name: string;
    serverUrl: string;
    authType: 'none' | 'bearer' | 'api-key';
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
    cachedAt: number;
    serverId: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const toolListCache = new Map<string, CachedTools>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT = 10_000; // 10 seconds

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
 */
function parseMcpResponse(response: any): any {
    const contentType = response.headers?.['content-type'] || '';
    const data = response.data;

    if (
        contentType.includes('text/event-stream') ||
        (typeof data === 'string' && (data.trimStart().startsWith('event:') || data.trimStart().startsWith('data:')))
    ) {
        const text = typeof data === 'string' ? data : String(data);
        const messages = text.split('\n\n');
        for (const msg of messages) {
            const dataLines: string[] = [];
            for (const line of msg.trim().split('\n')) {
                if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).replace(/^ /, ''));
                }
            }
            if (dataLines.length > 0) {
                try {
                    const parsed = JSON.parse(dataLines.join('\n'));
                    return { data: parsed, headers: response.headers, status: response.status };
                } catch {
                    continue;
                }
            }
        }
        return response; // fallback to raw
    }

    return response;
}

/**
 * Validate that a URL is safe to send MCP requests to (basic SSRF guard).
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const BLOCKED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    'metadata.google.internal',
    '169.254.169.254',
];

/** Check if an IP address falls within a private/reserved range. */
function isPrivateIp(ip: string): boolean {
    // Handle IPv4-mapped IPv6 (e.g., ::ffff:10.0.0.1) — extract embedded IPv4 and recurse
    const lowerIp = ip.toLowerCase();
    const v4MappedPrefix = '::ffff:';
    if (lowerIp.startsWith(v4MappedPrefix)) {
        return isPrivateIp(ip.slice(v4MappedPrefix.length));
    }

    // IPv4 private ranges
    if (ip.startsWith('10.')) return true;                                  // 10.0.0.0/8
    if (ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
        ip.startsWith('172.20.') || ip.startsWith('172.21.') ||
        ip.startsWith('172.22.') || ip.startsWith('172.23.') ||
        ip.startsWith('172.24.') || ip.startsWith('172.25.') ||
        ip.startsWith('172.26.') || ip.startsWith('172.27.') ||
        ip.startsWith('172.28.') || ip.startsWith('172.29.') ||
        ip.startsWith('172.30.') || ip.startsWith('172.31.')) return true; // 172.16.0.0/12
    if (ip.startsWith('192.168.')) return true;                              // 192.168.0.0/16
    if (ip.startsWith('169.254.')) return true;                              // link-local

    // IPv6 private / unique-local — only match when string looks like an actual IPv6 address
    if (ip.includes(':')) {
        if (ip.startsWith('fc') || ip.startsWith('fd')) return true;         // fc00::/7
        if (ip === '::1') return true;
    }

    return false;
}

function isValidMcpServerUrl(url: string): { valid: boolean; error?: string } {
    try {
        const parsed = new URL(url);
        if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
            return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` };
        }
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (BLOCKED_HOSTS.includes(hostname)) {
            return { valid: false, error: `Blocked host: ${parsed.hostname}` };
        }
        // Check if hostname is a private IP — only when it's actually an IP address
        if (isIP(hostname) > 0 && isPrivateIp(hostname)) {
            return { valid: false, error: `Blocked private IP: ${parsed.hostname}` };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL' };
    }
}

/**
 * Execute a JSON-RPC request to an MCP server with timeout and error handling.
 * Never throws — returns the response data or null on failure.
 */
async function jsonRpcRequest(
    serverUrl: string,
    method: string,
    params: Record<string, any> | undefined,
    authType: string,
    authConfig?: string,
    extraHeaders?: Record<string, string>
): Promise<any> {
    const urlCheck = isValidMcpServerUrl(serverUrl);
    if (!urlCheck.valid) {
        console.warn(`[MCPConnector] Invalid server URL for ${method}: ${urlCheck.error}`);
        return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const body: Record<string, any> = {
            jsonrpc: '2.0',
            id: method === 'tools/list' ? '1' : '2',
            method,
        };
        if (params !== undefined) {
            body.params = params;
        }

        const response = await axios.post(serverUrl, body, {
            headers: buildAuthHeaders(authType, authConfig, extraHeaders),
            signal: controller.signal,
        });

        const parsed = parseMcpResponse(response);
        return parsed.data;
    } catch (error: any) {
        if (axios.isCancel(error)) {
            console.warn(`[MCPConnector] Request timed out after ${REQUEST_TIMEOUT}ms for ${method}`);
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
        } else {
            console.warn(`[MCPConnector] Error on ${method}: ${error.message || error}`);
            Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
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
        function addUniqueTool(tool: McpToolDefinition, server: McpServerConfig) {
            if (!seenToolNames.has(tool.function.name)) {
                seenToolNames.add(tool.function.name);
                allTools.push(tool);
                toolServerMap.set(tool.function.name, {
                    serverId: server.id,
                    serverUrl: server.serverUrl,
                    authType: server.authType,
                    authConfig: server.authConfig,
                    headers: server.headers,
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
                    addUniqueTool(tool, server);
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

                // Cache the result
                toolListCache.set(cacheKey, {
                    tools: toolDefs,
                    cachedAt: Date.now(),
                    serverId: server.id,
                });

                for (const toolDef of toolDefs) {
                    addUniqueTool(toolDef, server);
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
        extraHeaders?: Record<string, string>
    ): Promise<any> {
        const response = await jsonRpcRequest(
            serverUrl,
            'tools/call',
            { name: toolName, arguments: args },
            authType,
            authConfig,
            extraHeaders
        );

        if (!response) {
            return { error: `Tool unavailable: ${toolName} (server not reachable)` };
        }

        if (response.error) {
            const errMsg = response.error.message || JSON.stringify(response.error);
            console.warn(`[MCPConnector] Tool ${toolName} returned error: ${errMsg}`);
            return { error: `Tool error: ${errMsg}` };
        }

        if (response.result && Array.isArray(response.result.content)) {
            return response.result.content;
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
        }
    }

    /**
     * Get the cache entry count (for testing/debugging).
     */
    static get cacheSize(): number {
        return toolListCache.size;
    }
}
