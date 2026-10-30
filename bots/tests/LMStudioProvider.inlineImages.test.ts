/**
 * A person's own-computer key (Ollama takes no picture links) gets each picture inside the request as base64 (#1570);
 * the server's own LM Studio and hosted keys keep getting links.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@sentry/node", () => ({
    startSpan: vi.fn((_opts: unknown, cb: (span: any) => any) => cb({ setAttribute: vi.fn(), setStatus: vi.fn() })),
}));
vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "key") }));
const ownFetch = vi.fn();
vi.mock("../ai/ownComputerFetch", () => ({ ownComputerFetch: (...args: unknown[]) => ownFetch(...args) }));
const validateUrl = vi.fn();
vi.mock("../services/FileParser", () => ({ FileParser: { validateUrl: (url: string) => validateUrl(url) } }));

import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import { inlineImage, MAX_INLINE_IMAGE_BYTES } from "../ai/providers/inlineImages";
import type { AIProviderConfig } from "../ai/types";

const PICTURE = "https://chat.example/_matrix/media/v3/download/chat.example/abc";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_DATA = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;

function config(extra: Partial<AIProviderConfig> = {}): AIProviderConfig {
    return {
        providerId: "key-1", name: "My Ollama", type: "lmstudio", enabled: true, endpoint: "https://ollama.example.com",
        apiKeyEncrypted: null, model: "gemma3:4b", temperature: 0.7, maxTokens: 500, supportsStreaming: true,
        supportsVision: true, settings: {}, ownKey: { addressTyped: true }, ...extra,
    };
}

const picture = (body: ConstructorParameters<typeof Response>[0], headers: Record<string, string> = { "content-type": "image/png" }, status = 200) => new Response(body, { status, headers });

function sse(): Response {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"a cat"}}]}\n\ndata: [DONE]\n\n'));
            controller.close();
        },
    });
    return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

async function drain(gen: AsyncGenerator<any>) {
    for await (const _chunk of gen) { /* read it all */ }
}

/** The image_url addresses the provider was sent. */
const sentImages = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body).messages[1].content.filter((part: any) => part.type === "image_url").map((part: any) => part.image_url.url);

beforeEach(() => {
    validateUrl.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("an own-computer key with a vision model", () => {
    it("is sent the picture inside the request, as Ollama takes it", async () => {
        const fetchMock = vi.fn().mockResolvedValue(picture(PNG));
        vi.stubGlobal("fetch", fetchMock);
        ownFetch.mockResolvedValue(sse());
        await drain(new LMStudioProvider().generateStream("sys", "what is this?", config(), undefined, undefined, [PICTURE]));
        expect(fetchMock).toHaveBeenCalledWith(PICTURE, expect.objectContaining({ redirect: "manual" }));
        expect(validateUrl).toHaveBeenCalledWith(PICTURE);
        expect(sentImages(ownFetch.mock.calls[0])).toEqual([PNG_DATA]);
    });

    it("does the same for a plain reply", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(picture(PNG)));
        ownFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "a cat" } }] }) });
        await new LMStudioProvider().generate("sys", "what is this?", config(), undefined, undefined, [PICTURE]);
        expect(sentImages(ownFetch.mock.calls[0])).toEqual([PNG_DATA]);
    });

    it("does not count a slow picture against the request's time limit", async () => {
        vi.useFakeTimers();
        try {
            vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(picture(PNG)), 1500))));
            let abortedWhenSent: boolean | undefined;
            ownFetch.mockImplementation(async (_url: string, init: { signal: AbortSignal }) => {
                abortedWhenSent = init.signal.aborted;
                return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "a cat" } }] }) };
            });
            const reply = new LMStudioProvider().generate("sys", "what is this?", config({ settings: { timeout: 1000 } }), undefined, undefined, [PICTURE]);
            await vi.advanceTimersByTimeAsync(1600);
            await reply;
            expect(abortedWhenSent).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("links stay links", () => {
    it("for the server's own LM Studio", async () => {
        const fetchMock = vi.fn().mockResolvedValue(sse());
        vi.stubGlobal("fetch", fetchMock);
        await drain(new LMStudioProvider().generateStream("sys", "hi", config({ ownKey: undefined, endpoint: "http://localhost:1234" }), undefined, undefined, [PICTURE]));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sentImages(fetchMock.mock.calls[0])).toEqual([PICTURE]);
    });

    it("for a hosted key (DeepSeek) and the Universe AI describer on the openai type", async () => {
        const fetchMock = vi.fn().mockResolvedValue(sse());
        vi.stubGlobal("fetch", fetchMock);
        const deepseek = config({ type: "openai", endpoint: "https://api.deepseek.com", model: "deepseek-flash", apiKeyEncrypted: "iv:tag:data", ownKey: { addressTyped: false } });
        await drain(new OpenAIProvider().generateStream("sys", "hi", deepseek, undefined, undefined, [PICTURE]));
        await drain(new OpenAIProvider().generateStream("sys", "hi", { ...deepseek, ownKey: undefined }, undefined, undefined, [PICTURE]));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sentImages(fetchMock.mock.calls[0])).toEqual([PICTURE]);
        expect(sentImages(fetchMock.mock.calls[1])).toEqual([PICTURE]);
    });

    it("for a model that does not see pictures", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        ownFetch.mockResolvedValue(sse());
        await drain(new LMStudioProvider().generateStream("sys", "hi", config({ supportsVision: false }), undefined, undefined, [PICTURE]));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(JSON.parse(ownFetch.mock.calls[0][1].body).messages[1].content).toBe("hi");
    });
});

describe("inlineImage", () => {
    it("follows a redirect, checking each hop", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(picture(null, { location: "https://cdn.example/abc.png" }, 302))
            .mockResolvedValueOnce(picture(PNG));
        vi.stubGlobal("fetch", fetchMock);
        expect(await inlineImage(PICTURE)).toBe(PNG_DATA);
        expect(validateUrl.mock.calls.map(([url]) => url)).toEqual([PICTURE, "https://cdn.example/abc.png"]);
    });

    it("reads the type from the bytes when the server says only octet-stream", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(picture(PNG, { "content-type": "application/octet-stream" })));
        expect(await inlineImage(PICTURE)).toBe(PNG_DATA);
    });

    it.each([
        ["an address the guard refuses", () => validateUrl.mockRejectedValue(new Error("private")), picture(PNG)],
        ["a failed download", () => {}, picture("nope", { "content-type": "text/plain" }, 404)],
        ["something that is not a picture", () => {}, picture("<html>", { "content-type": "text/html" })],
        ["unknown bytes", () => {}, picture("not a picture", { "content-type": "application/octet-stream" })],
        ["a picture over the chat's limit", () => {}, picture(PNG, { "content-type": "image/png", "content-length": String(MAX_INLINE_IMAGE_BYTES + 1) })],
    ])("leaves the link as it was for %s", async (_name, setup, response) => {
        setup();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
        expect(await inlineImage(PICTURE)).toBe(PICTURE);
    });

    it("leaves the link when the body runs over the limit without saying its size", async () => {
        const big = new ReadableStream({
            start(controller) {
                controller.enqueue(PNG);
                controller.enqueue(new Uint8Array(MAX_INLINE_IMAGE_BYTES));
                controller.close();
            },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(picture(big)));
        expect(await inlineImage(PICTURE)).toBe(PICTURE);
    });

    it("keeps a picture that is already inside", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect(await inlineImage(PNG_DATA)).toBe(PNG_DATA);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
