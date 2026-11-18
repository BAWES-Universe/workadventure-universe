/**
 * What someone else is offered of its owner's Apps (game #2006, check 32): a Brick standing in a room gives anyone but its owner
 * nothing of the owner's Apps, except the jobs the owner shared, with only the inputs they picked. The rest of the App is not even
 * listed, in the same Brick, and the owner still has all of it.
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
vi.mock("../mcp/MCPConnector", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../mcp/MCPConnector")>()),
    MCPConnector: {
        discoverToolsWithMapping: vi.fn(async () => ({
            tools: [
                {
                    type: "function",
                    function: {
                        name: "generate_music",
                        description: "Makes a song",
                        parameters: { type: "object", properties: { style: { type: "string" }, owner_token: { type: "string" } }, required: ["style"] },
                    },
                },
                { type: "function", function: { name: "delete_song", description: "Deletes a song", parameters: { type: "object", properties: { id: { type: "string" } } } } },
            ],
            toolServerMap: new Map([
                ["generate_music", { serverId: "s1", serverUrl: "https://music.test/mcp", authType: "none", title: "Make a song", connectionId: "conn-1", sharedJob: { inputs: ["style"] } }],
                ["delete_song", { serverId: "s1", serverUrl: "https://music.test/mcp", authType: "none", title: "Delete a song", connectionId: "conn-1" }],
            ]),
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

const toolsSent = () => (mockGenerateStream.mock.calls[0]?.[4] ?? []) as any[];

describe("someone else asking a Brick in a room: only the jobs its owner shared are listed", () => {
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

    it("a visitor is offered the shared job with only the inputs that were picked, and nothing else of the App", async () => {
        const { admin, memory } = build(OTHER, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(toolNamesSent()).toContain("generate_music");
        expect(toolNamesSent()).not.toContain("delete_song");
        const job = toolsSent().find((tool) => tool.function.name === "generate_music");
        expect(Object.keys(job.function.parameters.properties)).toEqual(["style"]);
    });

    it("tells a visitor the shared jobs are the one exception to the owner's things staying the owner's", async () => {
        const { admin, memory } = build(OTHER, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(promptSent()).toContain("NOT TO THIS PERSON");
        expect(promptSent()).toContain("The one exception is the jobs in your list now");
    });

    it("the owner, in the same Brick, is offered all of it as before", async () => {
        const { admin, memory } = build(OWNER, () => served());
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(toolNamesSent()).toEqual(expect.arrayContaining(["generate_music", "delete_song"]));
        const job = toolsSent().find((tool) => tool.function.name === "generate_music");
        expect(Object.keys(job.function.parameters.properties)).toEqual(["style", "owner_token"]);
    });

    it("does not say there are shared jobs when the gate leaves none of them in the list", async () => {
        const { admin, memory } = build(OTHER, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service["toolGate"] = { decide: async () => ({ kind: "run" }), offers: async (call: { tool?: string; toolName?: string }) => (call.tool ?? call.toolName) !== "generate_music" } as never;
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(toolNamesSent()).not.toContain("generate_music");
        expect(promptSent()).toContain("NOT TO THIS PERSON");
        expect(promptSent()).not.toContain("The one exception is the jobs in your list now");
    });

    it("offers the job another App shared when an App that shares nothing has a tool of the same name", async () => {
        const { MCPConnector } = await import("../mcp/MCPConnector");
        const own = { type: "function", function: { name: "generate_music", description: "Makes a song, the plain one", parameters: { type: "object", properties: { style: { type: "string" }, owner_token: { type: "string" } }, required: ["style", "owner_token"] } } };
        const shared = { type: "function", function: { name: "generate_music", description: "Makes a song, the shared one", parameters: { type: "object", properties: { style: { type: "string" }, owner_token: { type: "string" } }, required: ["style"] } } };
        (MCPConnector.discoverToolsWithMapping as any).mockResolvedValueOnce({
            tools: [own],
            toolServerMap: new Map([
                [
                    "generate_music",
                    {
                        serverId: "plain",
                        serverUrl: "https://plain.test/mcp",
                        authType: "none",
                        connectionId: "conn-plain",
                        sharedAlt: { tool: shared, entry: { serverId: "shared", serverUrl: "https://shared.test/mcp", authType: "none", connectionId: "conn-shared", sharedJob: { inputs: ["style"] } } },
                    },
                ],
            ]),
        });
        const { admin, memory } = build(OTHER, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        const job = toolsSent().find((tool) => tool.function.name === "generate_music");
        expect(job.function.description).toBe("Makes a song, the shared one");
        expect(Object.keys(job.function.parameters.properties)).toEqual(["style"]);
        expect(promptSent()).toContain("The one exception is the jobs in your list now");
    });

    it("a person this server cannot name is offered the same, and never more", async () => {
        const { admin, memory } = build(undefined, () => served({ forOthers: true }));
        const service = openToolGate(new AIService(memory, admin, "http://admin.local"));
        service.noteBrick("brick-1", ownersBrick);
        await reply(service);
        expect(toolNamesSent()).toContain("generate_music");
        expect(toolNamesSent()).not.toContain("delete_song");
    });
});
