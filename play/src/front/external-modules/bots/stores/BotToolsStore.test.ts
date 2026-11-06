import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getMcpServerTools: vi.fn(),
    moveMcpTool: vi.fn(),
    confirmMcpTools: vi.fn(),
    saveMcpServerSettings: vi.fn(),
    getBotToolSettings: vi.fn(),
    saveBotToolSettings: vi.fn(),
}));
vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));

import type { ServerTools } from "../toolsModel";
import {
    beginBot,
    botToolsStore,
    chooseSetting,
    confirmAllTools,
    loadBotToolSettings,
    loadServerTools,
    saveBotToolSettings,
    setServers,
} from "./BotToolsStore";

const server = (revision: number, settings: Partial<ServerTools["settings"]> = {}): ServerTools => ({
    serverId: "s1",
    state: "confirmed",
    policyRevision: revision,
    settings: {
        looksUp: "rightAway",
        makesNew: "rightAway",
        changesThings: "asksFirst",
        deletesOrSends: "asksFirst",
        ...settings,
    },
    tools: [],
    truncated: false,
    totalSeen: null,
});

function later<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("the Tools store (game #1655)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        botToolsStore.set(undefined);
    });

    it("lets go of a late answer for a bot whose page has closed", async () => {
        const slow = later<ServerTools>();
        mocks.getMcpServerTools.mockReturnValueOnce(slow.promise);
        const first = loadServerTools("botA", "s1");
        beginBot("botB");
        setServers("botB", []);
        slow.resolve(server(1));
        await first;
        expect(get(botToolsStore)?.botId).toBe("botB");
        expect(get(botToolsStore)?.tools).toEqual({});
    });

    it("puts back only the heading that failed, not a different one changed meanwhile", async () => {
        beginBot("botA");
        setServers("botA", []);
        mocks.getMcpServerTools.mockResolvedValueOnce(server(1));
        await loadServerTools("botA", "s1");

        const failing = later<ServerTools>();
        mocks.saveMcpServerSettings.mockReturnValueOnce(failing.promise);
        mocks.saveMcpServerSettings.mockResolvedValueOnce(server(2, { looksUp: "off" }));

        const first = chooseSetting("botA", "s1", "makesNew", "off").catch(() => undefined);
        await chooseSetting("botA", "s1", "looksUp", "off");
        failing.reject(new Error("no"));
        await first;

        const settings = get(botToolsStore)?.tools.s1.settings;
        expect(settings?.makesNew).toBe("rightAway");
        expect(settings?.looksUp).toBe("off");
        expect(get(botToolsStore)?.tools.s1.policyRevision).toBe(2);
    });

    it("keeps a different approval setting changed meanwhile when one save fails", async () => {
        mocks.getBotToolSettings.mockResolvedValueOnce({
            askBeforeMaking: 5,
            askWhichWay: "rarely",
            cardWaitMinutes: 10,
            allowMoreIdleMinutes: 60,
            allowMoreMaxMinutes: 480,
        });
        await loadBotToolSettings("botA");

        const failing = later<never>();
        mocks.saveBotToolSettings.mockReturnValueOnce(failing.promise);
        mocks.saveBotToolSettings.mockResolvedValueOnce({
            askBeforeMaking: 5,
            askWhichWay: "never",
            cardWaitMinutes: 10,
            allowMoreIdleMinutes: 60,
            allowMoreMaxMinutes: 480,
        });
        const first = saveBotToolSettings("botA", { cardWaitMinutes: 30 }).catch(() => undefined);
        await saveBotToolSettings("botA", { askWhichWay: "never" });
        failing.reject(new Error("no"));
        await first;

        expect(get(botToolsStore)?.settings).toEqual({
            askBeforeMaking: 5,
            askWhichWay: "never",
            cardWaitMinutes: 10,
            allowMoreIdleMinutes: 60,
            allowMoreMaxMinutes: 480,
        });
    });

    it("reads the list again when Confirm all is refused, so the next tap sends the new revision", async () => {
        beginBot("botA");
        setServers("botA", []);
        mocks.getMcpServerTools.mockResolvedValueOnce(server(1));
        await loadServerTools("botA", "s1");

        mocks.confirmMcpTools.mockRejectedValueOnce(new Error("The list changed"));
        mocks.getMcpServerTools.mockResolvedValueOnce(server(4));
        await expect(confirmAllTools("botA", "s1")).rejects.toThrow("The list changed");
        expect(get(botToolsStore)?.tools.s1.policyRevision).toBe(4);

        mocks.confirmMcpTools.mockResolvedValueOnce(server(5));
        await confirmAllTools("botA", "s1");
        expect(mocks.confirmMcpTools).toHaveBeenLastCalledWith("botA", "s1", 4);
    });

    it("does not let a slow server list for a bot left behind take the store back", () => {
        beginBot("botA");
        beginBot("botB");
        setServers("botB", []);
        setServers("botA", []);
        expect(get(botToolsStore)?.botId).toBe("botB");
    });
});
