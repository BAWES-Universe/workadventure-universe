/**
 * The quests a bot gives reach its system prompt, after the personality and the map context
 * (workadventure-universe#565). An Orbit that can't be asked, or an older AdminApiService without the call, changes
 * nothing in the prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockParentSpan = {
    end: vi.fn(),
    setAttribute: vi.fn(),
    spanContext: vi.fn(() => ({ spanId: "test-span-id", traceId: "test-trace-id" })),
};

vi.mock("@sentry/node", () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(mockParentSpan)),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
    captureException: vi.fn(),
}));
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: vi.fn(),
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));

const mockGenerateStream = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({ generateStream: mockGenerateStream })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));

async function* answer() {
    yield { content: "hello", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 20, error: false, truncated: false } };
}

const QUESTS = {
    botId: "bot-1",
    roomId: "r-1",
    source: "welcome-chapter",
    quests: [{ id: "welcome.meet", title: "Meet someone", description: "Say hi.", objective: "Say hi to someone", minutes: 2, badge: "First Hello" }],
};

function buildMocks(getBotQuests?: unknown) {
    const mockAdminApiService: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: "test-provider",
            name: "TestBot",
            type: "lmstudio",
            enabled: true,
            endpoint: "http://localhost:1234",
            apiKeyEncrypted: null,
            model: "llama3",
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue({ universeName: "bawes", worldName: "office", roomName: "lobby" }),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        ...(getBotQuests !== undefined ? { getBotQuests } : {}),
    };
    const mockConversationMemory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })) };
    return { mockAdminApiService, mockConversationMemory };
}

async function drain(generator: AsyncGenerator<any>): Promise<void> {
    for await (const _chunk of generator) {
        // nothing: only the prompt matters here
    }
}

describe("AIService – quests in the system prompt", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        mockGenerateStream.mockImplementation(answer);
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });

    afterEach(() => {
        vi.resetModules();
    });

    async function promptFor(getBotQuests?: unknown): Promise<string> {
        mockGenerateStream.mockClear();
        const { mockAdminApiService, mockConversationMemory } = buildMocks(getBotQuests);
        const service = new AIService(mockConversationMemory, mockAdminApiService, "http://admin.local");
        const botClient: any = { getRoomUrl: () => "http://play.test/@/bawes/office/lobby" };
        await drain(
            service.generateBotResponseStream("bot-1", 42, "what's the quest?", "You are Nova.", "test-provider", "space-1", "", botClient, mockAdminApiService)
        );
        expect(mockGenerateStream).toHaveBeenCalledTimes(1);
        return mockGenerateStream.mock.calls[0][1] as string;
    }

    it("puts the bot's quests after its personality and location, with the rules", async () => {
        const getBotQuests = vi.fn().mockResolvedValue(QUESTS);
        const prompt = await promptFor(getBotQuests);
        expect(getBotQuests).toHaveBeenCalledWith("bot-1");
        expect(prompt.indexOf("You are Nova.")).toBeLessThan(prompt.indexOf("Current Location Context"));
        expect(prompt.indexOf("Current Location Context")).toBeLessThan(prompt.indexOf("QUESTS YOU GIVE"));
        expect(prompt).toContain('"Meet someone" (about 2 min)');
        expect(prompt).toContain("chooses Accept");
    });

    it("tells a bot with no quests that it gives none", async () => {
        const prompt = await promptFor(vi.fn().mockResolvedValue({ ...QUESTS, quests: [] }));
        expect(prompt).toContain("You give no quests right now");
    });

    it("changes nothing when Orbit can't be asked, fails, or is too old to know about quests", async () => {
        expect(await promptFor(vi.fn().mockResolvedValue(null))).not.toContain("QUESTS");
        expect(await promptFor(vi.fn().mockRejectedValue(new Error("down")))).not.toContain("QUESTS");
        expect(await promptFor()).not.toContain("QUESTS");
    });
});
