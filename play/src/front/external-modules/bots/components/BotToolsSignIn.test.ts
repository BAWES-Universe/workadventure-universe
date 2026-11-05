import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

const mocks = vi.hoisted(() => ({
    isInitialized: vi.fn(() => true),
    getBotMcpServers: vi.fn(),
    getMcpServerTools: vi.fn(),
    updateBotMcpServer: vi.fn(),
    testBotMcpServer: vi.fn(),
    moveMcpTool: vi.fn(),
    confirmMcpTools: vi.fn(),
    saveMcpServerSettings: vi.fn(),
    getBotToolSettings: vi.fn(),
    saveBotToolSettings: vi.fn(),
    getAllowedMore: vi.fn(),
    endAllowedMore: vi.fn(),
}));
const reconnect = vi.hoisted(() => ({ reconnectBotServer: vi.fn() }));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));
vi.mock("../services/reconnectServer", () => reconnect);

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotData } from "../types";
import { botToolsStore } from "../stores/BotToolsStore";
import BotToolsServerScreen from "./BotToolsServerScreen.svelte";

const bot = { id: "b1", name: "Tavily Researcher" } as unknown as BotData;
const LOST_AT = "2026-11-05T09:54:00.000Z";

const server = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    name: "Tavily",
    serverUrl: "https://mcp.tavily.com/mcp",
    authType: "oauth",
    oauthConnected: true,
    enabled: true,
    createdAt: "2026-11-01T00:00:00Z",
    lastTestResult: { success: true, toolCount: 4, toolNames: [], error: null },
    ...over,
});

describe("a tool server the bot server found with a lost sign-in (#1819)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        botToolsStore.set(undefined);
        mocks.isInitialized.mockReturnValue(true);
        mocks.getMcpServerTools.mockResolvedValue({
            serverId: "s1",
            state: "confirmed",
            policyRevision: 1,
            settings: {
                looksUp: "rightAway",
                makesNew: "rightAway",
                changesThings: "asksFirst",
                deletesOrSends: "asksFirst",
            },
            tools: [],
            truncated: false,
            totalSeen: null,
        });
        mocks.testBotMcpServer.mockResolvedValue({ success: true, toolCount: 4, toolNames: [] });
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const settle = async () => {
        for (let i = 0; i < 6; i++) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
            // eslint-disable-next-line no-await-in-loop
            await tick();
        }
    };
    const byTestId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const head = () => (byTestId("bot-tools-server-head")?.textContent ?? "").replace(/\s+/g, " ").trim();

    async function mountServer() {
        const component = new BotToolsServerScreen({
            target,
            props: { bot, serverId: "s1", onOpenHeading: vi.fn(), onGone: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
    }

    it("says Sign-in expired with the time, with no Test needed, and offers Reconnect for a sign-in", async () => {
        mocks.getBotMcpServers.mockResolvedValue([server({ signInLostAt: LOST_AT })]);
        await mountServer();
        expect(head()).toMatch(/Sign-in expired at \d{1,2}:\d{2}/);
        expect(head()).toContain("Until it's reconnected, Tavily Researcher answers without Tavily's tools");
        expect(byTestId("bot-reconnect")?.textContent).toContain("Reconnect Tavily");
        expect(head()).toContain("Sign in with the Tavily account Tavily Researcher should use.");
    });

    it("opens the provider's window from Reconnect, then reads the page again and checks the tools", async () => {
        mocks.getBotMcpServers.mockResolvedValue([server({ signInLostAt: LOST_AT })]);
        reconnect.reconnectBotServer.mockResolvedValue("done");
        await mountServer();
        mocks.getBotMcpServers.mockResolvedValue([server({ reconnectedAt: "2026-11-05T10:20:00.000Z" })]);
        byTestId("bot-reconnect")?.click();
        await settle();
        expect(reconnect.reconnectBotServer).toHaveBeenCalledWith("b1", "s1");
        expect(mocks.testBotMcpServer).toHaveBeenCalledWith("b1", "s1");
        expect(byTestId("bot-reconnect")).toBeNull();
        expect(head()).toMatch(/Connected · 4 tools · reconnected at \d{1,2}:\d{2}/);
    });

    it("says so when the browser blocked the window, and stays on Reconnect", async () => {
        mocks.getBotMcpServers.mockResolvedValue([server({ signInLostAt: LOST_AT })]);
        reconnect.reconnectBotServer.mockResolvedValue("blocked");
        await mountServer();
        byTestId("bot-reconnect")?.click();
        await settle();
        expect(head()).toContain("Allow pop-ups and try again.");
        expect(byTestId("bot-reconnect")).not.toBeNull();
        expect(mocks.testBotMcpServer).not.toHaveBeenCalled();
    });

    it("asks for a new key or token on the page for a key server, and saves only the key", async () => {
        mocks.getBotMcpServers.mockResolvedValue([server({ authType: "api-key", signInLostAt: LOST_AT })]);
        mocks.updateBotMcpServer.mockResolvedValue(server({ authType: "api-key" }));
        await mountServer();
        expect(head()).toContain("New API key from Tavily");
        expect(byTestId("bot-reconnect")).toBeNull();
        const save = byTestId("bot-save-key") as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        const field = target.querySelector<HTMLInputElement>("#mcp-newkey")!;
        field.value = "  tvly-new  ";
        field.dispatchEvent(new Event("input"));
        await settle();
        mocks.getBotMcpServers.mockResolvedValue([server({ authType: "api-key" })]);
        save.click();
        await settle();
        expect(mocks.updateBotMcpServer).toHaveBeenCalledWith("b1", "s1", { authConfig: "tvly-new" });
        expect(mocks.testBotMcpServer).toHaveBeenCalledWith("b1", "s1");
        expect(byTestId("bot-save-key")).toBeNull();
    });

    it("says a server that did not answer is not a sign-in: no Reconnect", async () => {
        mocks.getBotMcpServers.mockResolvedValue([server({ noAnswerAt: LOST_AT })]);
        await mountServer();
        expect(head()).toMatch(/Didn't answer at \d{1,2}:\d{2}\D+· tries again in a few minutes/);
        expect(byTestId("bot-reconnect")).toBeNull();
        expect(byTestId("bot-save-key")).toBeNull();
    });

    it("shows a healthy server as before", async () => {
        mocks.getBotMcpServers.mockResolvedValue([server()]);
        await mountServer();
        expect(head()).toContain("Connected · 4 tools");
        expect(head()).not.toContain("Sign-in expired");
        expect(byTestId("bot-reconnect")).toBeNull();
    });
});
