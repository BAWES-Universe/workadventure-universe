/**
 * The steps line of a direct message (#1545): which calls a reset names, in what words, and how each one ended.
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

function calls(...list: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
    return async function* () {
        yield { content: "", done: false, toolCalls: list.map(({ id, name, args }) => ({ id, name, arguments: JSON.stringify(args) })) };
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

describe("AIService – the steps a reply shows (#1545)", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        mockExecuteToolCall.mockReset();
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    const reply = (service: any) =>
        drain(service.generateBotResponseStream("bot-1", 42, "make me a song", "You are a bot.", "universe-ai", "!dm:matrix.test", "", undefined, undefined, undefined, undefined, "dm"));

    it("names each tool server call in plain words before it runs, then says how each ended", async () => {
        const { admin, memory } = buildMocks();
        mockExecuteToolCall.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }] }).mockRejectedValueOnce(new Error("daily limit reached"));
        mockGenerateStream
            .mockImplementationOnce(
                calls(
                    { id: "c1", name: "generate_music", args: { prompt: "upbeat 8-bit funk", api_key: "secret" } },
                    { id: "c2", name: "generate_music", args: { prompt: "same, meaner bass" } },
                    { id: "c3", name: "get_bot_position", args: {} }
                )
            )
            .mockImplementationOnce(says("Here it is."));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"));

        const reset = chunks.find((chunk) => chunk.toolSteps);
        expect(reset.reset).toBe(true);
        // Moving around the map is not a step anyone waits for
        expect(reset.toolSteps).toEqual([
            { id: "c1", doing: "Using Make a song", done: "Used Make a song", detail: "upbeat 8-bit funk", group: "tool:generate_music" },
            { id: "c2", doing: "Using Make a song", done: "Used Make a song", detail: "same, meaner bass", group: "tool:generate_music" },
        ]);
        const ended = chunks.find((chunk) => chunk.toolStepResults);
        expect(ended).toMatchObject({ content: "", done: false });
        expect(ended.toolStepResults).toEqual([
            { id: "c1", ok: true },
            { id: "c2", ok: false, note: "daily limit reached" },
        ]);
        expect(chunks.indexOf(ended)).toBeGreaterThan(chunks.indexOf(reset));
        expect(chunks.map((chunk) => chunk.content).join("")).toBe("Here it is.");
    });

    it("shows reading a page, one of our own tools, in its own words", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream
            .mockImplementationOnce(calls({ id: "r1", name: "read_web_page", args: { url: "notaurl" } }))
            .mockImplementationOnce(says("Done."));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"));
        expect(chunks.find((chunk) => chunk.toolSteps).toolSteps).toEqual([
            { id: "r1", doing: "Reading a page", done: "Read a page", detail: "notaurl", group: "page" },
        ]);
    });

    it("ends calls the bot announced but never ran, once it reached its step limit, as not done", async () => {
        const { admin, memory } = buildMocks();
        admin.getBotAiCredentials.mockResolvedValue({ ...provider, limits: { steps: 1 } });
        mockExecuteToolCall.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
        mockGenerateStream
            .mockImplementationOnce(calls({ id: "c1", name: "generate_music", args: { prompt: "funk" } }))
            .mockImplementationOnce(calls({ id: "c2", name: "generate_music", args: { prompt: "disco" } }))
            .mockImplementation(says("Here is the first one."));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"));

        const announced = chunks.filter((chunk) => chunk.toolSteps).flatMap((chunk) => chunk.toolSteps.map((step: any) => step.id));
        expect(announced).toEqual(["c1", "c2"]);
        const results = chunks.filter((chunk) => chunk.toolStepResults).flatMap((chunk) => chunk.toolStepResults);
        expect(results).toEqual([
            { id: "c1", ok: true },
            { id: "c2", ok: false, note: "Not run: the bot reached its step limit" },
        ]);
        expect(mockExecuteToolCall).toHaveBeenCalledTimes(1);
    });
});
