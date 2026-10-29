/**
 * A tool call streams its arguments in pieces. A piece that is exactly "{}" is part of them (the empty `catch(e){}` in a
 * mini app's code): dropping it broke every page a bot wrote with one, so nothing on the page ran.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) =>
        callback({ end: vi.fn(), setAttribute: vi.fn(), spanContext: vi.fn(() => ({ spanId: "s", traceId: "t" })) })
    ),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
    captureException: vi.fn(),
}));
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: vi.fn(),
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));
const mockGenerateStream = vi.fn();
const mockGetOrCreateProvider = vi.fn();
const mockSupportsVision = vi.fn(() => false);
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: mockGetOrCreateProvider,
        supportsVision: mockSupportsVision,
    })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
const mockExecuteToolCall = vi.fn();
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn(async () => ({
            tools: [{ type: "function", function: { name: "generate_music", description: "Makes a song", parameters: {} } }],
            toolServerMap: new Map([["generate_music", { serverId: "s1", serverUrl: "https://music.test/mcp", authType: "none", title: "Make a song" }]]),
        })),
        executeToolCall: (...args: unknown[]) => mockExecuteToolCall(...args),
        clearCache: vi.fn(),
    },
    toolTimeoutMs: vi.fn(() => 60_000),
}));


const provider = {
    providerId: "deepseek-flash",
    name: "DeepSeek V4 Flash",
    type: "openai",
    enabled: true,
    endpoint: "https://api.deepseek.com",
    apiKeyEncrypted: "iv:tag:data",
    model: "deepseek-v4-flash",
    temperature: 0.7,
    maxTokens: 16000,
    supportsStreaming: true,
    supportsVision: null,
    visionModel: null,
    defaultVision: false,
    settings: {},
    source: "universe-ai",
};

function buildMocks() {
    const admin: any = {
        isConfigured: () => true,
        getAIProviderCredentials: vi.fn(),
        getBotAiCredentials: vi.fn().mockResolvedValue(provider),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = {
        getMemory: vi.fn(() => ({ userUuid: "test-uuid", dmRoomId: "!dm:matrix.test" })),
        appendVisionDescription: vi.fn(),
        getPendingMediaNotice: vi.fn(() => ""),
        setHistoryWindow: vi.fn(),
    };
    return { admin, memory };
}

/** One call whose arguments arrive in pieces, as an OpenAI-style stream sends them: only the first piece names the call. */
function pieces(id: string, name: string, parts: string[]) {
    return async function* () {
        yield { content: "", done: false, toolCalls: [{ id, name, arguments: parts[0] }] };
        for (const part of parts.slice(1)) yield { content: "", done: false, toolCalls: [{ id: undefined, name: "", arguments: part }] };
        yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
    };
}

function says(text: string) {
    return async function* () {
        yield { content: text, done: false };
        yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
    };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}


const code = 'try{ ctx.close(); }catch(e){} if(a){}';
// Cut where a model's tokens fall: "{}" on its own
const parts = ['{"prompt":"try{ ctx.close(); }catch(e)', "{}", " if(a)", "{}", '"}'];

describe("AIService – a tool call's arguments in pieces", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        mockExecuteToolCall.mockReset();
        mockExecuteToolCall.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    const reply = (service: any) =>
        drain(service.generateBotResponseStream("bot-1", 42, "make me a song", "You are a bot.", "universe-ai", "!dm:matrix.test", "", undefined, undefined, undefined, undefined, "dm"));
    const sentPrompts = () => mockExecuteToolCall.mock.calls.map((call) => (call[3] as { prompt: string }).prompt);

    it('keeps a piece that is exactly "{}"', async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(pieces("c1", "generate_music", parts)).mockImplementationOnce(says("Here it is."));
        await reply(new AIService(memory, admin, "http://admin.local"));
        expect(sentPrompts()).toEqual([code]);
    });

    it("keeps it in a later round of the same reply too", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(pieces("c1", "generate_music", ['{"prompt":"first"}']))
            .mockImplementationOnce(pieces("c2", "generate_music", parts))
            .mockImplementationOnce(says("Here it is."));
        await reply(new AIService(memory, admin, "http://admin.local"));
        expect(sentPrompts()).toEqual(["first", code]);
    });

    it("still runs a call with no arguments", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(pieces("c1", "generate_music", ["{}"])).mockImplementationOnce(says("Done."));
        await reply(new AIService(memory, admin, "http://admin.local"));
        expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
        expect(mockExecuteToolCall.mock.calls[0][3]).toEqual({});
    });
});
