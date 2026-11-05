/**
 * No words in PostHog or Sentry. An AI event carries the model, tokens, cost, latency, an error's status and tool names
 * and counts; never what a person typed or said, what a tool was given or gave back, what was remembered, or what a
 * provider or tool server wrote in an error.
 *
 * The real PostHog client runs here, with only the SDK's capture mocked, so what is checked is what would be sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openToolGate } from "./helpers/openToolGate";

const CANARY = {
    typed: "CANARY-TYPED-pistachio-7731",
    toolArgs: "CANARY-ARGS-hyacinth-4410",
    toolResult: "canary-result-4821@example.com",
    toolError: "CANARY-TOOLERR-marigold-9902",
    memory: "CANARY-MEMORY-walnut-3318",
    provider: "CANARY-PROVIDER-quince-5507",
};

const hoisted = vi.hoisted(() => ({
    posthogCapture: vi.fn(),
    sentryCalls: [] as unknown[][],
    consoleLines: [] as string[],
}));

vi.mock("posthog-node", () => ({ PostHog: vi.fn(() => ({ capture: hoisted.posthogCapture, flush: vi.fn().mockResolvedValue(undefined) })) }));

vi.mock("@sentry/node", () => {
    const span = {
        end: vi.fn(),
        setAttribute: (...args: unknown[]) => hoisted.sentryCalls.push(["setAttribute", ...args]),
        setStatus: (...args: unknown[]) => hoisted.sentryCalls.push(["setStatus", ...args]),
        spanContext: vi.fn(() => ({ spanId: "s", traceId: "t" })),
    };
    return {
        startSpanManual: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(span)),
        startInactiveSpan: vi.fn(),
        getCurrentScope: vi.fn(() => ({ setConversationId: vi.fn() })),
        getActiveSpan: vi.fn(() => null),
        setConversationId: vi.fn(),
        captureException: (...args: unknown[]) => hoisted.sentryCalls.push(["captureException", ...args.map((a) => (a instanceof Error ? { message: a.message, stack: a.stack } : a))]),
    };
});
vi.mock("@sentry/core", () => ({ _INTERNAL_setSpanForScope: vi.fn() }));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "decrypted-key") }));

const mockGenerateStream = vi.fn();
vi.mock("../ai/AIProviderRegistry", () => ({
    AIProviderRegistry: vi.fn().mockImplementation(() => ({
        generateStream: mockGenerateStream,
        getOrCreateProvider: vi.fn(),
        supportsVision: vi.fn(() => false),
    })),
}));
vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));
const mockExecuteToolCall = vi.fn();
vi.mock("../mcp/MCPConnector", () => ({
    MCPConnector: {
        discoverToolsWithMapping: vi.fn(async () => ({
            tools: [{ type: "function", function: { name: "read_mail", description: "Reads mail", parameters: {} } }],
            toolServerMap: new Map([["read_mail", { serverId: "s1", serverUrl: "https://mail.test/mcp", authType: "none", title: "Read mail" }]]),
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

const usage = { tokensUsed: 120, promptTokens: 100, completionTokens: 20, latency: 10, error: false };

function callsTool(name: string, args: Record<string, unknown>) {
    return async function* () {
        yield { content: "", done: false, toolCalls: [{ id: `call-${name}`, name, arguments: JSON.stringify(args) }] };
        yield { content: "", done: true, metadata: usage };
    };
}
function says(text: string) {
    return async function* () {
        yield { content: text, done: false };
        yield { content: "", done: true, metadata: usage };
    };
}
async function* providerFails() {
    yield {
        content: "",
        done: true,
        metadata: { tokensUsed: 0, latency: 10, error: true, errorStatus: 400, errorText: `This request was refused: ${CANARY.provider}` },
    };
}

async function drain(generator: AsyncGenerator<any>): Promise<void> {
    for await (const _chunk of generator) void _chunk;
}

/** Everything the turn handed to PostHog and Sentry, and every warning or error line (which Sentry Logs keeps). */
const everythingSent = () => JSON.stringify([hoisted.posthogCapture.mock.calls, hoisted.sentryCalls, hoisted.consoleLines]);

describe("AIService: no words reach PostHog or Sentry", () => {
    let AIService: any;
    const consoleSpies: Array<{ mockRestore: () => void }> = [];

    beforeEach(async () => {
        vi.clearAllMocks();
        hoisted.sentryCalls.length = 0;
        hoisted.consoleLines.length = 0;
        mockGenerateStream.mockReset();
        mockExecuteToolCall.mockReset();
        vi.stubEnv("POSTHOG_API_KEY", "phc_test");
        for (const level of ["warn", "error", "log"] as const) {
            const spy = vi.spyOn(console, level);
            spy.mockImplementation((...args: unknown[]) => void hoisted.consoleLines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")));
            consoleSpies.push(spy);
        }
        AIService = (await import("../ai/AIService")).AIService;
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        // Not restoreAllMocks: it would also empty the PostHog constructor mock above
        for (const spy of consoleSpies.splice(0)) spy.mockRestore();
        vi.resetModules();
    });

    const reply = (service: any, message = `Please read my mail ${CANARY.typed}`) =>
        drain(service.generateBotResponseStream("bot-1", 42, message, `You are a bot. You remember: ${CANARY.memory}`, "universe-ai", "!dm:matrix.test", "", undefined, undefined, undefined, undefined, "dm"));

    it("keeps typed words, tool arguments, tool results and memory out of a tool turn, and still sends the figures", async () => {
        const { admin, memory } = buildMocks();
        mockExecuteToolCall.mockResolvedValueOnce({ content: [{ type: "text", text: `From ${CANARY.toolResult}` }] });
        mockGenerateStream
            .mockImplementationOnce(callsTool("read_mail", { query: CANARY.toolArgs }))
            .mockImplementationOnce(says(`Your mail is from ${CANARY.toolResult}`));
        await reply(openToolGate(new AIService(memory, admin, "http://admin.local")));

        const events = hoisted.posthogCapture.mock.calls.map((call) => call[0]);
        expect(events.map((e) => e.event).sort()).toEqual(["$ai_generation", "$ai_generation", "$ai_trace"]);
        const sent = everythingSent();
        for (const canary of Object.values(CANARY)) expect(sent).not.toContain(canary);
        expect(sent).not.toContain("example.com");
        for (const { properties } of events) {
            expect(properties).not.toHaveProperty("$ai_input");
            expect(properties).not.toHaveProperty("$ai_output");
            expect(properties).not.toHaveProperty("$ai_output_choices");
            // The cost and token dashboards read these
            expect(properties).toMatchObject({ $ai_model: "deepseek-v4-flash", $ai_provider: expect.any(String), bot_id: "bot-1" });
            expect(properties.$ai_input_tokens).toEqual(expect.any(Number));
            expect(properties.$ai_output_tokens).toEqual(expect.any(Number));
            expect(properties).toHaveProperty("$ai_latency");
        }
        // Tool names and counts are kept
        const initial = events.find((e) => e.event === "$ai_generation" && e.properties.tool_names);
        expect(initial.properties).toMatchObject({ tool_names: ["read_mail"], tool_call_count: 1 });
        const trace = events.find((e) => e.event === "$ai_trace");
        expect(trace.properties).toMatchObject({ tool_names: ["read_mail"], tool_call_count: 1 });
    });

    it("keeps typed words and the memory out of a plain turn (a typed message or a call alike)", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(says(`You said ${CANARY.typed}`));
        await reply(openToolGate(new AIService(memory, admin, "http://admin.local")), `Hello ${CANARY.typed}`);

        expect(hoisted.posthogCapture).toHaveBeenCalled();
        const sent = everythingSent();
        expect(sent).not.toContain(CANARY.typed);
        expect(sent).not.toContain(CANARY.memory);
    });

    it("keeps only the status of a provider error", async () => {
        const { admin, memory } = buildMocks();
        mockGenerateStream.mockImplementationOnce(providerFails);
        await reply(openToolGate(new AIService(memory, admin, "http://admin.local")));

        const events = hoisted.posthogCapture.mock.calls.map((call) => call[0]);
        expect(events.length).toBeGreaterThan(0);
        for (const { properties } of events) {
            expect(properties).toMatchObject({ $ai_is_error: true, $ai_error: "the provider failed (400)" });
        }
        expect(everythingSent()).not.toContain(CANARY.provider);
    });

    it("keeps the words of a tool's error out of Sentry and the logs", async () => {
        const { admin, memory } = buildMocks();
        mockExecuteToolCall.mockRejectedValueOnce(new Error(`bad request for ${CANARY.toolResult}: ${CANARY.toolError}`));
        mockGenerateStream.mockImplementationOnce(callsTool("read_mail", { query: CANARY.toolArgs })).mockImplementationOnce(says("I could not read it."));
        await reply(openToolGate(new AIService(memory, admin, "http://admin.local")));

        expect(hoisted.sentryCalls.some((call) => call[0] === "captureException")).toBe(true);
        const sent = everythingSent();
        expect(sent).not.toContain(CANARY.toolError);
        expect(sent).not.toContain("example.com");
        expect(sent).not.toContain(CANARY.toolArgs);
    });
});
