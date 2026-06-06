/**
 * Tests for AIService Sentry span creation changes (PR: use startSpanManual)
 *
 * Scope: Only tests the changed behavior in this PR:
 *   - Sentry.startSpanManual() is used instead of Sentry.startInactiveSpan()
 *   - forceTransaction: true with correct op/name/attributes
 *   - __sentryParentSpan is forwarded to providers via configWithParent
 *   - parentSpan?.end() is called in the finally block
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock @sentry/node ---
const mockParentSpanEnd = vi.fn();
const mockParentSpanSetAttribute = vi.fn();
const mockParentSpan = {
    end: mockParentSpanEnd,
    setAttribute: mockParentSpanSetAttribute,
};

const mockStartSpanManual = vi.fn((_opts: unknown, callback: (span: any) => any) => {
    return callback(mockParentSpan);
});
const mockGetCurrentScope = vi.fn(() => ({}));
const mockGetActiveSpan = vi.fn(() => null);
const mockSetConversationId = vi.fn();

vi.mock("@sentry/node", () => ({
    startSpanManual: mockStartSpanManual,
    startInactiveSpan: vi.fn(), // should NOT be called
    getCurrentScope: mockGetCurrentScope,
    getActiveSpan: mockGetActiveSpan,
    setConversationId: mockSetConversationId,
}));

// --- Mock @sentry/core ---
const mockSentrySetSpan = vi.fn();
vi.mock("@sentry/core", () => ({
    _INTERNAL_setSpanForScope: mockSentrySetSpan,
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

// ---- Helper: build a minimal async generator that immediately completes ----
async function* minimalStream() {
    yield { content: "hello", done: false };
    yield { content: "", done: true, metadata: { tokensUsed: 10, latency: 50, error: false } };
}

// ---- Build minimal mocks ----
function buildMocks() {
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
        getRoomMetadata: vi.fn().mockResolvedValue(null),
        getAvailableAIProviders: vi.fn().mockResolvedValue([]),
    };

    const mockConversationMemory: any = {};

    return { mockAdminApiService, mockConversationMemory };
}

describe("AIService – Sentry startSpanManual (PR change)", () => {
    let AIService: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset generator mock each test
        mockGenerateStream.mockImplementation(minimalStream);
        // Re-import after mocks are set
        const mod = await import("../ai/AIService");
        AIService = mod.AIService;
    });

    afterEach(() => {
        vi.resetModules();
    });

    it("calls Sentry.startSpanManual (not startInactiveSpan) for a conversation turn", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        const chunks: any[] = [];
        for await (const chunk of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "You are a bot.",
            "test-provider",
            "space-1",
            ""
        )) {
            chunks.push(chunk);
        }

        const Sentry = await import("@sentry/node");
        expect(Sentry.startSpanManual).toHaveBeenCalledTimes(1);
        expect(Sentry.startInactiveSpan).not.toHaveBeenCalled();
    });

    it("passes forceTransaction: true to startSpanManual", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        const [[callOptions]] = mockStartSpanManual.mock.calls;
        expect(callOptions).toMatchObject({ forceTransaction: true });
    });

    it("passes op 'gen_ai.agent' to startSpanManual", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        const [[callOptions]] = mockStartSpanManual.mock.calls;
        expect(callOptions).toMatchObject({ op: "gen_ai.agent" });
    });

    it("names the span 'Bot <config.name>' when config.name is present", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        // The mock returns name "TestBot"
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-xyz",
            1,
            "hi",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        const [[callOptions]] = mockStartSpanManual.mock.calls;
        expect(callOptions.name).toBe("Bot TestBot");
    });

    it("falls back to botId in span name when config.name is empty", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        // Override to return empty name
        mockAdminApiService.getAIProviderCredentials.mockResolvedValue({
            providerId: "test-provider",
            name: "",
            type: "lmstudio",
            enabled: true,
            endpoint: "http://localhost:1234",
            apiKeyEncrypted: null,
            model: "llama3",
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        });

        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "fallback-bot-id",
            1,
            "hi",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        const [[callOptions]] = mockStartSpanManual.mock.calls;
        expect(callOptions.name).toBe("Bot fallback-bot-id");
    });

    it("passes attributes { span_type: 'gen_ai' } to startSpanManual", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        const [[callOptions]] = mockStartSpanManual.mock.calls;
        expect(callOptions.attributes).toEqual({ span_type: "gen_ai" });
    });

    it("does NOT pass parentSpan: null to startSpanManual (removed in PR)", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        const [[callOptions]] = mockStartSpanManual.mock.calls;
        // parentSpan: null was explicitly removed from the options in this PR
        expect(callOptions).not.toHaveProperty("parentSpan");
    });

    it("uses the (span) => span callback pattern with startSpanManual", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        // Verify callback was passed and that it returns the span itself
        const [, callback] = mockStartSpanManual.mock.calls[0];
        expect(typeof callback).toBe("function");
        const testSpan = { dummy: true };
        expect(callback(testSpan)).toBe(testSpan);
    });

    it("sets __sentryParentSpan on the cloned config passed to the provider", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();

        let capturedConfig: any;
        mockGenerateStream.mockImplementation(async function* (
            _providerId: string,
            _system: string,
            _user: string,
            config: any
        ) {
            capturedConfig = config;
            yield { content: "hi", done: false };
            yield { content: "", done: true, metadata: { tokensUsed: 1, latency: 5, error: false } };
        });

        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        // The config passed to providerRegistry.generateStream must have __sentryParentSpan set
        expect(capturedConfig.__sentryParentSpan).toBe(mockParentSpan);
    });

    it("calls parentSpan.end() in the finally block after the stream completes", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        expect(mockParentSpanEnd).toHaveBeenCalledTimes(1);
    });

    it("calls parentSpan.end() even when the stream throws an error", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();

        mockGenerateStream.mockImplementation(async function* () {
            throw new Error("stream failure");
        });

        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        // Should not throw; error is caught internally and yields an error chunk
        const chunks: any[] = [];
        for await (const chunk of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) {
            chunks.push(chunk);
        }

        // parentSpan.end() must have been called despite the error
        expect(mockParentSpanEnd).toHaveBeenCalledTimes(1);
    });

    it("restores the previous active span on the scope after the stream (sentrySetSpan called twice)", async () => {
        const { mockAdminApiService, mockConversationMemory } = buildMocks();
        const prevSpan = { prev: true };
        mockGetActiveSpan.mockReturnValue(prevSpan);

        const service = new AIService(
            mockConversationMemory,
            mockAdminApiService,
            "http://admin.local"
        );

        for await (const _ of service.generateBotResponseStream(
            "bot-1",
            42,
            "hello",
            "",
            "test-provider",
            undefined,
            ""
        )) { /* drain */ }

        // First call sets parentSpan as active; second restores previous
        expect(mockSentrySetSpan).toHaveBeenCalledTimes(2);
        const secondCall = mockSentrySetSpan.mock.calls[1];
        expect(secondCall[1]).toBe(prevSpan);
    });
});