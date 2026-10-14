import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderRegistry } from "../ai/AIProviderRegistry";
import { OpenAIProvider } from "../ai/providers/OpenAIProvider";
import { LMStudioProvider } from "../ai/providers/LMStudioProvider";
import type { AIProviderConfig, AIStreamChunk } from "../ai/types";

vi.mock("../ai/encryption", () => ({ decryptApiKey: vi.fn(() => "test-key") }));
afterEach(() => vi.unstubAllGlobals());

describe("existing bot provider configuration", () => {
    it.each([
        {
            type: "openai" as const,
            model: "deepseek-v4-flash",
            endpoint: "https://api.deepseek.com/v1",
            url: "https://api.deepseek.com/v1/chat/completions",
            provider: OpenAIProvider,
        },
        {
            type: "lmstudio" as const,
            model: "llama3",
            endpoint: "http://localhost:1234",
            url: "http://localhost:1234/v1/chat/completions",
            provider: LMStudioProvider,
        },
    ])("keeps $type routing, request settings, streaming and tool calls", async (row) => {
        const config: AIProviderConfig = {
            providerId: row.type,
            name: row.type,
            type: row.type,
            enabled: true,
            endpoint: row.endpoint,
            apiKeyEncrypted: row.type === "openai" ? "encrypted" : null,
            model: row.model,
            temperature: 0.7,
            maxTokens: 512,
            supportsStreaming: true,
            settings: {},
        };
        const original = structuredClone(config);
        const sse =
            [
                { choices: [{ delta: { content: "Checking." } }] },
                {
                    choices: [
                        {
                            delta: {
                                tool_calls: [
                                    {
                                        id: "areas",
                                        function: {
                                            name: "get_areas_on_map",
                                            arguments: "{}",
                                        },
                                    },
                                ],
                            },
                            finish_reason: "tool_calls",
                        },
                    ],
                    usage: { prompt_tokens: 10, completion_tokens: 5 },
                },
            ]
                .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                .join("") + "data: [DONE]\n\n";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            body: new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(sse));
                    controller.close();
                },
            }),
        });
        vi.stubGlobal("fetch", fetchMock);
        const registry = new AIProviderRegistry();
        expect(registry.getOrCreateProvider(config)).toBeInstanceOf(row.provider);
        const tools = [
            {
                type: "function",
                function: {
                    name: "get_areas_on_map",
                    parameters: {
                        type: "object",
                        properties: {},
                    },
                },
            },
        ];
        const chunks: AIStreamChunk[] = [];
        for await (const chunk of registry.generateStream(config.providerId, "system", "user", config, tools)) {
            chunks.push(chunk);
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(row.url);
        expect(JSON.parse(init.body)).toMatchObject({
            model: row.model,
            messages: [
                { role: "system", content: "system" },
                { role: "user", content: "user" },
            ],
            stream: true,
            temperature: 0.7,
            max_tokens: 512,
            tools,
            tool_choice: "auto",
        });
        expect(init.headers.Authorization).toBe(row.type === "openai" ? "Bearer test-key" : undefined);
        expect(chunks).toContainEqual({ content: "Checking.", done: false });
        expect(chunks.flatMap((chunk) => chunk.toolCalls ?? [])).toEqual([
            { id: "areas", name: "get_areas_on_map", arguments: "{}" },
        ]);
        expect(chunks.at(-1)).toMatchObject({ done: true, metadata: { tokensUsed: 15, error: false } });
        expect(config).toEqual(original);
    });
});
