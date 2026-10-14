import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderRegistry } from "../ai/AIProviderRegistry";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import type { AIProviderConfig } from "../ai/types";

vi.mock("../ai/encryption", () => ({ decryptApiKey: () => "test-key" }));

const providers = [
    { type: "openai" as const, model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com/v1", vision: false },
    { type: "openai" as const, model: "deepseek-flash", endpoint: "https://api.deepseek.com/v1", vision: false },
    {
        type: "lmstudio" as const,
        model: "meta-llama-3.1-8b-instruct",
        endpoint: "http://localhost:1234",
        vision: false,
    },
    { type: "lmstudio" as const, model: "qwen2.5-vl-7b-instruct", endpoint: "http://localhost:1234", vision: true },
    { type: "lmstudio" as const, model: "llava-v1.6-mistral-7b", endpoint: "http://localhost:1234", vision: true },
];

afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek on openai and local LM Studio keep their vision behavior", () => {
    describe.each(providers)("$type / $model", ({ type, model, endpoint, vision }) => {
        it.each([undefined, null, true, false])(
            "preserves routing and image payloads with override %s",
            async (supportsVision) => {
                const registry = new AIProviderRegistry();
                const config: AIProviderConfig = {
                    providerId: "existing-provider",
                    name: "Existing provider",
                    type,
                    model,
                    endpoint,
                    enabled: true,
                    apiKeyEncrypted: type === "openai" ? "encrypted-test-key" : null,
                    temperature: 0.7,
                    maxTokens: 512,
                    supportsStreaming: true,
                    settings: {},
                    visionModel: type === "openai" ? "deepseek-v4-flash-vision-exp" : null,
                    ...(supportsVision === undefined ? {} : { supportsVision }),
                };
                const provider = registry.getOrCreateProvider(config);
                expect(provider).toBeInstanceOf(type === "openai" ? OpenAIProvider : LMStudioProvider);
                expect(registry.getOrCreateProvider(config)).toBe(provider);
                // Omitted overrides need no settings change. The DeepSeek description
                // model must not make the primary text-only model accept images.
                const expectedVision = supportsVision ?? vision;
                expect(registry.supportsVision(config)).toBe(expectedVision);
                const fetchMock = vi
                    .fn<(url: string, request: RequestInit) => Promise<Response>>()
                    .mockImplementation(() => {
                        const encoder = new TextEncoder();
                        return Promise.resolve(
                            new Response(
                                new ReadableStream<Uint8Array>({
                                    start(controller) {
                                        controller.enqueue(
                                            encoder.encode(
                                                'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
                                            )
                                        );
                                        controller.close();
                                    },
                                })
                            )
                        );
                    });
                vi.stubGlobal("fetch", fetchMock);
                const content: string[] = [];
                for await (const chunk of registry.generateStream(
                    config.providerId,
                    "system",
                    "describe this",
                    config,
                    undefined,
                    undefined,
                    ["https://example.com/image.png"]
                )) {
                    content.push(chunk.content);
                }
                expect(content.join("")).toBe("ok");
                expect(fetchMock).toHaveBeenCalledTimes(1);
                const [url, request] = fetchMock.mock.calls[0];
                expect(url).toBe(`${endpoint}${type === "lmstudio" ? "/v1" : ""}/chat/completions`);
                const body = JSON.parse(request.body as string) as {
                    model: string;
                    messages: Array<{ content: unknown }>;
                };
                expect(body.model).toBe(model);
                expect(body.messages[1].content).toEqual(
                    expectedVision
                        ? [
                              { type: "text", text: "describe this" },
                              { type: "image_url", image_url: { url: "https://example.com/image.png" } },
                          ]
                        : "describe this"
                );
            }
        );
    });
});
