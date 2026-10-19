/**
 * The Claude provider: Claude's own request and answer format, translated to what the bot server already speaks (#975).
 * Every call is a mocked fetch, so what is pinned here is what we send and how we read the answer, not Anthropic itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, callback: (span: any) => any) => callback({ setStatus: vi.fn(), setAttribute: vi.fn() })),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "sk-ant-person") }));
const ownFetch = vi.fn();
vi.mock("../ai/ownComputerFetch", () => ({ ownComputerFetch: (...args: unknown[]) => ownFetch(...args) }));

import { AnthropicProvider } from "../ai/providers/AnthropicProvider";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import { AIProviderRegistry } from "../ai/AIProviderRegistry";
import type { AIProviderConfig } from "../ai/types";

const config = (extra: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
    providerId: "key-claude",
    name: "My Claude",
    type: "anthropic",
    enabled: true,
    endpoint: "https://api.anthropic.com/v1",
    apiKeyEncrypted: "iv:tag:data",
    model: "claude-sonnet-4-5",
    temperature: 0.7,
    maxTokens: 300,
    supportsStreaming: true,
    settings: {},
    ...extra,
});

function events(list: Array<Record<string, unknown>>): Response {
    const text = list.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
        },
    });
    return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

const textStream = (text: string, extra: Array<Record<string, unknown>> = []) =>
    events([
        { type: "message_start", message: { id: "m", model: "claude-sonnet-4-5", usage: { input_tokens: 25, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
        ...extra,
        { type: "message_stop" },
    ]);

function failure(status: number, message: string, type = "invalid_request_error"): Response {
    const text = JSON.stringify({ type: "error", error: { type, message } });
    return { ok: false, status, text: async () => text } as unknown as Response;
}

async function drain(generator: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe("AnthropicProvider", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        ownFetch.mockReset();
        fetchMock = vi.fn().mockImplementation(async () => textStream("Hello"));
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe("the request", () => {
        it("calls /messages with x-api-key and a version, never a Bearer header", async () => {
            await drain(new AnthropicProvider().generateStream("be kind", "hi", config()));
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe("https://api.anthropic.com/v1/messages");
            expect(init.headers).toEqual({ "Content-Type": "application/json", "x-api-key": "sk-ant-person", "anthropic-version": "2023-06-01" });
            expect(init.headers.Authorization).toBeUndefined();
        });

        it("takes an endpoint with a trailing slash or already ending in /messages", async () => {
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ endpoint: "https://api.anthropic.com/v1/" })));
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ endpoint: "https://api.anthropic.com/v1/messages" })));
            expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["https://api.anthropic.com/v1/messages", "https://api.anthropic.com/v1/messages"]);
        });

        it("puts the system prompt at the top and only the user's message in messages", async () => {
            await drain(new AnthropicProvider().generateStream("be kind", "hi", config()));
            const body = sentBody(fetchMock);
            expect(body).toMatchObject({ model: "claude-sonnet-4-5", system: "be kind", stream: true, max_tokens: 300 });
            expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
        });

        it("sends the temperature to models that take one, clamped to Claude's 0 to 1", async () => {
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ temperature: 1.4 })));
            expect(sentBody(fetchMock).temperature).toBe(1);
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ model: "claude-haiku-4-5", temperature: 0.4 })));
            expect(sentBody(fetchMock, 1).temperature).toBe(0.4);
        });

        it.each(["claude-opus-4-7", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"])(
            "leaves the temperature out for %s, which refuses any value but 1",
            async (model) => {
                await drain(new AnthropicProvider().generateStream("s", "hi", config({ model, temperature: 0.7 })));
                expect(sentBody(fetchMock)).not.toHaveProperty("temperature");
            }
        );

        it("asks current models for the lowest effort and leaves room for thinking in the reply cap", async () => {
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ model: "claude-opus-5-5", maxTokens: 300 })));
            const body = sentBody(fetchMock);
            expect(body.output_config).toEqual({ effort: "low" });
            expect(body.max_tokens).toBe(1024);
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ model: "claude-opus-5-5", maxTokens: 4000 })));
            expect(sentBody(fetchMock, 1).max_tokens).toBe(4000);
        });

        it("sends neither effort nor a raised cap to models older than that", async () => {
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ model: "claude-haiku-4-5", maxTokens: 300 })));
            const body = sentBody(fetchMock);
            expect(body).not.toHaveProperty("output_config");
            expect(body.max_tokens).toBe(300);
        });

        it("converts the bot server's tools to Claude's shape", async () => {
            const tools = [
                { type: "function", function: { name: "go_to", description: "Walk to a place", parameters: { type: "object", properties: { place: { type: "string" } }, required: ["place"] } } },
                { type: "function", function: { name: "wave" } },
                { type: "function", function: {} },
            ];
            await drain(new AnthropicProvider().generateStream("s", "hi", config(), tools));
            const body = sentBody(fetchMock);
            expect(body.tools).toEqual([
                { name: "go_to", description: "Walk to a place", input_schema: { type: "object", properties: { place: { type: "string" } }, required: ["place"] } },
                { name: "wave", description: "", input_schema: { type: "object", properties: {} } },
            ]);
            expect(body.tool_choice).toEqual({ type: "auto" });
        });

        it("sends no tools field when there are no tools", async () => {
            await drain(new AnthropicProvider().generateStream("s", "hi", config(), []));
            expect(sentBody(fetchMock)).not.toHaveProperty("tools");
            expect(sentBody(fetchMock)).not.toHaveProperty("tool_choice");
        });
    });

    describe("pictures", () => {
        it("sends image URLs as image blocks before the text when the model can see", async () => {
            await drain(new AnthropicProvider().generateStream("s", "what is this?", config(), undefined, undefined, ["https://x.test/a.png", "https://x.test/b.jpg"]));
            expect(sentBody(fetchMock).messages[0].content).toEqual([
                { type: "image", source: { type: "url", url: "https://x.test/a.png" } },
                { type: "image", source: { type: "url", url: "https://x.test/b.jpg" } },
                { type: "text", text: "what is this?" },
            ]);
        });

        it("keeps a plain string for a model forced to text-only, and when there are no images", async () => {
            await drain(new AnthropicProvider().generateStream("s", "hi", config({ supportsVision: false }), undefined, undefined, ["https://x.test/a.png"]));
            expect(sentBody(fetchMock).messages[0].content).toBe("hi");
            await drain(new AnthropicProvider().generateStream("s", "hi", config(), undefined, undefined, []));
            expect(sentBody(fetchMock, 1).messages[0].content).toBe("hi");
        });

        it("treats a Claude model as able to see unless a person said no", () => {
            const provider = new AnthropicProvider();
            expect(provider.supportsVision(config({ model: "claude-opus-5-5" }))).toBe(true);
            expect(provider.supportsVision(config({ model: "claude-opus-5-5", supportsVision: false }))).toBe(false);
            expect(provider.supportsVision(config({ model: "some-other-model", supportsVision: true }))).toBe(true);
        });
    });

    describe("a streamed answer", () => {
        it("yields the text as it comes and ends with usage (cached input counted)", async () => {
            fetchMock.mockImplementationOnce(async () =>
                events([
                    { type: "ping" },
                    { type: "message_start", message: { usage: { input_tokens: 20, cache_read_input_tokens: 5, output_tokens: 1 } } },
                    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
                    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
                    { type: "content_block_stop", index: 0 },
                    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
                    { type: "message_stop" },
                ])
            );
            const chunks = await drain(new AnthropicProvider().generateStream("s", "hi", config()));
            expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.content)).toEqual(["Hel", "lo"]);
            const done = chunks[chunks.length - 1];
            expect(done).toMatchObject({ done: true, metadata: { tokensUsed: 34, promptTokens: 25, completionTokens: 9, error: false, truncated: false } });
        });

        it("hands a tool call over whole, with its arguments joined, once its block closes", async () => {
            fetchMock.mockImplementationOnce(async () =>
                events([
                    { type: "message_start", message: { usage: { input_tokens: 10 } } },
                    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "On my way." } },
                    { type: "content_block_stop", index: 0 },
                    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "go_to", input: {} } },
                    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"pla' } },
                    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'ce":"cafe"}' } },
                    { type: "content_block_stop", index: 1 },
                    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
                    { type: "message_stop" },
                ])
            );
            const chunks = await drain(new AnthropicProvider().generateStream("s", "take me to the cafe", config(), [{ type: "function", function: { name: "go_to" } }]));
            const calls = chunks.flatMap((chunk) => chunk.toolCalls ?? []);
            expect(calls).toEqual([{ id: "toolu_1", name: "go_to", arguments: '{"place":"cafe"}' }]);
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: false, completionTokens: 20 });
        });

        it("gives a tool with no arguments an empty object", async () => {
            fetchMock.mockImplementationOnce(async () =>
                events([
                    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_2", name: "wave", input: {} } },
                    { type: "content_block_stop", index: 0 },
                    { type: "message_stop" },
                ])
            );
            const chunks = await drain(new AnthropicProvider().generateStream("s", "wave", config()));
            expect(chunks.flatMap((chunk) => chunk.toolCalls ?? [])).toEqual([{ id: "toolu_2", name: "wave", arguments: "{}" }]);
        });

        it("says a reply was cut off when it hit the cap", async () => {
            fetchMock.mockImplementationOnce(async () =>
                events([
                    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Once upon" } },
                    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 300 } },
                    { type: "message_stop" },
                ])
            );
            const chunks = await drain(new AnthropicProvider().generateStream("s", "story", config()));
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ truncated: true, error: false });
        });

        it("reports a refusal as an error that does not count against the key", async () => {
            fetchMock.mockImplementationOnce(async () =>
                events([
                    { type: "message_delta", delta: { stop_reason: "refusal" }, usage: { output_tokens: 1 } },
                    { type: "message_stop" },
                ])
            );
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config()));
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 400 });
        });

        it("reports a stream that ends before message_stop as an error", async () => {
            fetchMock.mockImplementationOnce(async () =>
                events([{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }])
            );
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config()));
            expect(chunks[chunks.length - 1].metadata?.error).toBe(true);
        });

        it("turns a mid-stream overloaded error into a 529", async () => {
            fetchMock.mockImplementationOnce(async () => events([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config()));
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 529 });
        });
    });

    describe("a failed call", () => {
        it.each([
            [401, "authentication_error", "invalid x-api-key", 401],
            [403, "permission_error", "no access", 403],
            [404, "not_found_error", "model: claude-3-haiku-20240307", 404],
            [429, "rate_limit_error", "slow down", 429],
            [529, "overloaded_error", "Overloaded", 529],
            [500, "api_error", "oops", 500],
        ])("keeps the %s Anthropic answered with, so Orbit can tell a rejected key from a busy server", async (status, type, message, expected) => {
            fetchMock.mockImplementationOnce(async () => failure(status, message, type));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config()));
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: expected });
        });

        it("reads Anthropic's low-credit 400 as the out-of-credit 402", async () => {
            fetchMock.mockImplementationOnce(async () => failure(400, "Your credit balance is too low to access the Anthropic API."));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config()));
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 402 });
        });

        it("leaves an ordinary 400 as a 400", async () => {
            fetchMock.mockImplementationOnce(async () => failure(400, "messages: text content blocks must be non-empty"));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config()));
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 400 });
        });

        it("asks again without the temperature when a model refuses it, once", async () => {
            fetchMock.mockImplementationOnce(async () => failure(400, "`temperature` may only be set to 1 for this model"));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config({ model: "claude-future-9", temperature: 0.5 })));
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(sentBody(fetchMock, 0).temperature).toBe(0.5);
            expect(sentBody(fetchMock, 1)).not.toHaveProperty("temperature");
            expect(chunks[chunks.length - 1].metadata?.error).toBe(false);
        });

        it("asks again without the effort when a model refuses it", async () => {
            fetchMock.mockImplementationOnce(async () => failure(400, "output_config.effort: this model does not support effort"));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config({ model: "claude-opus-5-5" })));
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(sentBody(fetchMock, 1)).not.toHaveProperty("output_config");
            expect(chunks[chunks.length - 1].metadata?.error).toBe(false);
        });

        it("does not keep asking: a second refusal is the answer", async () => {
            fetchMock.mockImplementation(async () => failure(400, "temperature is not allowed"));
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config({ model: "claude-future-9" })));
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(chunks[chunks.length - 1].metadata).toMatchObject({ error: true, errorStatus: 400 });
        });

        it("fails clearly, with no call at all, when the provider has no key", async () => {
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config({ apiKeyEncrypted: null })));
            expect(fetchMock).not.toHaveBeenCalled();
            expect(chunks[chunks.length - 1].metadata?.error).toBe(true);
        });

        it("is not an error when the caller cancelled", async () => {
            const controller = new AbortController();
            controller.abort();
            fetchMock.mockImplementationOnce(async () => {
                throw new Error("aborted");
            });
            const chunks = await drain(new AnthropicProvider().generateStream("s", "x", config(), undefined, controller.signal));
            expect(chunks[chunks.length - 1].metadata?.error).toBe(false);
        });
    });

    describe("a whole answer (not streamed)", () => {
        const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => "" }) as unknown as Response;

        it("joins the text blocks and reports usage", async () => {
            fetchMock.mockImplementationOnce(async () =>
                json({ content: [{ type: "text", text: "Hello " }, { type: "text", text: "there" }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 4 }, model: "claude-sonnet-4-5" })
            );
            const result = await new AnthropicProvider().generate("s", "hi", config());
            expect(result).toMatchObject({ content: "Hello there", tokensUsed: 16, error: false, truncated: false });
            expect(sentBody(fetchMock).stream).toBe(false);
        });

        it("says a reply was cut off at the cap", async () => {
            fetchMock.mockImplementationOnce(async () => json({ content: [{ type: "text", text: "Once" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } }));
            expect((await new AnthropicProvider().generate("s", "hi", config())).truncated).toBe(true);
        });

        it("answers an error as an error, never as an empty good reply", async () => {
            fetchMock.mockImplementationOnce(async () => failure(401, "invalid x-api-key", "authentication_error"));
            expect(await new AnthropicProvider().generate("s", "hi", config())).toMatchObject({ content: "", error: true });
        });
    });

    describe("a key whose address a person typed", () => {
        it("goes through the address guard, and a hosted one through the plain fetch", async () => {
            ownFetch.mockImplementation(async () => textStream("hi"));
            await drain(new AnthropicProvider().generateStream("s", "x", config({ ownKey: { addressTyped: true }, endpoint: "https://proxy.example.com/v1" })));
            expect(ownFetch).toHaveBeenCalledTimes(1);
            expect(fetchMock).not.toHaveBeenCalled();
            await drain(new AnthropicProvider().generateStream("s", "x", config({ ownKey: { addressTyped: false } })));
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });
});

describe("the registry", () => {
    it("builds the Claude provider for type anthropic, and still the same ones for openai and lmstudio", () => {
        const registry = new AIProviderRegistry();
        expect(registry.getOrCreateProvider(config({ providerId: "a", type: "anthropic" }))).toBeInstanceOf(AnthropicProvider);
        expect(registry.getOrCreateProvider(config({ providerId: "b", type: "openai" }))).toBeInstanceOf(OpenAIProvider);
        expect(registry.getOrCreateProvider(config({ providerId: "c", type: "lmstudio" }))).toBeInstanceOf(LMStudioProvider);
    });

    it("asks Claude for vision through the registry like any other provider", () => {
        const registry = new AIProviderRegistry();
        expect(registry.supportsVision(config({ providerId: "d", model: "claude-opus-5-5" }))).toBe(true);
    });

    it("streams a Claude answer through the registry", async () => {
        const original = global.fetch;
        global.fetch = vi.fn().mockImplementation(async () => textStream("Hi")) as unknown as typeof fetch;
        try {
            const registry = new AIProviderRegistry();
            const chunks = await drain(registry.generateStream("e", "s", "hi", config({ providerId: "e" })));
            expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.content)).toEqual(["Hi"]);
        } finally {
            global.fetch = original;
        }
    });
});
