/**
 * A direct message has no bot on the map, yet the bot still lives in a room. The reply must know that room by name,
 * as a bubble on the map does, instead of only saying "my room".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock @sentry/node ---
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
}));

// --- Mock @sentry/core ---
vi.mock("@sentry/core", () => ({
    _INTERNAL_setSpanForScope: vi.fn(),
}));

// --- Mock PostHog telemetry so the captured generations can be inspected ---
const mockCaptureAiGeneration = vi.fn();
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: mockCaptureAiGeneration,
    captureAiTrace: vi.fn(),
    flushPostHog: vi.fn().mockResolvedValue(undefined),
}));

// --- Mock encryption ---
vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "decrypted-key"),
}));

// --- Mock AIProviderRegistry ---
const mockGenerateStream = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
    })),
}));

// --- Mock BotClient ---
vi.mock("../client/BotClient", () => ({
    BotClient: vi.fn(),
}));

// --- Mock MCPConnector to prevent real HTTP calls during tests ---
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({
            tools: [],
            toolServerMap: new Map(),
        }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

async function* plainAnswer() {
    yield { content: "I live in the Lobby.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 3, promptTokens: 2, completionTokens: 1, latency: 5, error: false, truncated: false } };
}

const ROOM = "https://play.example/@/bawes/hq/lobby";

function buildMocks() {
    const adminApiService: any = {
        getAIProviderCredentials: vi.fn().mockResolvedValue({
            providerId: "test-provider", name: "TestBot", type: "lmstudio", enabled: true, endpoint: "http://localhost:1234",
            apiKeyEncrypted: null, model: "llama3", temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {},
        }),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue({ universeName: "BAWES", worldName: "BAWES HQ", roomName: "Lobby" }),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const mapDataService: any = {
        getAreas: vi.fn().mockResolvedValue([
            { name: "Library", x: 10, y: 20 },
            { name: "Social Area", x: 30, y: 40 },
        ]),
    };
    const conversationMemory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })) };
    return { adminApiService, mapDataService, conversationMemory };
}

async function systemPromptFor(channel: "world" | "dm", homeRoomUrl?: string) {
    const { AIService } = await import("../ai/AIService");
    const mocks = buildMocks();
    mockGenerateStream.mockImplementationOnce(plainAnswer);
    const service = new AIService(mocks.conversationMemory, mocks.adminApiService, "http://admin.local", mocks.mapDataService);
    const chunks: any[] = [];
    for await (const chunk of service.generateBotResponseStream(
        "bot-1", -1, "where u at", "You are Friend.", "test-provider", "matrix-dm", "", undefined, mocks.adminApiService,
        undefined, undefined, channel, undefined, homeRoomUrl
    )) chunks.push(chunk);
    return { prompt: String(mockGenerateStream.mock.calls[0][1]), mocks };
}

describe("AIService: where a bot lives, in a direct message", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
    });
    afterEach(() => {
        vi.resetModules();
    });

    it("names the bot's room, world and areas", async () => {
        const { prompt, mocks } = await systemPromptFor("dm", ROOM);
        expect(mocks.adminApiService.getRoomMetadata).toHaveBeenCalledWith(ROOM);
        expect(prompt).toContain("- World: BAWES HQ");
        expect(prompt).toContain("- Room: Lobby");
        expect(prompt).toContain("- Areas in this room: Library, Social Area");
        expect(prompt).toContain("name that room and its world");
    });

    it("leaves out area coordinates, since a direct message can't walk there", async () => {
        const { prompt } = await systemPromptFor("dm", ROOM);
        expect(prompt).not.toContain("coordinates");
    });

    it("adds no place at all without a room, as before", async () => {
        const { prompt, mocks } = await systemPromptFor("dm");
        expect(mocks.adminApiService.getRoomMetadata).not.toHaveBeenCalled();
        expect(prompt).not.toContain("- Room: Lobby");
    });

    it("ignores the room for a caller on the map with no bot client", async () => {
        const { prompt, mocks } = await systemPromptFor("world", ROOM);
        expect(mocks.adminApiService.getRoomMetadata).not.toHaveBeenCalled();
        expect(prompt).not.toContain("- Room: Lobby");
    });
});
