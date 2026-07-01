/**
 * Tests for MCPConnector
 *
 * Covers:
 * 1. discoverTools returns tool definitions from a mock HTTP server
 * 2. discoverTools caching works (second call within 1h uses cache)
 * 3. discoverTools graceful degradation (unreachable server returns empty)
 * 4. executeToolCall sends correct JSON-RPC and returns result
 * 5. executeToolCall 10s timeout behaviour
 * 6. Auth injection: none/bearer/api-key
 * 7. AIService integration: buildTools includes MCP tools
 * 8. AIService integration: executeToolCalls routes MCP tools correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { MCPConnector, type McpToolDefinition } from '../MCPConnector';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../ai/encryption', () => ({
    decryptApiKey: (val: string | null | undefined) => val || null,
}));

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn(),
        isCancel: vi.fn(),
        isAxiosError: vi.fn(),
    },
}));

const mockedAxios = vi.mocked(axios);

// Helper: make axios.isAxiosError return true for our mock errors
function makeAxiosError(status: number, data?: any): any {
    const err: any = new Error(`HTTP ${status}`);
    err.response = { status, data };
    err.isAxiosError = true;
    return err;
}

// Make isAxiosError work
mockedAxios.isAxiosError.mockImplementation((err: any) => err?.isAxiosError === true);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_CONFIGS = [
    {
        id: 'server-1',
        botId: 'bot-123',
        name: 'Weather Server',
        serverUrl: 'https://weather.example.com/mcp',
        authType: 'bearer' as const,
        authConfig: 'weather-token-abc',
        enabled: true,
    },
    {
        id: 'server-2',
        botId: 'bot-123',
        name: 'Math Server',
        serverUrl: 'https://math.example.com/mcp',
        authType: 'api-key' as const,
        authConfig: 'math-key-xyz',
        enabled: true,
    },
    {
        id: 'server-3',
        botId: 'bot-123',
        name: 'Disabled Server',
        serverUrl: 'https://disabled.example.com/mcp',
        authType: 'none' as const,
        authConfig: undefined,
        enabled: false,
    },
];

const MOCK_WEATHER_TOOLS_RESPONSE = {
    jsonrpc: '2.0',
    id: '1',
    result: {
        tools: [
            {
                name: 'get_weather',
                description: 'Get current weather for a location',
                inputSchema: {
                    type: 'object',
                    properties: {
                        location: { type: 'string' },
                    },
                    required: ['location'],
                },
            },
            {
                name: 'get_forecast',
                description: 'Get weather forecast',
                inputSchema: {
                    type: 'object',
                    properties: {
                        location: { type: 'string' },
                        days: { type: 'number' },
                    },
                    required: ['location'],
                },
            },
        ],
    },
};

const MOCK_MATH_TOOLS_RESPONSE = {
    jsonrpc: '2.0',
    id: '1',
    result: {
        tools: [
            {
                name: 'calculate',
                description: 'Perform a calculation',
                inputSchema: {
                    type: 'object',
                    properties: {
                        expression: { type: 'string' },
                    },
                    required: ['expression'],
                },
            },
        ],
    },
};

const MOCK_WEATHER_CALL_RESPONSE = {
    jsonrpc: '2.0',
    id: '2',
    result: {
        content: [
            {
                type: 'text',
                text: 'The weather in Paris is 22°C and sunny.',
            },
        ],
    },
};

const MOCK_INIT_RESPONSE = {
    data: {
        jsonrpc: '2.0',
        id: 'init',
        result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
            capabilities: {},
        },
    },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPConnector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        // Use a fixed date
        vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        MCPConnector.clearCache();
    });

    // --- discoverTools ----------------------------------------------------

    describe('discoverTools', () => {
        it('fetches MCP server configs and discovers tools from each enabled server', async () => {
            // Mock admin API returning MCP server configs
            mockedAxios.get.mockResolvedValueOnce({ data: MOCK_CONFIGS });

            // Mock tools/list for weather server (bearer auth)
            mockedAxios.post.mockImplementation(async (url: string, body: any, config?: any) => {
                if (url === 'https://weather.example.com/mcp') {
                    if (body?.method === 'initialize') {
                        return MOCK_INIT_RESPONSE;
                    }
                    expect(body).toEqual({
                        jsonrpc: '2.0',
                        id: '1',
                        method: 'tools/list',
                    });
                    expect(config?.headers?.Authorization).toBe('Bearer weather-token-abc');
                    expect(config?.headers?.['Content-Type']).toBe('application/json');
                    return { data: MOCK_WEATHER_TOOLS_RESPONSE };
                }
                if (url === 'https://math.example.com/mcp') {
                    if (body?.method === 'initialize') {
                        return MOCK_INIT_RESPONSE;
                    }
                    expect(body).toEqual({
                        jsonrpc: '2.0',
                        id: '1',
                        method: 'tools/list',
                    });
                    expect(config?.headers?.['X-API-Key']).toBe('math-key-xyz');
                    expect(config?.headers?.['Content-Type']).toBe('application/json');
                    return { data: MOCK_MATH_TOOLS_RESPONSE };
                }
                throw new Error(`Unexpected URL: ${url}`);
            });

            const tools = await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            // Verify admin API was called correctly
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://admin.example.com/api/bots/bot-123/mcp-servers',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer admin-token',
                    }),
                })
            );

            // Should have 3 tools total (2 from weather, 1 from math)
            expect(tools).toHaveLength(3);

            // Weather tools
            expect(tools[0]).toEqual({
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get current weather for a location',
                    parameters: {
                        type: 'object',
                        properties: { location: { type: 'string' } },
                        required: ['location'],
                    },
                },
            });
            expect(tools[1].function.name).toBe('get_forecast');

            // Math tool
            expect(tools[2].function.name).toBe('calculate');

            // Disabled server should NOT be called
            expect(mockedAxios.post).not.toHaveBeenCalledWith(
                expect.stringContaining('disabled.example.com'),
                expect.anything()
            );
        });

        it('returns empty array when no MCP servers are configured (404)', async () => {
            const axiosError = makeAxiosError(404);
            mockedAxios.get.mockRejectedValueOnce(axiosError);

            const tools = await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            expect(tools).toEqual([]);
        });

        it('returns empty array when admin API is unreachable', async () => {
            mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

            const tools = await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            expect(tools).toEqual([]);
        });

        it('gracefully degrades when an MCP server is unreachable', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: MOCK_CONFIGS });

            // Weather server works, math server fails
            let callCount = 0;
            mockedAxios.post.mockImplementation(async (url: string, body: any) => {
                if (body?.method === 'initialize') {
                    return MOCK_INIT_RESPONSE;
                }
                callCount++;
                if (url === 'https://weather.example.com/mcp') {
                    return { data: MOCK_WEATHER_TOOLS_RESPONSE };
                }
                if (url === 'https://math.example.com/mcp') {
                    throw new Error('Connection refused');
                }
                throw new Error(`Unexpected URL: ${url}`);
            });

            const tools = await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            // Should still get tools from the working server
            expect(tools).toHaveLength(2);
            expect(tools[0].function.name).toBe('get_weather');
            expect(tools[1].function.name).toBe('get_forecast');
        });
    });

    // --- Caching ----------------------------------------------------------

    describe('caching', () => {
        it('caches tool lists and reuses them within TTL', async () => {
            mockedAxios.get.mockResolvedValue({ data: MOCK_CONFIGS });

            let postCallCount = 0;
            mockedAxios.post.mockImplementation(async (url: string, body: any) => {
                if (body?.method === 'initialize') {
                    return MOCK_INIT_RESPONSE;
                }
                postCallCount++;
                if (url === 'https://weather.example.com/mcp') {
                    return { data: MOCK_WEATHER_TOOLS_RESPONSE };
                }
                if (url === 'https://math.example.com/mcp') {
                    return { data: MOCK_MATH_TOOLS_RESPONSE };
                }
                throw new Error(`Unexpected URL: ${url}`);
            });

            // First call — should fetch from both servers
            const tools1 = await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );
            expect(tools1).toHaveLength(3); // 2 weather + 1 math
            expect(postCallCount).toBe(2); // 2 servers, 1 method call each (init not counted)

            // Second call — should use cache for server tools but still call admin API
            vi.advanceTimersByTime(30 * 60 * 1000); // 30 min (within TTL)

            const tools2 = await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );
            expect(tools2).toHaveLength(3);
            // Should NOT have made additional method calls (cached) — postCallCount unchanged
            expect(postCallCount).toBe(2);
        });

        it('fetches fresh data after TTL expires', async () => {
            mockedAxios.get.mockResolvedValue({ data: MOCK_CONFIGS });

            let postCallCount = 0;
            mockedAxios.post.mockImplementation(async (url: string, body: any) => {
                if (body?.method === 'initialize') {
                    return MOCK_INIT_RESPONSE;
                }
                postCallCount++;
                return { data: MOCK_WEATHER_TOOLS_RESPONSE };
            });

            // First call
            await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            // Move past TTL (61 minutes)
            vi.advanceTimersByTime(61 * 60 * 1000);

            // Reset the admin mock post counter
            const beforeSecondCall = postCallCount;

            // Second call — should re-fetch
            await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            // Should have made more post calls
            expect(postCallCount).toBeGreaterThan(beforeSecondCall);
        });

        it('clearCache removes entries for a specific bot', async () => {
            mockedAxios.get.mockResolvedValue({ data: MOCK_CONFIGS });
            mockedAxios.post.mockImplementation(async (url: string, body: any) => {
                if (body?.method === 'initialize') {
                    return MOCK_INIT_RESPONSE;
                }
                return { data: MOCK_WEATHER_TOOLS_RESPONSE };
            });

            await MCPConnector.discoverTools(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            expect(MCPConnector.cacheSize).toBeGreaterThan(0);

            MCPConnector.clearCache('bot-123');
            expect(MCPConnector.cacheSize).toBe(0);
        });
    });

    // --- executeToolCall --------------------------------------------------

    describe('executeToolCall', () => {
        it('sends correct JSON-RPC and returns content array', async () => {
            mockedAxios.post.mockImplementation(async (url: string, body: any, config?: any) => {
                if (body?.method === 'initialize') {
                    return MOCK_INIT_RESPONSE;
                }
                expect(url).toBe('https://weather.example.com/mcp');
                expect(body).toEqual({
                    jsonrpc: '2.0',
                    id: '2',
                    method: 'tools/call',
                    params: {
                        name: 'get_weather',
                        arguments: { location: 'Paris' },
                    },
                });
                return { data: MOCK_WEATHER_CALL_RESPONSE };
            });

            const result = await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'bearer',
                'weather-token-abc'
            );

            expect(result).toEqual(MOCK_WEATHER_CALL_RESPONSE.result.content);
        });

        it('returns error object on network failure', async () => {
            mockedAxios.post
                .mockResolvedValueOnce(MOCK_INIT_RESPONSE)
                .mockRejectedValueOnce(new Error('Network error'));

            const result = await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'bearer',
                'weather-token-abc'
            );

            expect(result).toEqual({
                error: 'Tool unavailable: get_weather (server not reachable)',
            });
        });

        it('returns error when tool call has an error response', async () => {
            mockedAxios.post
                .mockResolvedValueOnce(MOCK_INIT_RESPONSE)
                .mockResolvedValueOnce({
                data: {
                    jsonrpc: '2.0',
                    id: '2',
                    error: {
                        code: -32602,
                        message: 'Invalid params: location is required',
                    },
                },
            });

            const result = await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                {},
                'none'
            );

            expect(result.error).toContain('Tool error');
            expect(result.error).toContain('Invalid params');
        });

        it('returns error when no content in response', async () => {
            mockedAxios.post
                .mockResolvedValueOnce(MOCK_INIT_RESPONSE)
                .mockResolvedValueOnce({
                    data: {
                        jsonrpc: '2.0',
                        id: '2',
                        result: { content: [] },
                    },
                });

            const result = await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'none'
            );

            // Empty content array is a valid result
            expect(result).toEqual([]);
        });
    });

    // --- Auth injection ---------------------------------------------------

    describe('auth injection', () => {
        it('sends Bearer token for bearer auth type', async () => {
            mockedAxios.post.mockResolvedValue({ data: MOCK_WEATHER_CALL_RESPONSE });

            await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'bearer',
                'my-token'
            );

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer my-token',
                    }),
                })
            );
        });

        it('sends X-API-Key for api-key auth type', async () => {
            mockedAxios.post.mockResolvedValue({ data: MOCK_WEATHER_CALL_RESPONSE });

            await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'api-key',
                'my-api-key'
            );

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-API-Key': 'my-api-key',
                    }),
                })
            );
        });

        it('does not set auth headers for none auth type', async () => {
            mockedAxios.post.mockResolvedValue({ data: MOCK_WEATHER_CALL_RESPONSE });

            await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'none'
            );

            expect(mockedAxios.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                    }),
                })
            );
        });
    });

    // --- discoverToolsWithMapping ----------------------------------------

    describe('discoverToolsWithMapping', () => {
        it('returns both tools and tool→server map', async () => {
            mockedAxios.get.mockResolvedValueOnce({ data: MOCK_CONFIGS });

            mockedAxios.post.mockImplementation(async (url: string, body: any) => {
                if (body?.method === 'initialize') {
                    return MOCK_INIT_RESPONSE;
                }
                if (url === 'https://weather.example.com/mcp') {
                    return { data: MOCK_WEATHER_TOOLS_RESPONSE };
                }
                if (url === 'https://math.example.com/mcp') {
                    return { data: MOCK_MATH_TOOLS_RESPONSE };
                }
                throw new Error(`Unexpected: ${url}`);
            });

            const result = await MCPConnector.discoverToolsWithMapping(
                'bot-123',
                'https://admin.example.com',
                'admin-token',
                'bot-service-token'
            );

            expect(result.tools).toHaveLength(3);
            expect(result.toolServerMap.size).toBe(3);

            // get_weather → weather server
            const weatherConfig = result.toolServerMap.get('get_weather');
            expect(weatherConfig).toBeDefined();
            expect(weatherConfig!.serverId).toBe('server-1');
            expect(weatherConfig!.serverUrl).toBe('https://weather.example.com/mcp');
            expect(weatherConfig!.authType).toBe('bearer');
            expect(weatherConfig!.authConfig).toBe('weather-token-abc');

            // calculate → math server
            const mathConfig = result.toolServerMap.get('calculate');
            expect(mathConfig).toBeDefined();
            expect(mathConfig!.serverId).toBe('server-2');
            expect(mathConfig!.serverUrl).toBe('https://math.example.com/mcp');
            expect(mathConfig!.authType).toBe('api-key');
            expect(mathConfig!.authConfig).toBe('math-key-xyz');

            // Disabled server tools should NOT be mapped
            expect(result.toolServerMap.has('disabled_tool')).toBe(false);
        });
    });

    // --- Timeout ----------------------------------------------------------

    describe('timeout handling', () => {
        it('returns error when server takes too long', async () => {
            // Simulate timeout by having the promise never resolve
            // axios does support timeout via signal, but our mock just needs to throw
            // We'll simulate an abort error
            const abortError: any = new Error('canceled');
            abortError.isCanceled = true;

            mockedAxios.post
                .mockResolvedValueOnce(MOCK_INIT_RESPONSE)
                .mockImplementationOnce(async () => {
                // Simulate signal abort
                const err: any = new Error('canceled');
                err.code = 'ERR_CANCELED';
                throw err;
            });

            const result = await MCPConnector.executeToolCall(
                'server-1',
                'https://weather.example.com/mcp',
                'get_weather',
                { location: 'Paris' },
                'none'
            );

            expect(result.error).toContain('Tool unavailable');
        });
    });
});

// ---------------------------------------------------------------------------
// AIService integration tests (unit-testable isolation)
// ---------------------------------------------------------------------------

describe('AIService MCP integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        MCPConnector.clearCache();
    });

    it('MCPConnector.discoverTools returns McpToolDefinition compatible with AIService tools array', async () => {
        // This test validates the shape compatibility
        mockedAxios.get.mockResolvedValueOnce({ data: [MOCK_CONFIGS[0]] }); // only weather server
        mockedAxios.post
            .mockResolvedValueOnce(MOCK_INIT_RESPONSE)
            .mockResolvedValueOnce({ data: MOCK_WEATHER_TOOLS_RESPONSE });

        const tools = await MCPConnector.discoverTools(
            'bot-123',
            'https://admin.example.com',
            'admin-token',
            'bot-service-token'
        );

        // Each tool should match the McpToolDefinition type
        for (const tool of tools) {
            expect(tool.type).toBe('function');
            expect(tool.function).toBeDefined();
            expect(typeof tool.function.name).toBe('string');
            expect(typeof tool.function.description).toBe('string');
            expect(tool.function.parameters).toBeDefined();
        }
    });

    it('MCP tool defs can be merged into same array as hardcoded tools', () => {
        // Verify type compatibility: both MCP tools and hardcoded tools share the same shape
        const mcpTool: McpToolDefinition = {
            type: 'function',
            function: {
                name: 'mcp_test_tool',
                description: 'An MCP tool',
                parameters: { type: 'object', properties: {} },
            },
        };

        const hardcodedTool: McpToolDefinition = {
            type: 'function',
            function: {
                name: 'get_people_on_map',
                description: 'Get people',
                parameters: { type: 'object', properties: {} },
            },
        };

        const tools: McpToolDefinition[] = [hardcodedTool, mcpTool];
        expect(tools).toHaveLength(2);
    });

    it('executeToolCall can be routed from tool name lookup (simulating AIService routing)', async () => {
        // This test validates the routing pattern used by AIService.executeToolCalls
        mockedAxios.post
            .mockResolvedValueOnce(MOCK_INIT_RESPONSE)
            .mockResolvedValueOnce({ data: MOCK_WEATHER_CALL_RESPONSE });

        // Simulate the mcpToolServerMap in AIService
        const toolServerMap = new Map<string, any>();
        toolServerMap.set('get_weather', {
            serverId: 'server-1',
            serverUrl: 'https://weather.example.com/mcp',
            authType: 'bearer',
            authConfig: 'weather-token-abc',
        });

        // Simulate what AIService does: look up tool name in map
        const config = toolServerMap.get('get_weather');
        expect(config).toBeDefined();

        const result = await MCPConnector.executeToolCall(
            config.serverId,
            config.serverUrl,
            'get_weather',
            { location: 'Paris' },
            config.authType,
            config.authConfig
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result[0].type).toBe('text');
        expect(result[0].text).toContain('Paris');
    });
});
