import { afterEach, describe, expect, it, vi } from "vitest";
import { AIService, READ_WEB_PAGE_TOOL } from "../ai/AIService";
import { MCPConnector } from "../mcp/MCPConnector";

vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe("tools in a direct message", () => {
    it("offers read_web_page in a direct message, which has no bot client, and not to other callers without one", async () => {
        const service = new AIService(null!, null!, "");
        const names = async (channel?: "world" | "dm") =>
            (await service["buildTools"](undefined, undefined, undefined, channel)).tools.map(
                (tool: { function: { name: string } }) => tool.function.name
            );
        expect(await names("dm")).toContain(READ_WEB_PAGE_TOOL);
        expect(await names()).not.toContain(READ_WEB_PAGE_TOOL);
    });

    it("gives an MCP tool the bot's own Patience when there is no bot client", async () => {
        const service = new AIService(null!, null!, "");
        const execute = vi.spyOn(MCPConnector, "executeToolCall").mockResolvedValue("ok" as never);
        const servers = new Map([["lookup", { serverId: "s1", serverUrl: "https://mcp.example", authType: "none" }]]);
        await service["executeToolCalls"](
            [{ id: "1", name: "lookup", arguments: "{}" }],
            undefined,
            undefined,
            servers,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            300
        );
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][9]).toBe(300_000);
    });
});
