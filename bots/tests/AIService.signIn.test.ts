/**
 * A tool whose sign-in expired (game #1819): the bot is told which, only the people who manage it get the Reconnect
 * card (a private event in a bubble, a chunk for the notice in a direct message), once per outage, and it is taken back
 * once the sign-in is back.
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

// --- Mock MCPConnector: the tool servers' state is whatever each test sets ---
const found = {
    issues: [] as any[],
    /** Server ids Orbit has not been told about yet */
    unreported: new Set<string>(),
};
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn(async () => ({ tools: [], toolServerMap: new Map(), issues: found.issues })),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        noteRefused: vi.fn(),
        clearCache: vi.fn(),
        health: { settled: vi.fn(async () => undefined), isReported: vi.fn((_bot: string, id: string) => !found.unreported.has(id)) },
    },
}));

async function* plainStream() {
    yield { content: "Hi.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 3, promptTokens: 2, completionTokens: 1, latency: 1, error: false, truncated: false } };
}

const EXPIRED = { serverId: "srv-1", name: "Tavily", state: "expired", since: "2026-11-05T09:54:00.000Z", kind: "oauth" };
const QUIET = { serverId: "srv-2", name: "Attio", state: "no-answer", since: "2026-11-05T09:55:00.000Z", kind: "key" };

describe("AIService – a tool whose sign-in expired (#1819)", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGenerateStream.mockReset();
        found.issues = [];
        found.unreported = new Set();
        AIService = (await import("../ai/AIService")).AIService;
    });

    afterEach(() => {
        vi.resetModules();
    });

    function setup(opts: { signedIn?: boolean; manages?: boolean } = {}) {
        const { signedIn = true, manages = true } = opts;
        const admin: any = {
            getAIProviderCredentials: vi.fn().mockResolvedValue({
                providerId: "p", name: "B", type: "openai", enabled: true, endpoint: "https://api.deepseek.com/v1", apiKeyEncrypted: null,
                model: "deepseek-v4-flash", temperature: 0.7, maxTokens: 512, supportsStreaming: true, settings: {},
            }),
            trackAIUsage: vi.fn().mockResolvedValue(undefined),
            getRoomMetadata: vi.fn().mockResolvedValue(null),
            getAvailableAIProviders: vi.fn().mockResolvedValue([]),
            canManageBotTools: vi.fn().mockResolvedValue(manages),
        };
        const botClient: any = {
            getRoomUrl: () => "http://play/_/r/m.json",
            holdSpeech: () => undefined,
            releaseSpeech: () => undefined,
            getPersonForArtifacts: () => ({ signedIn, identifier: signedIn ? "sara@x.test" : null, name: "Sara" }),
            sendAskEvent: vi.fn().mockReturnValue(true),
        };
        const memory = { getMemory: vi.fn(() => ({ userUuid: "sara@x.test", dmRoomId: "!dm:chat", playerName: "Sara" })), getPendingMediaNotice: vi.fn(() => "") };
        const svc = new AIService(memory, admin, "http://admin.local");
        return { svc, admin, botClient };
    }

    async function reply(svc: any, admin: any, botClient: any, channel: "world" | "dm" = "world") {
        mockGenerateStream.mockImplementationOnce(plainStream);
        const chunks: any[] = [];
        const client = channel === "world" ? botClient : undefined;
        for await (const chunk of svc.generateBotResponseStream("bot-7", 42, "hi", "You are Zed.", "p", channel === "world" ? "space-1" : "dm", "", client, admin, undefined, undefined, channel)) chunks.push(chunk);
        const call = mockGenerateStream.mock.calls.at(-1)!;
        return { chunks, systemPrompt: String(call[1]) };
    }

    const signInEvents = (botClient: any) => botClient.sendAskEvent.mock.calls.filter((c: any[]) => c[2].kind === "signin");

    it("tells the bot which tool is down, only when something needs it", async () => {
        found.issues = [EXPIRED];
        const { svc, admin, botClient } = setup({ signedIn: false });
        const { systemPrompt } = await reply(svc, admin, botClient);
        expect(systemPrompt).toContain("Tavily: the sign-in expired");
        expect(systemPrompt).toContain("Only when someone asks for something that needs one of them");
    });

    it("says nothing when every tool works", async () => {
        const { svc, admin, botClient } = setup();
        const { systemPrompt } = await reply(svc, admin, botClient);
        expect(systemPrompt).not.toContain("sign-in expired");
        expect(signInEvents(botClient)).toHaveLength(0);
    });

    it("shows a person who manages the bot the Reconnect card, in the bubble, to them alone", async () => {
        found.issues = [EXPIRED];
        const { svc, admin, botClient } = setup();
        await reply(svc, admin, botClient);
        const events = signInEvents(botClient);
        expect(events).toHaveLength(1);
        expect(events[0][0]).toBe("space-1");
        expect(events[0][1]).toBe(42);
        expect(events[0][2].id).toBe("signin-bot-7");
        expect(JSON.parse(events[0][2].body)).toEqual({ lost: [{ serverId: "srv-1", name: "Tavily", since: EXPIRED.since, kind: "oauth" }] });
        expect(admin.canManageBotTools).toHaveBeenCalledWith("bot-7", "sara@x.test");
    });

    it("shows no card to a member who does not manage the bot, nor to a guest", async () => {
        found.issues = [EXPIRED];
        const member = setup({ manages: false });
        await reply(member.svc, member.admin, member.botClient);
        expect(signInEvents(member.botClient)).toHaveLength(0);
        const guest = setup({ signedIn: false });
        await reply(guest.svc, guest.admin, guest.botClient);
        expect(signInEvents(guest.botClient)).toHaveLength(0);
        expect(guest.admin.canManageBotTools).not.toHaveBeenCalled();
    });

    it("sends the card only once Orbit has the state it shows", async () => {
        found.issues = [EXPIRED];
        found.unreported = new Set(["srv-1"]);
        const { svc, admin, botClient } = setup();
        await reply(svc, admin, botClient);
        expect(signInEvents(botClient)).toHaveLength(0);
        found.unreported = new Set();
        await reply(svc, admin, botClient);
        expect(signInEvents(botClient)).toHaveLength(1);
    });

    it("shows the card again at the next reply when it did not get out", async () => {
        found.issues = [EXPIRED];
        const { svc, admin, botClient } = setup();
        botClient.sendAskEvent.mockReturnValueOnce(false);
        await reply(svc, admin, botClient);
        await reply(svc, admin, botClient);
        await reply(svc, admin, botClient);
        expect(signInEvents(botClient)).toHaveLength(2);
    });

    it("shows no card for a server that only did not answer", async () => {
        found.issues = [QUIET];
        const { svc, admin, botClient } = setup();
        const { systemPrompt } = await reply(svc, admin, botClient);
        expect(signInEvents(botClient)).toHaveLength(0);
        expect(systemPrompt).toContain("Attio: not answering right now");
    });

    it("shows the card once per outage, and takes it back once the sign-in is back", async () => {
        found.issues = [EXPIRED];
        const { svc, admin, botClient } = setup();
        await reply(svc, admin, botClient);
        await reply(svc, admin, botClient);
        expect(signInEvents(botClient)).toHaveLength(1);
        found.issues = [];
        await reply(svc, admin, botClient);
        await reply(svc, admin, botClient);
        const events = signInEvents(botClient);
        expect(events).toHaveLength(2);
        expect(JSON.parse(events[1][2].body)).toEqual({ lost: [] });
    });

    it("hands a direct message the card for its reply to send, to a person who manages the bot", async () => {
        found.issues = [EXPIRED];
        const { svc, admin, botClient } = setup();
        const { chunks } = await reply(svc, admin, botClient, "dm");
        const withCard = chunks.filter((c) => c.toolSignIn);
        expect(withCard).toHaveLength(1);
        expect(withCard[0].toolSignIn.lost[0].name).toBe("Tavily");
        const again = await reply(svc, admin, botClient, "dm");
        expect(again.chunks.filter((c) => c.toolSignIn)).toHaveLength(0);
    });

    it("hands a direct message no card for a person who does not manage the bot", async () => {
        found.issues = [EXPIRED];
        const { svc, admin, botClient } = setup({ manages: false });
        const { chunks } = await reply(svc, admin, botClient, "dm");
        expect(chunks.filter((c) => c.toolSignIn)).toHaveLength(0);
    });
});
