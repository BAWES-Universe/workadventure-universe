/**
 * Tests for OpenAIProvider vision support — tri-state resolution and multipart
 * content building.
 *
 * Scope: Verifies that image URLs are sent as image_url content blocks ONLY
 * when the model supports vision (auto regex match or forced true), and that a
 * text-only model NEVER receives image_url blocks (it would 400 on them).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import { resolveVisionSupport, isVisionCapableModel } from "../ai/providers/visionModels";
import type { AIProviderConfig } from "../ai/types";

// Mock encryption
vi.mock("../ai/encryption", () => ({
    decryptApiKey: vi.fn(() => "***"),
}));

// ---- Helper: build a minimal AIProviderConfig for OpenAI ----
function buildConfig(extra: Record<string, any> = {}): AIProviderConfig {
    return {
        providerId: "openai-1",
        name: "TestOpenAI",
        type: "openai",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        apiKeyEncrypted: "fakeiv:fakeauth:fakedata",
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 512,
        supportsStreaming: true,
        settings: {},
        ...extra,
    };
}

function buildSSEStream(): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const data = [
        "data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }) + "\n\n",
        "data: [DONE]\n\n",
    ].join("");
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(data));
            controller.close();
        },
    });
}

describe("visionModels — tri-state resolution matrix", () => {
    it("auto: known vision model names resolve to true", () => {
        for (const model of [
            "gemini-2.0-flash",
            "gpt-4o",
            "gpt-4.1-mini",
            "gpt-5",
            "claude-3-5-sonnet",
            "claude-4-sonnet",
            "qwen2.5-vl-7b",
            "llava-v1.6",
            "pixtral-12b",
            "glm-4.5v",
            "kimi-2.5-vl",
        ]) {
            expect(resolveVisionSupport(model, null), `auto should detect ${model}`).toBe(true);
        }
    });

    it("auto: text-only model names resolve to false", () => {
        for (const model of ["deepseek-chat", "deepseek-v4-flash", "gpt-3.5-turbo", "llama-3.3-70b", "mistral-small"]) {
            expect(resolveVisionSupport(model, null), `auto should NOT detect ${model}`).toBe(false);
        }
    });

    it("force true overrides a text-only model name", () => {
        expect(resolveVisionSupport("deepseek-chat", true)).toBe(true);
    });

    it("force false overrides a vision model name", () => {
        expect(resolveVisionSupport("gemini-2.0-flash", false)).toBe(false);
    });

    it("undefined and null both mean auto", () => {
        expect(resolveVisionSupport("gpt-4o", undefined)).toBe(true);
        expect(resolveVisionSupport("gpt-4o", null)).toBe(true);
        expect(resolveVisionSupport("deepseek-chat", undefined)).toBe(false);
    });

    it("isVisionCapableModel handles empty input safely", () => {
        expect(isVisionCapableModel("")).toBe(false);
    });
});

describe("OpenAIProvider.supportsVision", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        provider = new OpenAIProvider();
        vi.clearAllMocks();
    });

    it("honors the tri-state override from config", () => {
        expect(provider.supportsVision(buildConfig({ model: "gemini-2.0-flash" }))).toBe(true);
        expect(provider.supportsVision(buildConfig({ model: "deepseek-chat" }))).toBe(false);
        expect(provider.supportsVision(buildConfig({ model: "deepseek-chat", supportsVision: true }))).toBe(true);
        expect(provider.supportsVision(buildConfig({ model: "gemini-2.0-flash", supportsVision: false }))).toBe(false);
        // Missing supportsVision defaults to auto
        expect(provider.supportsVision(buildConfig({ supportsVision: undefined, model: "gpt-4o" }))).toBe(true);
    });
});

describe("OpenAIProvider multipart content building", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
        provider = new OpenAIProvider();
        vi.clearAllMocks();
    });

    it("sends image_url blocks for a vision-capable model", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: buildSSEStream(), text: vi.fn().mockResolvedValue("") });
        vi.stubGlobal("fetch", fetchMock);

        const config = buildConfig({ model: "gemini-2.0-flash" });
        const chunks: any[] = [];
        for await (const chunk of provider.generateStream("sys", "what is this?", config, undefined, undefined, ["https://example.com/a.png"])) {
            chunks.push(chunk);
        }

        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        const userContent = sentBody.messages[1].content;
        expect(Array.isArray(userContent)).toBe(true);
        expect(userContent[0]).toEqual({ type: "text", text: "what is this?" });
        expect(userContent[1]).toEqual({ type: "image_url", image_url: { url: "https://example.com/a.png" } });
        expect(chunks.length).toBeGreaterThan(0);
        vi.unstubAllGlobals();
    });

    it("sends multiple images for a gallery", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: buildSSEStream(), text: vi.fn().mockResolvedValue("") });
        vi.stubGlobal("fetch", fetchMock);

        const config = buildConfig({ model: "gpt-4o" });
        for await (const _chunk of provider.generateStream("sys", "desc", config, undefined, undefined, ["https://e.com/1.png", "https://e.com/2.jpg"])) {
            // drain
        }

        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        const userContent = sentBody.messages[1].content;
        expect(userContent).toHaveLength(3);
        expect(userContent[2]).toEqual({ type: "image_url", image_url: { url: "https://e.com/2.jpg" } });
        vi.unstubAllGlobals();
    });

    it("NEVER sends image_url blocks to a text-only model — plain string content", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: buildSSEStream(), text: vi.fn().mockResolvedValue("") });
        vi.stubGlobal("fetch", fetchMock);

        // deepseek-chat with auto detection — images must NOT be attached
        const config = buildConfig({ model: "deepseek-chat" });
        for await (const _chunk of provider.generateStream("sys", "what is this?", config, undefined, undefined, ["https://example.com/a.png"])) {
            // drain
        }

        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(typeof sentBody.messages[1].content).toBe("string");
        expect(sentBody.messages[1].content).toBe("what is this?");
        vi.unstubAllGlobals();
    });

    it("force false on a vision model also stays plain string", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: buildSSEStream(), text: vi.fn().mockResolvedValue("") });
        vi.stubGlobal("fetch", fetchMock);

        const config = buildConfig({ model: "gemini-2.0-flash", supportsVision: false });
        for await (const _chunk of provider.generateStream("sys", "hi", config, undefined, undefined, ["https://e.com/a.png"])) {
            // drain
        }

        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(typeof sentBody.messages[1].content).toBe("string");
        vi.unstubAllGlobals();
    });

    it("no images passed → plain string content even for vision models", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: buildSSEStream(), text: vi.fn().mockResolvedValue("") });
        vi.stubGlobal("fetch", fetchMock);

        const config = buildConfig({ model: "gpt-4o" });
        for await (const _chunk of provider.generateStream("sys", "hi", config)) {
            // drain
        }

        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(typeof sentBody.messages[1].content).toBe("string");
        vi.unstubAllGlobals();
    });
});
