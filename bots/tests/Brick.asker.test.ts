/**
 * A Brick's reply is always asked about by who it is for (game #2005, audit on #2023): never on what this server happens to
 * remember about where the Brick stands. Orbit says whether the asker is its owner; for anyone else the owner's apps, files and
 * computer stay out of the reply, and a Brick Orbit has nobody to serve for them (not visiting) does not answer on any key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openToolGate } from "./helpers/openToolGate";

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
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: mockGetOrCreateProvider,
        supportsVision: vi.fn(() => false),
    })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn(async () => ({
            tools: [{ type: "function", function: { name: "generate_music", description: "Makes a song", parameters: {} } }],
            toolServerMap: new Map([["generate_music", { serverId: "s1", serverUrl: "https://music.test/mcp", authType: "none", title: "Make a song" }]]),
        })),
        executeToolCall: vi.fn(),
        clearCache: vi.fn(),
    },
    toolTimeoutMs: vi.fn(() => 60_000),
}));

const OWNER = "uuid-owner";
const OTHER = "uuid-other";

const served = (over: Record<string, unknown> = {}) => ({
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
    ...over,
});

function build(talker: string | undefined, orbit: (botId: string, asker?: { asker: string; roomUrl?: string }) => unknown) {
    const admin: any = {
        isConfigured: () => true,
        getAIProviderCredentials: vi.fn().mockResolvedValue(served()),
        getBotAiCredentials: vi.fn(async (botId: string, asker?: { asker: string; roomUrl?: string }) => orbit(botId, asker)),
        computerIsOn: vi.fn(async () => false),
        appsOfferableFor: vi.fn(async () => null),
        brickOffersFor: vi.fn(async () => null),
        reportAiHealth: vi.fn().mockResolvedValue(undefined),
        trackAIUsage: vi.fn().mockResolvedValue(undefined),
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };
    const memory: any = {
        getMemory: vi.fn(() => ({ userUuid: talker, dmRoomId: "!dm:matrix.test" })),
        appendVisionDescription: vi.fn(),
        getPendingMediaNotice: vi.fn(() => ""),
        setHistoryWindow: vi.fn(),
    };
    return { admin, memory };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

async function* says() {
    yield { content: "Hi!", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 5, latency: 10, error: false } };
}

const toolNamesSent = () => ((mockGenerateStream.mock.calls[0]?.[4] ?? []) as any[]).map((tool) => tool?.function?.name);
const promptSent = () => String(mockGenerateStream.mock.calls[0]?.[1] ?? "");

describe("a Brick's reply is asked about by who it is for, wherever this server thinks the Brick is", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        mockGenerateStream.mockImplementation(says);
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });
    afterEach(() => vi.resetModules());

    const reply = (service: any, channel: "dm" | "world" = "dm") =>
        drain(service.generateBotResponseStream("brick-1", 42, "make me a song", "You are a bot.", "universe-ai", "!dm:matrix.test", "", undefined, undefined, undefined, undefined, channel));

    const ownersBrick = { isDefault: false, deleted: false };

    it("a Brick off any map (never put on this server's map, or the server restarted), asked by someone who is not its owner: Orbit is asked about them, and the owner's apps, files and computer stay out", async () => {
        const { admin, memory } = build(OTHER, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: OTHER });
        expect(toolNamesSent()).not.toContain("generate_music");
        expect(promptSent()).toContain("NOT TO THIS PERSON");
    });

    it("the same Brick asked by its owner: Orbit is asked, says nothing of others, and the owner's apps are there", async () => {
        const { admin, memory } = build(OWNER, () => served());
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: OWNER });
        expect(toolNamesSent()).toContain("generate_music");
        expect(promptSent()).not.toContain("NOT TO THIS PERSON");
    });

    it("a person this server cannot name is asked about as 'unknown', and is never taken for the owner", async () => {
        const { admin, memory } = build(undefined, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: "unknown" });
        expect(toolNamesSent()).not.toContain("generate_music");
    });

    it("a Brick Orbit has nobody to serve for (it is not visiting): it does not answer, falls back to no provider by id, and calls no AI", async () => {
        const { admin, memory } = build(OTHER, () => null);
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        const chunks = await reply(service);
        expect(admin.getAIProviderCredentials).not.toHaveBeenCalled();
        expect(mockGenerateStream).not.toHaveBeenCalled();
        expect(chunks.map((chunk) => chunk.content).join("")).toContain("Ask the person I came with");
    });

    it("a Brick on this server's map keeps sending its room, and a flag from Orbit strips the tools even if this server thought the talker was its owner", async () => {
        const { admin, memory } = build(OWNER, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteRoomBrick("brick-1", { ownerUuid: OWNER, ownerName: "Khalid", roomUrl: "https://play.test/_/a/b/c.tmj" });
        await reply(service, "world");
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: OWNER, roomUrl: "https://play.test/_/a/b/c.tmj" });
        expect(toolNamesSent()).not.toContain("generate_music");
    });

    it("a bot that is no Brick is asked about as it always was, with no asker", async () => {
        const { admin, memory } = build(OTHER, () => served());
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        await reply(service);
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1");
        expect(toolNamesSent()).toContain("generate_music");
    });

    it("a small call that names nobody is the Brick's own business: asked as its owner, so Orbit never has to guess (the owner's tool headings)", async () => {
        const { admin, memory } = build(OWNER, (_botId, asker) => (asker?.asker === "orbit-owner-id" ? served() : null));
        mockGetOrCreateProvider.mockReturnValue({ generate: vi.fn(async () => ({ content: "a heading" })) });
        const service = new AIService(memory, admin, "http://admin.local");
        service.noteBrick("brick-1", { isDefault: false, deleted: false, ownerId: "orbit-owner-id" });
        expect(await service.quickGenerate("universe-ai", "sys", "prompt", "brick-1")).toBe("a heading");
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: "orbit-owner-id" });
        // On the map, its owner is the one the map named
        const mapped = new AIService(memory, admin, "http://admin.local");
        mapped.noteRoomBrick("brick-1", { ownerUuid: OWNER, ownerName: "Khalid", roomUrl: "https://play.test/_/a/b/c.tmj" });
        await mapped.quickGenerate("universe-ai", "sys", "prompt", "brick-1");
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: OWNER });
        // The greeting source check is the owner's too
        expect(await service.replySource("universe-ai", "brick-1")).toBe("universe-ai");
        // A person who is named but cannot be told from a stranger is a stranger: Orbit is asked about 'unknown'
        const stranger = new AIService(memory, admin, "http://admin.local");
        stranger.noteBrick("brick-1", ownersBrick);
        expect(await stranger.quickGenerate("universe-ai", "sys", "prompt", "brick-1", undefined, "unknown")).toBe("");
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: "unknown" });
    });

    it("the small calls (a quick line, a classification) name who they are for, so they never run on the owner's key for someone else", async () => {
        const { admin, memory } = build(OTHER, () => served({ forOthers: true }));
        mockGetOrCreateProvider.mockReturnValue({ generate: vi.fn(async () => ({ content: "ok" })) });
        const service = new AIService(memory, admin, "http://admin.local");
        service.noteBrick("brick-1", ownersBrick);
        await service.quickGenerate("universe-ai", "sys", "prompt", "brick-1", undefined, OTHER);
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: OTHER });
        admin.getBotAiCredentials.mockClear();
        const classifier = new AIService(memory, admin, "http://admin.local");
        classifier.noteBrick("brick-1", ownersBrick);
        await classifier.quickClassify("universe-ai", "task", "message", "brick-1", OTHER);
        expect(admin.getBotAiCredentials).toHaveBeenCalledWith("brick-1", { asker: OTHER });
        // And when Orbit has nobody to serve, they come back empty rather than reaching another provider
        admin.getBotAiCredentials.mockResolvedValue(null);
        const fresh = new AIService(memory, admin, "http://admin.local");
        fresh.noteBrick("brick-1", ownersBrick);
        expect(await fresh.quickGenerate("universe-ai", "sys", "prompt", "brick-1", undefined, OTHER)).toBe("");
        expect(admin.getAIProviderCredentials).not.toHaveBeenCalled();
    });
});
