/**
 * Claude's prompt cache (#975): where the markers go, when none is sent, how the cache figures are read, and that no
 * other provider's request changes because of any of it.
 */

import { usageFromMetadata } from "../ai/pricing/ledger";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const span = { setStatus: vi.fn(), setAttribute: vi.fn() };
vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, callback: (span: any) => any) => callback(span)),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "sk-person") }));
vi.mock("../ai/ownComputerFetch", () => ({ ownComputerFetch: vi.fn() }));

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
    model: "claude-sonnet-5-5", // caches from 512 tokens
    temperature: 0.7,
    maxTokens: 300,
    supportsStreaming: true,
    settings: {},
    ...extra,
});

/** n tokens of text by the provider's own count (4 characters each) */
const tokens = (n: number, letter = "a") => letter.repeat(n * 4);

const tool = (name: string, descriptionTokens: number) => ({
    type: "function",
    function: { name, description: tokens(descriptionTokens, "t"), parameters: { type: "object", properties: {} } },
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

const answer = (usage: Record<string, number> = { input_tokens: 25 }, deltaUsage: Record<string, number> = { output_tokens: 7 }) =>
    events([
        { type: "message_start", message: { id: "m", model: "claude-sonnet-5-5", usage: { ...usage, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: deltaUsage },
        { type: "message_stop" },
    ]);

async function drain(generator: AsyncGenerator<any>) {
    const chunks: any[] = [];
    for await (const chunk of generator) chunks.push(chunk);
    return chunks;
}

describe("Claude's cache markers", () => {
    const originalFetch = global.fetch;
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        span.setAttribute.mockReset();
        fetchMock = vi.fn().mockImplementation(async () => answer());
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    /** The request sent for this prompt, tools and config */
    async function sent(system: string, tools: any[] | undefined, extra: Partial<AIProviderConfig> = {}) {
        fetchMock.mockClear();
        await drain(new AnthropicProvider().generateStream(system, "hi", config(extra), tools));
        return JSON.parse(fetchMock.mock.calls[0][1].body);
    }
    const marked = (body: any) => [
        ...(body.tools ?? []).filter((t: any) => t.cache_control).map((t: any) => t.name),
        ...(Array.isArray(body.system) ? body.system.filter((b: any) => b.cache_control).map((b: any) => b.text.slice(0, 1)) : []),
    ];

    it("sends no marker when the caller named no fixed part and the tools are small: the request is as it was before caching", async () => {
        const body = await sent("be kind", [tool("go_to", 10)]);
        expect(body.system).toBe("be kind");
        expect(JSON.stringify(body)).not.toContain("cache_control");
    });

    it("marks the last tool when the tools alone reach the minimum, and only that one", async () => {
        const body = await sent("be kind", [tool("one", 300), tool("two", 300)]);
        expect(body.tools[0]).not.toHaveProperty("cache_control");
        expect(body.tools[1].cache_control).toEqual({ type: "ephemeral" });
        // No fixed part named: the system prompt stays one plain string
        expect(body.system).toBe("be kind");
    });

    it("uses the 5-minute cache only: no ttl field anywhere", async () => {
        const body = await sent(tokens(600) + "rest", undefined, { promptCacheEnds: [tokens(600).length] });
        expect(JSON.stringify(body)).toContain('"cache_control":{"type":"ephemeral"}');
        expect(JSON.stringify(body)).not.toContain("ttl");
    });

    it("splits the system prompt at the ends the caller named, marks the fixed parts and leaves the rest unmarked", async () => {
        const instructions = tokens(450, "i");
        const room = tokens(200, "r");
        const rest = tokens(900, "m");
        const prompt = instructions + room + rest;
        const body = await sent(prompt, [tool("go_to", 50)], { promptCacheEnds: [instructions.length, instructions.length + room.length] });

        expect(body.system.map((block: any) => block.type)).toEqual(["text", "text", "text"]);
        expect(body.system.map((block: any) => block.text).join("")).toBe(prompt);
        // About 80 tokens of tools + 450 of instructions reach 512 together; the room adds more
        expect(body.system.map((block: any) => Boolean(block.cache_control))).toEqual([true, true, false]);
        expect(body.tools[0]).not.toHaveProperty("cache_control");
    });

    it("counts the tools toward a part's size, since a cached prefix starts with them", async () => {
        const small = tokens(300, "i");
        // 300 tokens of instructions alone are under 512, and so are 300 of tools; together the prefix is over
        const withTools = await sent(small + "rest", [tool("go_to", 300)], { promptCacheEnds: [small.length] });
        expect(marked(withTools)).toEqual(["i"]);
        const without = await sent(small + "rest", undefined, { promptCacheEnds: [small.length] });
        expect(marked(without)).toEqual([]);
        expect(without.system).toBe(small + "rest");
    });

    it("sends no marker below the minimum size, and keeps the request exactly as it was", async () => {
        const fixed = tokens(100, "i");
        const body = await sent(fixed + "rest", [tool("go_to", 100)], { promptCacheEnds: [fixed.length] });
        expect(JSON.stringify(body)).not.toContain("cache_control");
        expect(body.system).toBe(fixed + "rest");
    });

    it.each([
        ["claude-haiku-4-5", 4096],
        ["claude-opus-4-6", 4096],
        ["claude-opus-4-7", 2048],
        ["claude-sonnet-4-5", 1024],
        ["claude-sonnet-4-5-20250929", 1024],
        ["claude-haiku-5-5", 512],
        ["claude-opus-5-5", 512],
        ["claude-fable-5-1", 512],
    ])("%s takes a marker from %i tokens, not before", async (model, minimum) => {
        const under = tokens(minimum - 5, "u");
        expect(marked(await sent(under + "rest", undefined, { model, promptCacheEnds: [under.length] }))).toEqual([]);
        const over = tokens(minimum + 5, "o");
        expect(marked(await sent(over + "rest", undefined, { model, promptCacheEnds: [over.length] }))).toEqual(["o"]);
    });

    it("sends no marker to a model whose minimum is unknown", async () => {
        const fixed = tokens(9000, "i");
        const body = await sent(fixed + "rest", [tool("go_to", 9000)], { model: "claude-future-9", promptCacheEnds: [fixed.length] });
        expect(JSON.stringify(body)).not.toContain("cache_control");
    });

    it("marks a prompt that is fixed all the way to its end, with no unmarked tail", async () => {
        const fixed = tokens(600, "i");
        const body = await sent(fixed, undefined, { promptCacheEnds: [fixed.length] });
        expect(body.system).toEqual([{ type: "text", text: fixed, cache_control: { type: "ephemeral" } }]);
    });

    it("never sends more than 4 markers", async () => {
        const parts = Array.from({ length: 6 }, (_, i) => tokens(600, String(i)));
        const ends = parts.map((_, i) => parts.slice(0, i + 1).join("").length);
        const body = await sent(parts.join("") + "rest", [tool("a", 600), tool("b", 600)], { promptCacheEnds: ends });
        const count = JSON.stringify(body).split("cache_control").length - 1;
        expect(count).toBe(4);
        // The first four that qualify: the last tool, then the first three parts
        expect(marked(body)).toEqual(["b", "0", "1", "2"]);
    });

    it("ignores ends that make no sense: out of order, repeated, past the prompt, not whole numbers", async () => {
        const fixed = tokens(600, "i");
        const body = await sent(fixed + "rest", undefined, { promptCacheEnds: [fixed.length, fixed.length, 5, 99999, 1.5, -3, Number.NaN] });
        expect(body.system.map((block: any) => block.text)).toEqual([fixed, "rest"]);
        expect(marked(body)).toEqual(["i"]);
    });

    it("keeps the tool and the system text exactly as they were, only adding the markers", async () => {
        const fixed = tokens(600, "i");
        const tools = [tool("go_to", 700)];
        const plain = await sent(fixed + "rest", tools);
        const cached = await sent(fixed + "rest", tools, { promptCacheEnds: [fixed.length] });
        expect(cached.system.map((block: any) => block.text).join("")).toBe(plain.system);
        expect({ ...cached, system: plain.system }).toEqual(plain);
        // Without the hint it is the request as it was before the system prompt was split: a plain string
        expect(typeof plain.system).toBe("string");
    });
});

describe("Claude's cache figures", () => {
    const originalFetch = global.fetch;
    beforeEach(() => {
        span.setAttribute.mockReset();
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    function reply(usage: Record<string, number>, deltaUsage?: Record<string, number>) {
        global.fetch = vi.fn().mockImplementation(async () => answer(usage, deltaUsage)) as unknown as typeof fetch;
    }
    const doneOf = async (provider = new AnthropicProvider()) => (await drain(provider.generateStream("s", "hi", config()))).find((chunk) => chunk.done);

    it("reports what was read from and written to the cache, inside the prompt tokens", async () => {
        reply({ input_tokens: 25, cache_creation_input_tokens: 3000, cache_read_input_tokens: 0 });
        expect((await doneOf()).metadata).toMatchObject({ promptTokens: 3025, completionTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 3000 });
        reply({ input_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 });
        expect((await doneOf()).metadata).toMatchObject({ promptTokens: 3025, cacheReadTokens: 3000, cacheWriteTokens: 0, tokensUsed: 3032 });
    });

    it("names cache reads the way the price ledger reads them, so they are priced as reads", async () => {
        reply({ input_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 });
        const metadata = (await doneOf()).metadata;
        expect(metadata).toMatchObject({ cachedPromptTokens: 3000 });
        expect(usageFromMetadata(metadata)).toMatchObject({ inputTokens: 25, cachedTokens: 3000, cacheWriteTokens: 0 });
        reply({ input_tokens: 25 });
        expect((await doneOf()).metadata).not.toHaveProperty("cachedPromptTokens");
    });

    it("takes the figures from the closing event when Claude gives them there", async () => {
        reply({ input_tokens: 25 }, { output_tokens: 9, cache_read_input_tokens: 2000, cache_creation_input_tokens: 10 });
        expect((await doneOf()).metadata).toMatchObject({ cacheReadTokens: 2000, cacheWriteTokens: 10 });
    });

    it("reports zero when Claude says nothing about a cache", async () => {
        reply({ input_tokens: 25 });
        expect((await doneOf()).metadata).toMatchObject({ promptTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0 });
    });

    it("tells the caller of the registry about a call that used the cache, and says nothing otherwise", async () => {
        const registry = new AIProviderRegistry();
        const onCacheTokens = vi.fn();
        reply({ input_tokens: 25, cache_read_input_tokens: 3000 });
        await drain(registry.generateStream("c1", "s", "hi", config({ providerId: "c1", onCacheTokens })));
        expect(onCacheTokens).toHaveBeenCalledExactlyOnceWith(3000, 0);

        onCacheTokens.mockClear();
        reply({ input_tokens: 25 });
        await drain(registry.generateStream("c2", "s", "hi", config({ providerId: "c2", onCacheTokens })));
        expect(onCacheTokens).not.toHaveBeenCalled();
    });

    it("puts the cache figures on the Sentry span of a whole (not streamed) answer, with the cached tokens inside input_tokens", async () => {
        const json = { content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn", usage: { input_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 40, output_tokens: 4 }, model: "claude-sonnet-5-5" };
        global.fetch = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => json, text: async () => "" })) as unknown as typeof fetch;
        await new AnthropicProvider().generate("s", "hi", config());
        const attributes = Object.fromEntries(span.setAttribute.mock.calls);
        expect(attributes).toMatchObject({
            "gen_ai.usage.input_tokens": 3060,
            "gen_ai.usage.cache_read.input_tokens": 3000,
            "gen_ai.usage.cache_creation.input_tokens": 40,
        });
    });
});

describe("the other providers", () => {
    const originalFetch = global.fetch;
    afterEach(() => {
        global.fetch = originalFetch;
    });

    const openAiStream = () =>
        ({
            ok: true,
            status: 200,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'));
                    controller.close();
                },
            }),
            text: async () => "",
        }) as unknown as Response;

    async function bodyOf(provider: OpenAIProvider | LMStudioProvider, cfg: AIProviderConfig, tools?: any[]) {
        const fetchMock = vi.fn().mockImplementation(async () => openAiStream());
        global.fetch = fetchMock as unknown as typeof fetch;
        await drain(provider.generateStream("system " + tokens(800), "hi", cfg, tools));
        return { url: fetchMock.mock.calls[0][0], init: fetchMock.mock.calls[0][1] };
    }

    const cache = { promptCacheEnds: [100, 400], onCacheTokens: () => {} };

    it("DeepSeek on the openai type sends byte for byte the same request, whatever the cache hints say", async () => {
        const deepseek = config({ providerId: "ds", type: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash" });
        const tools = [tool("go_to", 600)];
        const before = await bodyOf(new OpenAIProvider(), deepseek, tools);
        const after = await bodyOf(new OpenAIProvider(), { ...deepseek, ...cache }, tools);
        expect(after.url).toBe(before.url);
        expect(after.init.body).toBe(before.init.body);
        expect(after.init.headers).toEqual(before.init.headers);
        expect(after.init.body).not.toContain("cache_control");
    });

    it("LM Studio sends byte for byte the same request, whatever the cache hints say", async () => {
        const local = config({ providerId: "lm", type: "lmstudio", endpoint: "http://localhost:1234", apiKeyEncrypted: null, model: "qwen3-8b" });
        const tools = [tool("go_to", 600)];
        const before = await bodyOf(new LMStudioProvider(), local, tools);
        const after = await bodyOf(new LMStudioProvider(), { ...local, ...cache }, tools);
        expect(after.url).toBe(before.url);
        expect(after.init.body).toBe(before.init.body);
        expect(after.init.headers).toEqual(before.init.headers);
        expect(after.init.body).not.toContain("cache_control");
    });

    it("the registry passes their chunks through untouched", async () => {
        global.fetch = vi.fn().mockImplementation(async () => openAiStream()) as unknown as typeof fetch;
        const registry = new AIProviderRegistry();
        const onCacheTokens = vi.fn();
        const chunks = await drain(registry.generateStream("lm2", "s", "hi", config({ providerId: "lm2", type: "lmstudio", endpoint: "http://localhost:1234", apiKeyEncrypted: null, model: "qwen3-8b", onCacheTokens })));
        expect(chunks.filter((chunk) => !chunk.done).map((chunk) => chunk.content).join("")).toBe("hi");
        expect(onCacheTokens).not.toHaveBeenCalled();
    });
});
