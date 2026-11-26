/**
 * The shared App action sorter (Orbit #1042) always runs on Universe AI's own Default (second GPT audit G2).
 *
 * The list of a ready-made App's actions is Universe's, for everyone. Sorting it must never run on, or be billed to, the
 * Brick whose reply happened to bring the App along: above all never on a person's own key. The model is fixed when the
 * sorter is made, so no reply can hand it a Brick's.
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
const mockQuickGenerate = vi.fn();
const mockGetOrCreateProvider = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: mockGetOrCreateProvider,
        supportsVision: vi.fn(() => false),
    })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
const mockDiscover = vi.fn();
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: (...args: unknown[]) => mockDiscover(...args),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));

// Orbit's list of actions waiting to be sorted, and where the picks go back
const mockAxiosGet = vi.fn();
const mockAxiosPut = vi.fn();
vi.mock("axios", () => {
    const api = { get: (...args: unknown[]) => mockAxiosGet(...args), put: (...args: unknown[]) => mockAxiosPut(...args), post: vi.fn().mockRejectedValue(new Error("not here")) };
    return { default: { ...api, create: () => api, isAxiosError: () => false }, ...api };
});

const provider = (over: Record<string, unknown> = {}) => ({
    providerId: "universe-default",
    name: "Universe Default",
    type: "openai",
    enabled: true,
    endpoint: "https://api.example.com",
    apiKeyEncrypted: "iv:tag:data",
    model: "small-model",
    temperature: 0.7,
    maxTokens: 512,
    supportsStreaming: true,
    supportsVision: null,
    visionModel: null,
    defaultVision: false,
    settings: {},
    ...over,
});

// A Brick on its owner's own key: Orbit answers by Brick with the person's key
const ownKeyAnswer = { ...provider({ providerId: "key-owner-1", name: "My own key" }), source: "own-key", keyOwnerId: "owner-1", keyAddressTyped: false };

function buildMocks() {
    const admin: any = {
        adminApiToken: "admin-token",
        getAIProviderCredentials: vi.fn(async (id: string) => (id === "universe-ai" ? provider() : null)),
        getBotAiCredentials: vi.fn().mockResolvedValue(ownKeyAnswer),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })), appendVisionDescription: vi.fn(), getPendingMediaNotice: vi.fn(() => "") };
    return { admin, memory };
}

async function* answer() {
    yield { content: "Hi!", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

const readyMadeEntry = { botId: "bot-1", serverId: "app-1", serverUrl: "https://orbit.local/apps/app-1", authType: "none", readyMade: true };

describe("Sorting a ready-made App's actions", () => {
    let AIService: any;
    const token = process.env.BOT_SERVICE_TOKEN;

    beforeEach(async () => {
        vi.clearAllMocks();
        process.env.BOT_SERVICE_TOKEN = "service-token";
        mockGenerateStream.mockImplementation(answer);
        mockQuickGenerate.mockResolvedValue({ content: JSON.stringify({ a0: "looksUp" }) });
        mockGetOrCreateProvider.mockReturnValue({ generate: mockQuickGenerate });
        mockDiscover.mockResolvedValue({ tools: [], toolServerMap: new Map([["send_mail", readyMadeEntry]]), issues: [] });
        mockAxiosGet.mockImplementation(async (url: string) => {
            if (url.endsWith("/api/app-actions/unsorted")) return { data: { actions: [{ toolkit: "mail", slug: "MAIL_LIST", description: "Lists mail" }] } };
            throw new Error(`unexpected GET ${url}`);
        });
        mockAxiosPut.mockResolvedValue({ data: {} });
        AIService = (await import("../ai/AIService")).AIService;
    });
    afterEach(() => {
        vi.resetModules();
        if (token === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = token;
    });

    it("runs on Universe AI, never on the own key of the Brick whose reply brought the App along", async () => {
        const { admin, memory } = buildMocks();
        const service = new AIService(memory, admin, "http://admin.local");
        await drain(service.generateBotResponseStream("bot-1", 42, "hello", "You are a bot.", "key-owner-1", "space-1", ""));
        await vi.waitFor(() => expect(mockAxiosPut).toHaveBeenCalled());

        // The reply itself was on the person's key, as they chose
        expect(mockGenerateStream.mock.calls[0][3].providerId).toBe("key-owner-1");
        // The sort asked Orbit for Universe AI by that name alone, never by this Brick
        expect(admin.getAIProviderCredentials).toHaveBeenCalledWith("universe-ai");
        // Every small model call (the sort is the only one here) ran on Universe AI's Default, never on a key of a person
        expect(mockGetOrCreateProvider).toHaveBeenCalled();
        for (const [config] of mockGetOrCreateProvider.mock.calls) {
            expect(config.providerId).toBe("universe-default");
            expect(config.ownKey).toBeUndefined();
        }
        expect(mockQuickGenerate).toHaveBeenCalledTimes(1);
        expect(mockQuickGenerate.mock.calls[0][2].providerId).toBe("universe-default");
        // The picks went back to Orbit with the service token
        expect(mockAxiosPut.mock.calls[0][1]).toEqual({ actions: [{ toolkit: "mail", slug: "MAIL_LIST", heading: "looksUp" }] });
        expect(mockAxiosPut.mock.calls[0][2].headers.Authorization).toBe("Bearer service-token");
    });

    it("does not fall back to the Brick's key when Universe AI is not there: the batch waits", async () => {
        const { admin, memory } = buildMocks();
        admin.getAIProviderCredentials.mockResolvedValue(null);
        const service = new AIService(memory, admin, "http://admin.local");
        await drain(service.generateBotResponseStream("bot-1", 42, "hello", "You are a bot.", "key-owner-1", "space-1", ""));
        await vi.waitFor(() => expect(admin.getAIProviderCredentials).toHaveBeenCalledWith("universe-ai"));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(mockQuickGenerate).not.toHaveBeenCalled();
        expect(mockAxiosPut).not.toHaveBeenCalled();
    });
});

describe("AppActionSorter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAxiosGet.mockResolvedValue({ data: { actions: [{ toolkit: "mail", slug: "MAIL_SEND", description: "Sends a mail" }] } });
        mockAxiosPut.mockResolvedValue({ data: {} });
    });

    it("asks only the model it was made with, at most once every ten minutes", async () => {
        const { AppActionSorter, SORT_EVERY_MS } = await import("../mcp/AppActionSorter");
        let now = 0;
        const ask = vi.fn().mockResolvedValue(JSON.stringify({ a0: "deletesOrSends" }));
        const sorter = new AppActionSorter(() => ({ adminApiUrl: "http://admin.local", serviceToken: "t" }), ask, () => now);

        expect(await sorter.maybeSort()).toBe(1);
        expect(await sorter.maybeSort()).toBe(0);
        now += SORT_EVERY_MS;
        expect(await sorter.maybeSort()).toBe(1);
        expect(ask).toHaveBeenCalledTimes(2);
        // maybeSort takes no model: a reply cannot hand it a Brick's
        expect(sorter.maybeSort.length).toBe(0);
    });
});
