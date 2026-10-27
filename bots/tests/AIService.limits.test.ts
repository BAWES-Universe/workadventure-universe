/**
 * A bot's limits (Orbit #666) as the bot server follows them: they come with the bot's credentials from Orbit, and
 * "Say when nothing was saved" catches a reply that claims an artifact nobody saved.
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
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));


const LIMITS = {
    replyTokens: 16000,
    steps: 2,
    continuations: 1,
    messages: 8,
    readChars: 10000,
    waitSeconds: 120,
    artifactBytes: 1048576,
    artifactVersions: 0,
    artifactSaveSeconds: 60,
    guard: true,
};

const provider = (over: Record<string, unknown> = {}) => ({
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
    limits: LIMITS,
    ...over,
});

function buildMocks(limits: Record<string, unknown> = LIMITS) {
    const admin: any = {
        isConfigured: () => true,
        getAIProviderCredentials: vi.fn(),
        getBotAiCredentials: vi.fn().mockResolvedValue(provider({ limits })),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        makeArtifact: vi.fn(async () => ({ artifact: { id: "art-1", title: "Board", kind: "app", makerName: "Scout" }, version: { number: 1, summary: null }, hidden: false })),
    };
    const memory: any = {
        getMemory: vi.fn(() => ({ userUuid: "test-uuid", dmRoomId: "!dm:matrix.test" })),
        appendVisionDescription: vi.fn(),
        getPendingMediaNotice: vi.fn(() => ""),
        setHistoryWindow: vi.fn(),
    };
    return { admin, memory };
}

function says(text: string) {
    return async function* () {
        yield { content: text, done: false };
        yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
    };
}

async function* toolCall() {
    yield { content: "", done: false, toolCalls: [{ id: `call_${Math.random()}`, name: "get_bot_position", arguments: "{}" }] };
    yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
}

async function* makesArtifact() {
    yield { content: "", done: false, toolCalls: [{ id: "call_make", name: "make_artifact", arguments: JSON.stringify({ title: "Board", kind: "app", content: "<h1>x</h1>" }) }] };
    yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

describe("AIService – a bot's limits from Orbit", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.stubEnv("BOT_ARTIFACTS_ENABLED", "true");
        mockGenerateStream.mockReset();
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    const reply = (service: any, message = "hello") =>
        drain(service.generateBotResponseStream("bot-1", 42, message, "You are a bot.", "universe-ai", "!dm:matrix.test", "", undefined, undefined, undefined, undefined, "dm"));
    const said = (chunks: any[]) => chunks.map((chunk) => chunk.content).join("");

    it("calls the AI with the bot's longest reply and waits as long as its limit says", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementation(says("Hi!"));
        await reply(new AIService(memory, admin, "http://admin.local"));
        const config = mockGenerateStream.mock.calls[0][3];
        expect(config.maxTokens).toBe(16000);
        expect(config.settings.timeout).toBe(120_000);
        expect(config.limits).toMatchObject({ steps: 2, continuations: 1 });
        expect(memory.setHistoryWindow).toHaveBeenCalledWith("bot-1", 8);
    });

    it("uses no more tool steps in one reply than its limit", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementation(toolCall);
        await reply(new AIService(memory, admin, "http://admin.local"));
        // The first call, two steps, then one answer from what it found
        expect(mockGenerateStream).toHaveBeenCalledTimes(4);
    });

    it("says when a reply claims an artifact that was never saved, and tries once more", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(says("Rebuilt it, v2 has the charts.")).mockImplementationOnce(says("Sorry, I could not save it."));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"), "add charts");
        const reset = chunks.findIndex((chunk) => chunk.reset);
        expect(said(chunks.slice(0, reset))).toBe("Rebuilt it, v2 has the charts.\n\nNo new version was saved.");
        expect(said(chunks.slice(reset))).toBe("Sorry, I could not save it.");
        expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
        expect(chunks[chunks.length - 1].done).toBe(true);
        expect(mockGenerateStream).toHaveBeenCalledTimes(2);
        expect(mockGenerateStream.mock.calls[1][2]).toContain("No new version was saved.");
        expect(mockGenerateStream.mock.calls[1][2]).toContain("add charts");
    });

    it("says nothing when the switch is off", async () => {
        const { admin, memory } = buildMocks({ ...LIMITS, guard: false });
        mockGenerateStream.mockImplementation(says("Rebuilt it, v2 has the charts."));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"));
        expect(said(chunks)).toBe("Rebuilt it, v2 has the charts.");
        expect(mockGenerateStream).toHaveBeenCalledTimes(1);
    });

    it("says nothing when the artifact really was saved in that turn", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(makesArtifact).mockImplementationOnce(says("Made the board, v1 is in the chat."));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"));
        expect(admin.makeArtifact).toHaveBeenCalledTimes(1);
        expect(admin.makeArtifact.mock.calls[0][2]).toBe(60_000);
        expect(said(chunks)).not.toContain("No new version was saved.");
        expect(mockGenerateStream).toHaveBeenCalledTimes(2);
    });

    it("says nothing on a reply written again: the first one may have saved it (Sentry on #1486)", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementation(says("Here's the updated dashboard, v2 is in the chat."));
        const service = new AIService(memory, admin, "http://admin.local");
        const chunks = await drain(service.generateBotResponseStream("bot-1", 42, "hello", "You are a bot.", "universe-ai", "!dm:matrix.test", "", undefined, undefined, undefined, undefined, "dm", undefined, undefined, undefined, true));
        expect(said(chunks)).not.toContain("No new version was saved.");
        expect(mockGenerateStream).toHaveBeenCalledTimes(1);
    });

    it("says nothing for a reply about something else", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementation(says("Hi! What should we build?"));
        const chunks = await reply(new AIService(memory, admin, "http://admin.local"));
        expect(said(chunks)).toBe("Hi! What should we build?");
        expect(mockGenerateStream).toHaveBeenCalledTimes(1);
    });
});
