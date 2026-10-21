/**
 * Hide bot conversations (#1166, Orbit #435).
 *
 * A private bot sends no text to PostHog, no conversation or player ids to Sentry spans and no transcript to Orbit.
 * What it remembers (memory), its usage counts and everything else work exactly as before, and a bot that is not
 * private (the default, or when Orbit cannot say) behaves exactly as it did before this setting existed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => {
    const parentSpan = {
        end: vi.fn(),
        setAttribute: vi.fn(),
        spanContext: vi.fn(() => ({ spanId: "test-span-id", traceId: "test-trace-id" })),
    };
    return {
        parentSpan,
        scope: { setConversationId: vi.fn() },
        captureAiGeneration: vi.fn(),
        captureAiTrace: vi.fn(),
        flushPostHog: vi.fn(),
        generateStream: vi.fn(),
        axios: { get: vi.fn(), post: vi.fn(), put: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
    };
});

vi.mock("@sentry/node", () => ({
    startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(hoisted.parentSpan)),
    startInactiveSpan: vi.fn(),
    getCurrentScope: vi.fn(() => hoisted.scope),
    getActiveSpan: vi.fn(() => null),
    setConversationId: vi.fn(),
}));
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock("../ai/PostHogClient", () => ({
    captureAiGeneration: hoisted.captureAiGeneration,
    captureAiTrace: hoisted.captureAiTrace,
    flushPostHog: hoisted.flushPostHog,
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({ generateStream: hoisted.generateStream })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn().mockResolvedValue({ tools: [], toolServerMap: new Map() }),
        executeToolCall: vi.fn().mockResolvedValue({ content: [] }),
        clearCache: vi.fn(),
    },
}));
vi.mock("axios", () => ({ default: hoisted.axios, ...hoisted.axios }));

async function* plainAnswer() {
    yield { content: "Hello there.", done: false };
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 33, promptTokens: 30, completionTokens: 3, latency: 10, error: false, truncated: false },
    };
}

// A turn where the bot uses a tool: the initial call, the tool, then a follow-up call (each its own $ai_generation)
async function* toolCall() {
    yield { content: "", done: false, toolCalls: [{ id: "call_1", name: "get_bot_position", arguments: "{}" }] };
    yield { content: "", done: true, metadata: { tokensUsed: 110, promptTokens: 100, completionTokens: 10, latency: 20, error: false, truncated: false } };
}
async function* followUp() {
    yield { content: "I'm by the fountain.", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 220, promptTokens: 200, completionTokens: 20, latency: 30, error: false, truncated: false } };
}

async function drain(generator: AsyncGenerator<any>): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

function adminApiMock(isBotPrivate?: (botId: string) => Promise<boolean>) {
    return {
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
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
        ...(isBotPrivate ? { isBotPrivate: vi.fn(isBotPrivate) } : {}),
    } as any;
}

async function runTurn(adminApi: any) {
    const { AIService } = await import("../ai/AIService");
    const memory: any = { getMemory: vi.fn(() => ({ userUuid: "test-uuid" })) };
    const service = new AIService(memory, adminApi, "http://admin.local");
    return drain(service.generateBotResponseStream("bot-1", 42, "my secret plan", "You are a bot.", "test-provider", "space-1", ""));
}

const attributeNames = () => hoisted.parentSpan.setAttribute.mock.calls.map((call) => call[0]);

describe("AIService: PostHog and Sentry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.generateStream.mockReset().mockImplementation(plainAnswer);
        hoisted.flushPostHog.mockResolvedValue(undefined);
    });
    afterEach(() => vi.resetModules());

    describe("not private (how every bot works today)", () => {
        it.each([
            ["the setting is off", () => adminApiMock(async () => false)],
            ["Orbit's answer is not available at all (no such method)", () => adminApiMock()],
            ["asking throws", () => adminApiMock(async () => { throw new Error("boom"); })],
        ])("sends PostHog events and the full Sentry span when %s", async (_name, make) => {
            const adminApi = make();
            const chunks = await runTurn(adminApi);

            expect(chunks.some((chunk) => chunk.content === "Hello there.")).toBe(true);
            expect(hoisted.captureAiGeneration).toHaveBeenCalledTimes(1);
            expect(hoisted.captureAiGeneration.mock.calls[0][0]).toMatchObject({ input: expect.stringContaining("my secret plan"), output: "Hello there.", playerId: "42", space: "space-1" });
            expect(hoisted.captureAiTrace).toHaveBeenCalledTimes(1);
            expect(hoisted.captureAiTrace.mock.calls[0][0]).toMatchObject({ input: "my secret plan", output: "Hello there.", sessionId: "conversation-bot-1-player-42" });
            expect(hoisted.flushPostHog).toHaveBeenCalled();
            expect(hoisted.scope.setConversationId).toHaveBeenCalledWith("conversation-bot-1-player-42");
            expect(attributeNames()).toEqual(expect.arrayContaining(["bot.player_id", "bot.universe", "bot.world", "bot.room", "bot.provider", "bot.model", "bot.space"]));
            expect(adminApi.trackAIUsage).toHaveBeenCalledTimes(1);
        });
    });

    it("keeps sending every PostHog event of a tool turn when the bot is not private", async () => {
        hoisted.generateStream.mockReset().mockImplementationOnce(toolCall).mockImplementationOnce(followUp);
        await runTurn(adminApiMock(async () => false));
        expect(hoisted.captureAiGeneration.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(hoisted.captureAiTrace).toHaveBeenCalledTimes(1);
    });

    describe("private", () => {
        it("sends nothing to PostHog and no conversation, player or place ids to the Sentry span", async () => {
            const adminApi = adminApiMock(async () => true);
            const chunks = await runTurn(adminApi);

            expect(adminApi.isBotPrivate).toHaveBeenCalledWith("bot-1");
            expect(hoisted.captureAiGeneration).not.toHaveBeenCalled();
            expect(hoisted.captureAiTrace).not.toHaveBeenCalled();
            expect(hoisted.flushPostHog).not.toHaveBeenCalled();
            expect(hoisted.scope.setConversationId).toHaveBeenCalledTimes(1);
            expect(hoisted.scope.setConversationId).toHaveBeenCalledWith(null);
            const names = attributeNames();
            for (const hidden of ["bot.player_id", "bot.universe", "bot.world", "bot.room", "bot.space"]) {
                expect(names).not.toContain(hidden);
            }
            // The span itself still exists with its provider and model, so latency and token charts keep working
            expect(names).toEqual(expect.arrayContaining(["bot.provider", "bot.model"]));
            expect(hoisted.parentSpan.end).toHaveBeenCalled();
            expect(chunks.some((chunk) => chunk.content === "Hello there.")).toBe(true);
        });

        it("sends nothing to PostHog on a turn that uses a tool either (initial call, tool, follow-up)", async () => {
            hoisted.generateStream.mockReset().mockImplementationOnce(toolCall).mockImplementationOnce(followUp);
            await runTurn(adminApiMock(async () => true));
            expect(hoisted.generateStream).toHaveBeenCalledTimes(2);
            expect(hoisted.captureAiGeneration).not.toHaveBeenCalled();
            expect(hoisted.captureAiTrace).not.toHaveBeenCalled();
            expect(hoisted.flushPostHog).not.toHaveBeenCalled();
        });

        it("sends nothing to PostHog on a turn with two tool rounds (the follow-up that calls a tool again)", async () => {
            async function* followUpWithTool() {
                yield { content: "Let me look again.", done: false };
                yield { content: "", done: false, toolCalls: [{ id: "call_2", name: "get_bot_position", arguments: "{}" }] };
                yield { content: "", done: true, metadata: { tokensUsed: 150, promptTokens: 140, completionTokens: 10, latency: 20, error: false, truncated: false } };
            }
            hoisted.generateStream.mockReset().mockImplementationOnce(toolCall).mockImplementationOnce(followUpWithTool).mockImplementation(followUp);
            await runTurn(adminApiMock(async () => true));
            expect(hoisted.generateStream.mock.calls.length).toBeGreaterThanOrEqual(3);
            expect(hoisted.captureAiGeneration).not.toHaveBeenCalled();
            expect(hoisted.captureAiTrace).not.toHaveBeenCalled();
        });

        it("still counts the usage in Orbit, with the same numbers", async () => {
            const adminApi = adminApiMock(async () => true);
            await runTurn(adminApi);

            expect(adminApi.trackAIUsage).toHaveBeenCalledTimes(1);
            expect(adminApi.trackAIUsage.mock.calls[0][0]).toMatchObject({ botId: "bot-1", promptTokens: 30, completionTokens: 3, tokensUsed: 33, apiCalls: 1 });
        });

        it("does not put the person's words anywhere it hands to PostHog or Sentry", async () => {
            await runTurn(adminApiMock(async () => true));
            const everything = JSON.stringify([hoisted.captureAiGeneration.mock.calls, hoisted.captureAiTrace.mock.calls, hoisted.parentSpan.setAttribute.mock.calls, hoisted.scope.setConversationId.mock.calls]);
            expect(everything).not.toContain("my secret plan");
            expect(everything).not.toContain("player-42");
        });
    });
});

describe("AdminApiService.isBotPrivate", () => {
    let service: any;
    const answer = (hidden: boolean) => ({ data: { botId: "bot-1", universeHides: false, choice: "follow", hidden } });

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
        vi.clearAllMocks();
        hoisted.axios.get.mockReset();
        process.env.BOT_SERVICE_TOKEN = "service-secret";
        const { AdminApiService } = await import("../server/AdminApiService");
        service = new AdminApiService("http://orbit.local", "admin-secret");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.resetModules();
        delete process.env.BOT_SERVICE_TOKEN;
    });

    it("asks Orbit with the service token and says whether the bot is private", async () => {
        hoisted.axios.get.mockResolvedValue(answer(true));
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        expect(hoisted.axios.get).toHaveBeenCalledWith("http://orbit.local/api/bots/bot-1/privacy", expect.objectContaining({ headers: { Authorization: "Bearer service-secret" } }));
    });

    it("falls back to the admin token when there is no service token", async () => {
        delete process.env.BOT_SERVICE_TOKEN;
        hoisted.axios.get.mockResolvedValue(answer(false));
        expect(await service.isBotPrivate("bot-1")).toBe(false);
        expect(hoisted.axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { Authorization: "Bearer admin-secret" } }));
    });

    it("asks once per 30 seconds, then picks up a change", async () => {
        hoisted.axios.get.mockResolvedValueOnce(answer(false)).mockResolvedValueOnce(answer(true));
        expect(await service.isBotPrivate("bot-1")).toBe(false);
        expect(await service.isBotPrivate("bot-1")).toBe(false);
        expect(hoisted.axios.get).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(31_000);
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        expect(hoisted.axios.get).toHaveBeenCalledTimes(2);
    });

    it("sends one request when several messages ask at the same moment", async () => {
        hoisted.axios.get.mockResolvedValue(answer(true));
        const results = await Promise.all([service.isBotPrivate("bot-1"), service.isBotPrivate("bot-1"), service.isBotPrivate("bot-1")]);
        expect(results).toEqual([true, true, true]);
        expect(hoisted.axios.get).toHaveBeenCalledTimes(1);
    });

    it("keeps the last answer, and tries again soon, when Orbit cannot answer", async () => {
        hoisted.axios.get.mockResolvedValueOnce(answer(true));
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        vi.advanceTimersByTime(31_000);
        hoisted.axios.get.mockRejectedValueOnce({ isAxiosError: true, message: "timeout", response: undefined });
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        vi.advanceTimersByTime(6_000);
        hoisted.axios.get.mockResolvedValueOnce(answer(false));
        expect(await service.isBotPrivate("bot-1")).toBe(false);
    });

    it("counts as private until Orbit answers, when it has never answered (down, timeout or refused)", async () => {
        for (const failure of [
            { isAxiosError: true, message: "down", response: { status: 502 } },
            { isAxiosError: true, message: "timeout", response: undefined },
            { isAxiosError: true, message: "refused", response: { status: 401 } },
        ]) {
            const { AdminApiService } = await import("../server/AdminApiService");
            const fresh: any = new AdminApiService("http://orbit.local", "admin-secret");
            hoisted.axios.get.mockReset().mockRejectedValue(failure);
            expect(await fresh.isBotPrivate("bot-1")).toBe(true);
        }
    });

    it("picks up \"not private\" as soon as Orbit answers after an outage at start", async () => {
        hoisted.axios.get.mockRejectedValueOnce({ isAxiosError: true, message: "down", response: { status: 502 } });
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        vi.advanceTimersByTime(6_000);
        hoisted.axios.get.mockResolvedValueOnce(answer(false));
        expect(await service.isBotPrivate("bot-1")).toBe(false);
    });

    it("keeps a known \"not private\" through an outage (no change for bots Orbit has already answered for)", async () => {
        hoisted.axios.get.mockResolvedValueOnce(answer(false));
        expect(await service.isBotPrivate("bot-1")).toBe(false);
        vi.advanceTimersByTime(31_000);
        hoisted.axios.get.mockRejectedValueOnce({ isAxiosError: true, message: "down", response: { status: 502 } });
        expect(await service.isBotPrivate("bot-1")).toBe(false);
    });

    it("is not private for a bot Orbit does not know, or an Orbit without the setting yet", async () => {
        hoisted.axios.get.mockRejectedValue({ isAxiosError: true, message: "nope", response: { status: 404 } });
        expect(await service.isBotPrivate("bot-1")).toBe(false);
        hoisted.axios.get.mockClear();
        expect(await service.isBotPrivate("bot-1")).toBe(false);
        expect(hoisted.axios.get).not.toHaveBeenCalled();
    });

    it("passes on each Forget's id, and drops malformed rows", async () => {
        const forgotten: unknown[] = [];
        service.setForgetHandler((botId: string, notice: unknown) => forgotten.push([botId, notice]));
        const rows = [{ id: "f1", userUuid: "uuid-bob" }, { id: "f2", userUuid: null }, { id: 3, userUuid: "x" }, { id: "f4", userUuid: 5 }, null];
        hoisted.axios.get.mockResolvedValue({ data: { hidden: true, forget: { everyone: true, userUuids: ["uuid-bob"], rows } } });
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        expect(forgotten).toEqual([
            ["bot-1", { everyone: true, userUuids: ["uuid-bob"], rows: [{ id: "f1", userUuid: "uuid-bob" }, { id: "f2", userUuid: null }] }],
        ]);
    });

    it("hands the people Orbit says to forget to the forget handler, and answers as usual", async () => {
        const forgotten: unknown[] = [];
        service.setForgetHandler((botId: string, notice: unknown) => forgotten.push([botId, notice]));
        hoisted.axios.get.mockResolvedValue({ data: { hidden: true, forget: { everyone: false, userUuids: ["uuid-bob", 7] } } });
        expect(await service.isBotPrivate("bot-1")).toBe(true);
        expect(forgotten).toEqual([["bot-1", { everyone: false, userUuids: ["uuid-bob"] }]]);
    });

    it("ignores an answer with nobody to forget, a malformed one, and a handler that fails", async () => {
        const handler = vi.fn(() => { throw new Error("boom"); });
        service.setForgetHandler(handler);
        for (const forget of [undefined, null, "bob", [], { everyone: false, userUuids: [] }]) {
            hoisted.axios.get.mockResolvedValueOnce({ data: { hidden: false, forget } });
            expect(await service.isBotPrivate("bot-1", { fresh: true })).toBe(false);
        }
        expect(handler).not.toHaveBeenCalled();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        hoisted.axios.get.mockResolvedValueOnce({ data: { hidden: true, forget: { everyone: true } } });
        expect(await service.isBotPrivate("bot-1", { fresh: true })).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("asks again straight away when told to (the 30-second check), instead of waiting for the cache", async () => {
        hoisted.axios.get.mockResolvedValue(answer(false));
        await service.isBotPrivate("bot-1");
        await service.isBotPrivate("bot-1", { fresh: true });
        expect(hoisted.axios.get).toHaveBeenCalledTimes(2);
    });

    it("checks every running bot every 30 seconds, and stops when told", async () => {
        hoisted.axios.get.mockResolvedValue(answer(false));
        const running = new Map([["bot-1", 1], ["bot-2", 2]]);
        service.startPrivacySync(() => running.keys());
        service.startPrivacySync(() => running.keys()); // a second start does not double it
        await vi.advanceTimersByTimeAsync(30_000);
        expect(hoisted.axios.get.mock.calls.map((call) => call[0]).sort()).toEqual(["http://orbit.local/api/bots/bot-1/privacy", "http://orbit.local/api/bots/bot-2/privacy"]);
        running.delete("bot-1");
        hoisted.axios.get.mockClear();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(hoisted.axios.get).toHaveBeenCalledTimes(1);
        service.stopPrivacySync();
        hoisted.axios.get.mockClear();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(hoisted.axios.get).not.toHaveBeenCalled();
    });

    it("does not check anything when the bot server is not connected to Orbit", async () => {
        const { AdminApiService } = await import("../server/AdminApiService");
        const unconnected = new AdminApiService("", "");
        unconnected.startPrivacySync(() => ["bot-1"]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(hoisted.axios.get).not.toHaveBeenCalled();
    });

    it("is not private, and asks nobody, when the bot server is not connected to Orbit", async () => {
        const { AdminApiService } = await import("../server/AdminApiService");
        const unconnected = new AdminApiService("", "");
        expect(await unconnected.isBotPrivate("bot-1")).toBe(false);
        expect(hoisted.axios.get).not.toHaveBeenCalled();
    });
});

describe("ConversationStorage: transcripts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.axios.post.mockReset().mockResolvedValue({ data: { conversationId: "c-1", status: "created" } });
        hoisted.axios.put.mockReset().mockResolvedValue({ data: {} });
        process.env.BOT_SERVICE_TOKEN = "service-secret";
    });
    afterEach(() => {
        delete process.env.BOT_SERVICE_TOKEN;
    });

    async function storage(isBotPrivate?: () => Promise<boolean>) {
        const { ConversationStorage } = await import("../memory/ConversationStorage");
        const admin: any = { isConfigured: () => true, adminApiUrl: "http://orbit.local", ...(isBotPrivate ? { isBotPrivate: vi.fn(isBotPrivate) } : {}) };
        return new ConversationStorage(admin);
    }

    it("saves the transcript as before when the bot is not private", async () => {
        // Orbit gets the live conversation object, so keep a copy of what each call carried
        const sent: Array<{ method: string; url: string; body: any }> = [];
        hoisted.axios.post.mockImplementation(async (url: string, body: any) => {
            sent.push({ method: "post", url, body: JSON.parse(JSON.stringify(body)) });
            return { data: { conversationId: "c-1", status: "created" } };
        });
        hoisted.axios.put.mockImplementation(async (url: string, body: any) => {
            sent.push({ method: "put", url, body: JSON.parse(JSON.stringify(body)) });
            return { data: {} };
        });
        const conversations = await storage(async () => false);
        await conversations.addMessage("bot-1", "uuid-bob", "hello", "person");
        await conversations.addMessage("bot-1", "uuid-bob", "hi Bob", "bot");
        await conversations.endConversation("bot-1", "uuid-bob", "user_left");
        expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
            "post http://orbit.local/api/bots/bot-1/conversations",
            "put http://orbit.local/api/bots/bot-1/conversations/c-1",
            "put http://orbit.local/api/bots/bot-1/conversations/c-1",
            "put http://orbit.local/api/bots/bot-1/conversations/c-1",
        ]);
        expect(sent[0].body.messages).toHaveLength(1);
        expect(sent[2].body.messages.map((m: any) => m.message)).toEqual(["hello", "hi Bob"]);
        expect(sent[3].body).toMatchObject({ endReason: "user_left" });
    });

    it("saves it as before when Orbit's answer is not available (no such method)", async () => {
        const conversations = await storage();
        await conversations.addMessage("bot-1", "uuid-bob", "hello", "person");
        expect(hoisted.axios.post).toHaveBeenCalledTimes(1);
    });

    it("saves no transcript, and keeps none in memory, when the bot is private", async () => {
        const conversations = await storage(async () => true);
        conversations.startConversation("bot-1", "uuid-bob", { name: "Bob", isLogged: true });
        await conversations.addMessage("bot-1", "uuid-bob", "my secret plan", "person");
        await conversations.addMessage("bot-1", "uuid-bob", "noted", "bot");
        await conversations.endConversation("bot-1", "uuid-bob", "user_left");
        expect(hoisted.axios.post).not.toHaveBeenCalled();
        expect(hoisted.axios.put).not.toHaveBeenCalled();
        expect(JSON.stringify([...(conversations as any).activeConversations.values()])).not.toContain("my secret plan");
    });

    it("stops sending once a bot turns private in the middle of a conversation", async () => {
        const sent: string[] = [];
        hoisted.axios.post.mockImplementation(async (_url: string, body: any) => {
            sent.push(JSON.stringify(body));
            return { data: { conversationId: "c-1", status: "created" } };
        });
        hoisted.axios.put.mockImplementation(async (_url: string, body: any) => {
            sent.push(JSON.stringify(body));
            return { data: {} };
        });
        let hidden = false;
        const conversations = await storage(async () => hidden);
        await conversations.addMessage("bot-1", "uuid-bob", "hello", "person");
        const sentBefore = sent.length;
        hidden = true;
        await conversations.addMessage("bot-1", "uuid-bob", "my secret plan", "person");
        await conversations.endConversation("bot-1", "uuid-bob", "user_left");
        expect(sent.length).toBe(sentBefore);
        expect(sent.join("")).not.toContain("my secret plan");
    });

    describe("while Orbit has not answered yet after a start (#1217)", () => {
        const down = () => Promise.reject({ isAxiosError: true, message: "connect ECONNREFUSED", response: undefined });

        async function startedWhileOrbitIsDown() {
            const sent: any[] = [];
            let orbit: "down" | "normal" | "private" = "down";
            hoisted.axios.get.mockReset().mockImplementation(async () => (orbit === "down" ? down() : { data: { hidden: orbit === "private" } }));
            hoisted.axios.post.mockImplementation(async (_url: string, body: any) => {
                if (orbit === "down") return down();
                sent.push(JSON.parse(JSON.stringify(body)));
                return { data: { conversationId: "c-1", status: "created" } };
            });
            hoisted.axios.put.mockImplementation(async (_url: string, body: any) => {
                sent.push(JSON.parse(JSON.stringify(body)));
                return { data: {} };
            });
            const { AdminApiService } = await import("../server/AdminApiService");
            const { ConversationStorage } = await import("../memory/ConversationStorage");
            const admin = new AdminApiService("http://orbit.local", "admin-secret");
            const conversations = new ConversationStorage(admin as any);
            const orbitAnswers = async (setting: "normal" | "private") => {
                orbit = setting;
                await admin.isBotPrivate("bot-1", { fresh: true });
            };
            return { sent, conversations, orbitAnswers };
        }

        it("sends nothing meanwhile, then saves every line of a Normal bot once Orbit says so, as before Hide existed", async () => {
            const { sent, conversations, orbitAnswers } = await startedWhileOrbitIsDown();
            await conversations.addMessage("bot-1", "uuid-bob", "my name is Bob", "person");
            await conversations.addMessage("bot-1", "uuid-bob", "hi Bob", "bot");
            expect(hoisted.axios.post).not.toHaveBeenCalled();
            await orbitAnswers("normal");
            await conversations.addMessage("bot-1", "uuid-bob", "what is my name?", "person");
            expect(sent[sent.length - 1].messages.map((m: any) => m.message)).toEqual(["my name is Bob", "hi Bob", "what is my name?"]);
        });

        it("saves those lines when the person leaves after Orbit says Normal, with no further line", async () => {
            const { sent, conversations, orbitAnswers } = await startedWhileOrbitIsDown();
            await conversations.addMessage("bot-1", "uuid-bob", "my name is Bob", "person");
            await conversations.addMessage("bot-1", "uuid-bob", "hi Bob", "bot");
            await orbitAnswers("normal");
            await conversations.endConversation("bot-1", "uuid-bob", "user_left");
            const last = sent[sent.length - 1];
            expect(last.messages.map((m: any) => m.message)).toEqual(["my name is Bob", "hi Bob"]);
            expect(last).toMatchObject({ endReason: "user_left" });
            expect((conversations as any).activeConversations.size).toBe(0);
        });

        it("drops those lines, and sends and keeps nothing, when Orbit then says the bot is hidden", async () => {
            const { sent, conversations, orbitAnswers } = await startedWhileOrbitIsDown();
            await conversations.addMessage("bot-1", "uuid-bob", "my secret plan", "person");
            await orbitAnswers("private");
            await conversations.addMessage("bot-1", "uuid-bob", "and another one", "person");
            await conversations.endConversation("bot-1", "uuid-bob", "user_left");
            expect(sent).toEqual([]);
            expect(hoisted.axios.post).not.toHaveBeenCalled();
            expect(hoisted.axios.put).not.toHaveBeenCalled();
            expect((conversations as any).activeConversations.size).toBe(0);
        });
    });
});

describe("memory: always kept, and forgotten when Orbit says so", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.axios.post.mockReset().mockResolvedValue({ data: { success: true } });
        hoisted.axios.get.mockReset();
        process.env.BOT_SERVICE_TOKEN = "service-secret";
    });
    afterEach(() => {
        delete process.env.BOT_SERVICE_TOKEN;
    });

    async function newMemory() {
        const { PersistentMemory } = await import("../memory/PersistentMemory");
        return new PersistentMemory({ adminApiUrl: "http://orbit.local", adminApiToken: "admin-secret" });
    }

    function seed(memory: any, uuid: string, playerId: number) {
        const record: any = {
            playerId,
            userUuid: uuid,
            isGuest: false,
            playerName: uuid,
            conversationHistory: [{ sender: "person", message: "my secret plan", timestamp: 1 }],
            maxHistorySize: 50,
            pendingMedia: [],
            maxPendingMedia: 5,
            personalInfo: { facts: new Map([["plan", "secret"]]) },
            relationship: { firstMet: 1, lastMet: 1, totalConversations: 1, totalMessages: 1, importantEvents: [] },
            emotions: { botEmotion: {}, personEmotion: {}, wounds: [], recentSentiment: 0, lastEmotionUpdate: 1 },
            lastUpdated: 1,
            createdAt: 1,
        };
        memory.memories.set(`bot-1_${playerId}`, record);
        memory.loadedMemoriesByUuid.set(`bot-1_${uuid}`, record);
        memory.pendingSaves.set(`bot-1_${playerId}`, record);
        memory.debounceTimers.set(`bot-1_${playerId}`, setTimeout(() => undefined, 60_000));
        return record;
    }

    it("saves and loads memory with no privacy check at all (a private bot still remembers people)", async () => {
        const { MemoryStorage } = await import("../memory/MemoryStorage");
        const storage = new MemoryStorage({ adminApiUrl: "http://orbit.local", botServiceToken: "service-secret", saveInterval: 1000, maxRetries: 1 });
        const record: any = seed({ memories: new Map(), loadedMemoriesByUuid: new Map(), pendingSaves: new Map(), debounceTimers: new Map() }, "uuid-bob", 7);
        await storage.saveMemories("bot-1", [record]);
        expect(hoisted.axios.post).toHaveBeenCalledTimes(1);
        expect(hoisted.axios.post.mock.calls[0][0]).toBe("http://orbit.local/api/bots/memory/bot-1");
        expect(hoisted.axios.post.mock.calls[0][1].memories[0]).toMatchObject({ userUuid: "uuid-bob", memories: { conversationHistory: [{ message: "my secret plan" }] } });

        hoisted.axios.get.mockResolvedValue({ data: { memories: hoisted.axios.post.mock.calls[0][1].memories } });
        const loaded = await storage.loadMemories("bot-1");
        expect(loaded).toHaveLength(1);
        expect(loaded[0].conversationHistory[0].message).toBe("my secret plan");
    });

    it("changes nothing when a save is answered without a forget list (how every save is answered today)", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        await memory.getMemoryStorage().saveMemories("bot-1", [memory.memories.get("bot-1_7")]);
        expect(memory.memories.has("bot-1_7")).toBe(true);
        expect(memory.loadedMemoriesByUuid.has("bot-1_uuid-bob")).toBe(true);
        expect(memory.pendingSaves.has("bot-1_7")).toBe(true);
    });

    it("drops a forgotten person from every place the bot holds them, and keeps everyone else", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        seed(memory, "uuid-sara", 8);
        hoisted.axios.post.mockResolvedValue({ data: { success: true, forget: { everyone: false, userUuids: ["uuid-bob"] } } });

        await memory.getMemoryStorage().saveMemories("bot-1", [memory.memories.get("bot-1_8")]);

        expect(memory.memories.has("bot-1_7")).toBe(false);
        expect(memory.loadedMemoriesByUuid.has("bot-1_uuid-bob")).toBe(false);
        expect(memory.pendingSaves.has("bot-1_7")).toBe(false);
        expect(memory.debounceTimers.has("bot-1_7")).toBe(false);
        expect(memory.memories.has("bot-1_8")).toBe(true);
        expect(memory.loadedMemoriesByUuid.has("bot-1_uuid-sara")).toBe(true);
        expect(memory.pendingSaves.has("bot-1_8")).toBe(true);
        // Their join key is kept, so the person is remembered fresh from their next message
        expect(memory.getMemoryByUserUuid("bot-1", "uuid-bob")).toBeNull();
    });

    it("drops everybody of that bot when everyone was forgotten, and nobody of another bot", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        seed(memory, "uuid-sara", 8);
        const otherBot: any = { ...memory.memories.get("bot-1_7") };
        memory.memories.set("bot-2_7", otherBot);
        memory.loadedMemoriesByUuid.set("bot-2_uuid-bob", otherBot);
        hoisted.axios.post.mockResolvedValue({ data: { success: true, forget: { everyone: true, userUuids: [] } } });

        await memory.getMemoryStorage().saveMemories("bot-1", [memory.memories.get("bot-1_7")]);

        expect([...memory.memories.keys()]).toEqual(["bot-2_7"]);
        expect([...memory.loadedMemoriesByUuid.keys()]).toEqual(["bot-2_uuid-bob"]);
        expect(memory.pendingSaves.size).toBe(0);
    });

    it("drops a forgotten person when told by the 30-second privacy check, the same way", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        const { AdminApiService } = await import("../server/AdminApiService");
        const admin = new AdminApiService("http://orbit.local", "admin-secret");
        admin.setForgetHandler((botId, notice) => memory.forget(botId, notice));
        hoisted.axios.get.mockResolvedValue({ data: { hidden: true, forget: { everyone: false, userUuids: ["uuid-bob"] } } });
        await admin.isBotPrivate("bot-1", { fresh: true });
        expect(memory.memories.has("bot-1_7")).toBe(false);
        expect(memory.loadedMemoriesByUuid.has("bot-1_uuid-bob")).toBe(false);
    });

    it("applies a Forget once: Orbit repeating it for a minute does not wipe what the person said since", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        const forget = { everyone: false, userUuids: ["uuid-bob"] };
        memory.forget("bot-1", forget);
        expect(memory.memories.has("bot-1_7")).toBe(false);

        // Bob keeps talking; Orbit's next answers (a save, the 30-second check) still carry the same Forget
        seed(memory, "uuid-bob", 7);
        memory.forget("bot-1", forget);
        memory.forget("bot-1", { everyone: false, userUuids: ["uuid-bob"] });
        expect(memory.memories.has("bot-1_7")).toBe(true);
        expect(memory.loadedMemoriesByUuid.has("bot-1_uuid-bob")).toBe(true);
        expect(memory.pendingSaves.has("bot-1_7")).toBe(true);
    });

    it("applies a repeated Forget-everyone once too, but a new person in a later notice is still forgotten", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        memory.forget("bot-1", { everyone: true, userUuids: [] });
        seed(memory, "uuid-bob", 7);
        seed(memory, "uuid-sara", 8);
        memory.forget("bot-1", { everyone: true, userUuids: ["uuid-sara"] });
        expect(memory.memories.has("bot-1_7")).toBe(true);
        expect(memory.memories.has("bot-1_8")).toBe(false);
    });

    it("applies a second Forget of the same person within the minute, told apart from a repeat by its id", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        const first = { everyone: false, userUuids: ["uuid-bob"], rows: [{ id: "f1", userUuid: "uuid-bob" }] };
        memory.forget("bot-1", first);
        expect(memory.memories.has("bot-1_7")).toBe(false);

        // Bob keeps talking; Orbit repeats the first Forget: what he said since stays
        seed(memory, "uuid-bob", 7);
        memory.forget("bot-1", first);
        expect(memory.memories.has("bot-1_7")).toBe(true);

        // The manager presses Forget on Bob again: Orbit sends both rows, and the new one is applied
        memory.forget("bot-1", { ...first, rows: [...first.rows, { id: "f2", userUuid: "uuid-bob" }] });
        expect(memory.memories.has("bot-1_7")).toBe(false);
        expect(memory.pendingSaves.has("bot-1_7")).toBe(false);
    });

    it("applies a Forget-everyone row once, and a new one for everyone again", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        const first = { everyone: true, userUuids: [], rows: [{ id: "f1", userUuid: null }] };
        memory.forget("bot-1", first);
        seed(memory, "uuid-bob", 7);
        memory.forget("bot-1", first);
        expect(memory.memories.has("bot-1_7")).toBe(true);
        memory.forget("bot-1", { ...first, rows: [{ id: "f1", userUuid: null }, { id: "f3", userUuid: null }] });
        expect(memory.memories.has("bot-1_7")).toBe(false);
    });

    it("applies the same Forget again once Orbit has long stopped repeating it (a new Forget later)", async () => {
        vi.useFakeTimers();
        try {
            const memory: any = await newMemory();
            seed(memory, "uuid-bob", 7);
            memory.forget("bot-1", { everyone: false, userUuids: ["uuid-bob"] });
            vi.advanceTimersByTime(3 * 60 * 1000);
            seed(memory, "uuid-bob", 7);
            memory.forget("bot-1", { everyone: false, userUuids: ["uuid-bob"] });
            expect(memory.memories.has("bot-1_7")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("forgets someone whose live memory still says temp-<playerId>, by the uuid tracked for them", async () => {
        const memory: any = await newMemory();
        const record = seed(memory, "uuid-bob", 7);
        record.userUuid = "temp-7";
        memory.uuidTracking.set("bot-1_7", { userUuid: "uuid-bob", isLogged: true });
        memory.forget("bot-1", { everyone: false, userUuids: ["uuid-bob"] });
        expect(memory.memories.has("bot-1_7")).toBe(false);
    });

    it("ignores a forget list that is not one, and never turns a good save into a retry", async () => {
        const memory: any = await newMemory();
        seed(memory, "uuid-bob", 7);
        for (const forget of ["bob", 5, [], { everyone: "yes" }, { userUuids: "uuid-bob" }, { userUuids: [42, null] }]) {
            hoisted.axios.post.mockClear().mockResolvedValue({ data: { success: true, forget } });
            await memory.getMemoryStorage().saveMemories("bot-1", [memory.memories.get("bot-1_7")]);
            expect(hoisted.axios.post).toHaveBeenCalledTimes(1);
            expect(memory.memories.has("bot-1_7")).toBe(true);
        }
    });
});
