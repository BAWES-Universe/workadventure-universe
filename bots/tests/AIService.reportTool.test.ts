import { afterEach, describe, expect, it, vi } from "vitest";
import { AIService } from "../ai/AIService";
import { MCPConnector } from "../mcp/MCPConnector";
import { REPORT_TOOL } from "../ai/ReportTools";
import { describeStep } from "../ai/ToolSteps";
import { openToolGate } from "./helpers/openToolGate";

vi.mock("../client/BotClient", () => ({ BotClient: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

/** "Send to the Universe team" (mock "Brick reports inbox"): every Brick has it in its direct messages where Orbit is there, and it runs with what the chat knows. */
describe("the note to the Universe team in a Brick's replies", () => {
    const names = async (service: AIService, admin: unknown, channel: "world" | "dm") =>
        (await service["buildTools"]("b1", undefined, admin as never, channel)).tools.map((tool: { function: { name: string } }) => tool.function.name);

    it("is offered to a Brick in its direct messages when Orbit is set up; never on the map, to a room bot, or without Orbit", async () => {
        vi.spyOn(MCPConnector, "discoverToolsWithMapping").mockResolvedValue({ tools: [], toolServerMap: new Map() } as never);
        const service = openToolGate(new AIService(null!, null!, ""));
        // A room bot (no Brick) never has it
        expect(await names(service, { isConfigured: () => true }, "dm")).not.toContain(REPORT_TOOL);
        service.noteBrick("b1", { isDefault: false, ownerId: "owner-1" });
        expect(await names(service, { isConfigured: () => true }, "dm")).toContain(REPORT_TOOL);
        expect(await names(service, { isConfigured: () => true }, "world")).not.toContain(REPORT_TOOL);
        expect(await names(service, { isConfigured: () => false }, "dm")).not.toContain(REPORT_TOOL);
        expect(await names(service, undefined, "dm")).not.toContain(REPORT_TOOL);
    });

    it("runs for anyone in the chat, with the person counted, what they wrote kept for the quote check, and the line waiting with the reply", async () => {
        const service = openToolGate(new AIService(null!, null!, ""));
        const memory = {
            userUuid: "uuid-alice",
            isGuest: false,
            playerName: "Alice",
            conversationHistory: [{ message: "Why can't you add links to my listings page", sender: "person", timestamp: 1 }],
            pendingBricks: [] as unknown[],
        };
        (service as unknown as { conversationMemory: unknown }).conversationMemory = { getMemory: () => memory };
        const sendBrickReport = vi.fn(async () => ({
            sent: true,
            id: "n1",
            takeBackKey: "k1",
            note: { kind: "problem", area: "pages", effect: "stopped", title: "Links in pages", tried: "", stopped: "", idea: "" },
        }));
        const admin = { isConfigured: () => true, sendBrickReport };
        const call = (channel: "world" | "dm") => service["executeToolCalls"](
            [{ id: "1", name: REPORT_TOOL, arguments: JSON.stringify({ kind: "problem", area: "pages", title: "Links in pages", effect: "stopped" }) }],
            undefined,
            admin as never,
            new Map(),
            undefined,
            undefined,
            "b1",
            7,
            undefined,
            null,
            false,
            "own-key",
            undefined,
            undefined,
            false,
            true,
            false,
            undefined,
            channel
        );
        // Not a Brick, or not its direct message: nothing is sent, whatever the model asks for
        expect((await call("dm"))[0].result).toMatchObject({ error: expect.any(String) });
        service.noteBrick("b1", { isDefault: false, ownerId: "owner-1" });
        expect((await call("world"))[0].result).toMatchObject({ error: expect.any(String) });
        expect(sendBrickReport).not.toHaveBeenCalled();
        const [result] = await call("dm");
        expect(result.result).toMatchObject({ sent: true });
        expect(sendBrickReport).toHaveBeenCalledWith(expect.objectContaining({ botId: "b1", personKey: "person:uuid-alice", context: expect.objectContaining({ ownKey: true }) }));
        expect(memory.pendingBricks).toEqual([expect.objectContaining({ kind: "report", id: "n1", key: "k1" })]);
    });

    it("shows as a step with its title", () => {
        expect(describeStep({ id: "1", name: REPORT_TOOL, arguments: { title: "Links in pages" } })).toMatchObject({ doing: "Sending to the Universe team", done: "Sent to the Universe team", detail: "Links in pages" });
    });
});
