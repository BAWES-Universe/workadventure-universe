import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

const game = vi.hoisted(() => ({
    getMyApps: vi.fn<() => Promise<unknown>>(),
    getBotMcpServers: vi.fn<(botId: string) => Promise<unknown>>(),
    getMcpServerTools: vi.fn<(botId: string, serverId: string) => Promise<unknown>>(),
    openAppsPage: vi.fn<(options?: unknown) => void>(),
    changeMyBrick: vi.fn<(id: string, change: unknown) => Promise<boolean>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the pages read on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        isInitialized: () => true,
        getMyApps: game.getMyApps,
        getBotMcpServers: game.getBotMcpServers,
        getMcpServerTools: game.getMcpServerTools,
    },
}));
vi.mock("../OpenApps", () => ({ openAppsPage: game.openAppsPage }));
vi.mock("../../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
vi.mock("../../MyBricksStore", () => ({ changeMyBrick: game.changeMyBrick }));
vi.mock("../../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../../Stores/MobileLayoutStore", async () => {
    const store = await import("svelte/store");
    return { mobileLayoutStore: store.writable(true) };
});
vi.mock("../../../../Stores/MapEditorStore", async () => {
    const store = await import("svelte/store");
    return { mapEditorVisibilityStore: store.writable(false) };
});

import { get } from "svelte/store";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import LL, { setLocale } from "../../../../../i18n/i18n-svelte";
import { parseMyApps, type MyApp } from "../Apps";
import { appPageStart } from "../AppLink";
import { forgetMyApps } from "../AppsStore";
import {
    appUseShown,
    changeShowAppUse,
    forgetShowAppUse,
    seedShowAppUse,
    takeShowAppUse,
    shownIn,
    showAppUseStates,
} from "../BrickShowAppUse";
import { appsBrief, appsOfBrick } from "../BrickApps";
import BrickAppsPage from "../BrickAppsPage.svelte";
import BrickAppsRow from "../BrickAppsRow.svelte";
import ShowAppUseRow from "../ShowAppUseRow.svelte";

const HEADINGS = { lookUp: "rightAway", make: "rightAway", change: "asksFirst", deleteSend: "asksFirst" };
const brickOf = (botId: string, over: Record<string, unknown> = {}) => ({
    botId,
    botName: botId === "b1" ? "Stay Brick" : "Other Brick",
    serverId: `s-${botId}`,
    enabled: true,
    headings: HEADINGS,
    ...over,
});
const app = (id: string, name: string, bricks: unknown[], over: Record<string, unknown> = {}) => ({
    id,
    name,
    authType: "oauth",
    source: "catalog",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-04T09:00:00.000Z",
    lendable: false,
    kind: "mcp",
    keyLast4: null,
    keyMode: null,
    bricks,
    ...over,
});
const parse = (apps: unknown[]): MyApp[] => parseMyApps({ apps, bricks: [] })?.apps ?? [];

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}
const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allById = (id: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const words = (element: HTMLElement | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("a Brick's Apps on its own page", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    describe("which apps a Brick can use, and the line under Apps", () => {
        const gmail = app("gmail", "Gmail", [brickOf("b1"), brickOf("b2")]);
        const calendar = app("cal", "Google Calendar", [brickOf("b1")]);
        const notion = app("notion", "Notion", [brickOf("b2")]);

        it("lists only the apps this Brick is on, in the order Orbit gave them", () => {
            const uses = appsOfBrick(parse([notion, gmail, calendar]), "b1");
            expect(uses?.map((use) => use.app.name)).toEqual(["Gmail", "Google Calendar"]);
            expect(uses?.[0].brick.botId).toBe("b1");
            expect(uses?.[0].brick.serverId).toBe("s-b1");
        });

        it("is undefined until the apps were read, and empty for a Brick that uses none", () => {
            expect(appsOfBrick(undefined, "b1")).toBeUndefined();
            expect(appsOfBrick(parse([notion]), "b1")).toEqual([]);
        });

        it("says the names, then 'and N more', and No apps yet when there are none", () => {
            const LLnow = get(LL);
            expect(appsBrief(appsOfBrick(parse([gmail]), "b1"), LLnow)).toBe("Gmail");
            expect(appsBrief(appsOfBrick(parse([gmail, calendar]), "b1"), LLnow)).toBe("Gmail and Google Calendar");
            const many = [gmail, calendar, app("n", "Notion", [brickOf("b1")]), app("s", "Slack", [brickOf("b1")])];
            expect(appsBrief(appsOfBrick(parse(many), "b1"), LLnow)).toBe("Gmail, Google Calendar and 2 more");
            expect(appsBrief(appsOfBrick(parse([notion]), "b1"), LLnow)).toBe("No apps yet");
            expect(appsBrief(undefined, LLnow)).toBe("");
        });

        it("leads with the app whose sign-in ended", () => {
            const LLnow = get(LL);
            const lost = app("cal", "Google Calendar", [brickOf("b1")], { reconnectRequired: true });
            expect(appsBrief(appsOfBrick(parse([gmail, lost]), "b1"), LLnow)).toBe(
                "Google Calendar needs signing in again"
            );
            const lost2 = app("n", "Notion", [brickOf("b1")], { reconnectRequired: true });
            expect(appsBrief(appsOfBrick(parse([lost, lost2]), "b1"), LLnow)).toBe("2 apps need signing in again");
        });

        it("says an app the Brick has turned off as off, never No apps yet", () => {
            const LLnow = get(LL);
            const off = app("gmail", "Gmail", [brickOf("b1", { enabled: false })]);
            expect(appsBrief(appsOfBrick(parse([off]), "b1"), LLnow)).toBe("Gmail · off");
            const off2 = app("n", "Notion", [brickOf("b1", { enabled: false })]);
            expect(appsBrief(appsOfBrick(parse([off, off2]), "b1"), LLnow)).toBe("Gmail and Notion · off");
            const on = app("cal", "Google Calendar", [brickOf("b1")]);
            expect(appsBrief(appsOfBrick(parse([on, off]), "b1"), LLnow)).toBe("Google Calendar · Gmail off");
        });
    });

    describe("the row and the screen", () => {
        let target: HTMLElement;
        let view: { $destroy: () => void } | undefined;

        beforeEach(() => {
            vi.clearAllMocks();
            forgetMyApps();
            forgetShowAppUse();
            game.changeMyBrick.mockResolvedValue(true);
            target = document.createElement("div");
            document.body.appendChild(target);
            game.getMyApps.mockResolvedValue({
                apps: [
                    app("gmail", "Gmail", [brickOf("b1"), brickOf("b2")]),
                    app("notion", "Notion", [brickOf("b2")]),
                    app("cal", "Google Calendar", [brickOf("b1", { headings: { ...HEADINGS, change: "off" } })]),
                ],
                bricks: [],
            });
            game.getBotMcpServers.mockResolvedValue([]);
            game.getMcpServerTools.mockReturnValue(new Promise(() => {}));
        });

        afterEach(() => {
            view?.$destroy();
            view = undefined;
            target.remove();
            document.body.innerHTML = "";
        });

        it("the row says Apps and which apps the Brick can use, and a tap opens the screen", async () => {
            const onOpen = vi.fn();
            const { loadMyApps } = await import("../AppsStore");
            await loadMyApps();
            view = new BrickAppsRow({ target, props: { botId: "b1", onOpen } });
            await settle();
            const row = byId("bot-page-group-apps");
            expect(words(row)).toBe("Apps App use shown · Gmail and Google Calendar");
            row?.querySelector("button")?.click();
            expect(onOpen).toHaveBeenCalledTimes(1);
        });

        it("the row says No apps yet for a Brick with no app, after the state", async () => {
            const { loadMyApps } = await import("../AppsStore");
            await loadMyApps();
            seedShowAppUse("nobody", false);
            view = new BrickAppsRow({ target, props: { botId: "nobody", onOpen: () => {} } });
            await settle();
            expect(words(byId("bot-page-group-apps"))).toBe("Apps App use hidden · No apps yet");
        });

        it("the screen lists this Brick's apps with what it may do, in the Apps page's own words", async () => {
            view = new BrickAppsPage({ target, props: { botId: "b1", botName: "Stay Brick", onBack: () => {} } });
            await settle();
            const rows = allById("brickAppRow").map(words);
            expect(rows).toHaveLength(2);
            expect(rows[0]).toBe(
                "Gmail Looks things up, makes new things right away · changes things, deletes or sends out ask first"
            );
            expect(rows[1]).toContain("Google Calendar");
            expect(words(byId("brickAppsPage"))).toContain("Tap an app to choose what Stay Brick may do with it.");
            // Another Brick's apps are not here
            expect(rows.join(" ")).not.toContain("Notion");
        });

        it("a tap on an app opens that app's screen for this Brick, and Back returns to the list and reads the apps again", async () => {
            view = new BrickAppsPage({ target, props: { botId: "b1", botName: "Stay Brick", onBack: () => {} } });
            await settle();
            const callsBefore = game.getMyApps.mock.calls.length;
            allById("brickAppRow")[0]?.click();
            await settle();
            expect(byId("appBrickScreen")).not.toBeNull();
            expect(byId("brickAppsPage")).toBeNull();
            expect(game.getBotMcpServers).toHaveBeenCalledWith("b1");
            byId("appBrickScreen")?.querySelector<HTMLElement>("button")?.click();
            await settle();
            expect(byId("brickAppsPage")).not.toBeNull();
            expect(game.getMyApps.mock.calls.length).toBeGreaterThan(callsBefore);
        });

        it("a Brick with no app says so, and Connect an app opens the Apps page", async () => {
            view = new BrickAppsPage({ target, props: { botId: "nobody", botName: "Fresh Brick", onBack: () => {} } });
            await settle();
            expect(allById("brickAppRow")).toHaveLength(0);
            expect(words(byId("brickAppsPage"))).toContain("Fresh Brick has no apps yet.");
            byId("brickAppsConnect")?.click();
            expect(game.openAppsPage).toHaveBeenCalledTimes(1);
        });

        it("a tap on an app whose sign-in ended goes to its page on the Apps page, where Reconnect is", async () => {
            game.getMyApps.mockResolvedValue({
                apps: [app("gmail", "Gmail", [brickOf("b1")], { reconnectRequired: true })],
                bricks: [],
            });
            view = new BrickAppsPage({ target, props: { botId: "b1", botName: "Stay Brick", onBack: () => {} } });
            await settle();
            allById("brickAppRow")[0]?.click();
            await settle();
            expect(get(appPageStart)).toBe("gmail");
            expect(game.openAppsPage).toHaveBeenCalledTimes(1);
            // Not the Brick's own screen for it: there is nothing to choose before it is signed in again
            expect(byId("appBrickScreen")).toBeNull();
        });

        it("an app whose sign-in ended says so in place of what it may do", async () => {
            game.getMyApps.mockResolvedValue({
                apps: [app("gmail", "Gmail", [brickOf("b1")], { reconnectRequired: true })],
                bricks: [],
            });
            view = new BrickAppsPage({ target, props: { botId: "b1", botName: "Stay Brick", onBack: () => {} } });
            await settle();
            expect(words(allById("brickAppRow")[0])).toBe("Gmail Sign-in ended · reconnect it");
        });

        it("says Try again when the apps could not be read, and reads them again", async () => {
            game.getMyApps.mockRejectedValueOnce(new Error("down"));
            view = new BrickAppsPage({ target, props: { botId: "b1", botName: "Stay Brick", onBack: () => {} } });
            await settle();
            expect(words(byId("brickAppsPage"))).toContain("Couldn't load your apps.");
            byId("brickAppsTryAgain")?.click();
            await settle();
            expect(allById("brickAppRow")).toHaveLength(2);
        });

        it("the row line says whether chat shows app use, the way the Brick's page read it", async () => {
            const { loadMyApps } = await import("../AppsStore");
            await loadMyApps();
            seedShowAppUse("b1", true);
            view = new BrickAppsRow({ target, props: { botId: "b1", onOpen: () => {} } });
            await settle();
            expect(words(byId("bot-page-group-apps"))).toBe("Apps App use shown · Gmail and Google Calendar");
            seedShowAppUse("b1", false);
            await settle();
            expect(words(byId("bot-page-group-apps"))).toBe("Apps App use hidden · Gmail and Google Calendar");
        });

        it("an unset Show app use reads as shown, and only an explicit off reads as hidden", () => {
            expect(appUseShown(undefined)).toBe(true);
            expect(appUseShown({})).toBe(true);
            expect(appUseShown({ showToolCalls: true })).toBe(true);
            expect(appUseShown({ showToolCalls: "no" })).toBe(true);
            expect(appUseShown({ showToolCalls: false })).toBe(false);
            expect(shownIn({}, "b1")).toBe(true);
            expect(shownIn({ b1: false }, "b1")).toBe(false);
        });

        it("the switch is a real switch for screen readers, named Show app use, and cannot be tapped while it saves", async () => {
            let finish: (saved: boolean) => void = () => {};
            game.changeMyBrick.mockReturnValue(
                new Promise<boolean>((resolve) => {
                    finish = resolve;
                })
            );
            view = new ShowAppUseRow({ target, props: { botId: "b1" } });
            await settle();
            const input = byId("showAppUseSwitch") as HTMLInputElement;
            expect(input.getAttribute("role")).toBe("switch");
            expect(input.getAttribute("aria-label")).toBe("Show app use");
            expect(input.getAttribute("aria-checked")).toBe("true");
            input.checked = false;
            input.dispatchEvent(new Event("change"));
            await settle();
            expect(input.disabled).toBe(true);
            expect(input.getAttribute("aria-checked")).toBe("false");
            finish(true);
            await settle();
            expect(input.disabled).toBe(false);
            expect(game.changeMyBrick).toHaveBeenCalledTimes(1);
        });

        it("stays disabled when the screen is left and opened again before the save ends, and is free after it", async () => {
            let finish: (saved: boolean) => void = () => {};
            game.changeMyBrick.mockReturnValue(
                new Promise<boolean>((resolve) => {
                    finish = resolve;
                })
            );
            view = new ShowAppUseRow({ target, props: { botId: "b1" } });
            await settle();
            const first = byId("showAppUseSwitch") as HTMLInputElement;
            first.checked = false;
            first.dispatchEvent(new Event("change"));
            await settle();
            view.$destroy();
            view = new ShowAppUseRow({ target, props: { botId: "b1" } });
            await settle();
            const again = byId("showAppUseSwitch") as HTMLInputElement;
            expect(again.disabled).toBe(true);
            finish(true);
            await settle();
            expect(again.disabled).toBe(false);
            expect(game.changeMyBrick).toHaveBeenCalledTimes(1);
        });

        it("the Apps screen has Show app use first, saves it at once, and the row line follows", async () => {
            seedShowAppUse("b1", false);
            view = new BrickAppsPage({ target, props: { botId: "b1", botName: "Stay Brick", onBack: () => {} } });
            await settle();
            expect(words(byId("showAppUse"))).toBe("Show app use App use stays hidden");
            const input = byId("showAppUseSwitch") as HTMLInputElement;
            input.checked = true;
            input.dispatchEvent(new Event("change"));
            await settle();
            expect(game.changeMyBrick).toHaveBeenCalledWith("b1", { behaviorConfig: { showToolCalls: true } });
            expect(get(showAppUseStates).b1).toBe(true);
            expect(words(byId("showAppUse"))).toBe("Show app use Shows which app it used in chat");
        });

        it("puts the switch back and says so under it when Orbit did not take it", async () => {
            game.changeMyBrick.mockResolvedValue(false);
            seedShowAppUse("b1", false);
            view = new ShowAppUseRow({ target, props: { botId: "b1" } });
            await settle();
            const input = byId("showAppUseSwitch") as HTMLInputElement;
            input.checked = true;
            input.dispatchEvent(new Event("change"));
            await settle();
            expect(get(showAppUseStates).b1).toBe(false);
            expect(words(byId("showAppUseFailed"))).toBe("Couldn't change Show app use. It is back to how it was.");
            expect(byId("showAppUseFailed")?.getAttribute("role")).toBe("alert");
            // The next change clears it
            game.changeMyBrick.mockResolvedValue(true);
            input.checked = false;
            input.dispatchEvent(new Event("change"));
            await settle();
            expect(byId("showAppUseFailed")).toBeNull();
        });
    });

    describe("Show app use, per Brick", () => {
        beforeEach(() => {
            vi.clearAllMocks();
            forgetShowAppUse();
        });

        it("a Brick nobody said anything about reads as shown, and one Brick's setting is not another's", async () => {
            game.changeMyBrick.mockResolvedValue(true);
            expect(get(showAppUseStates).b1).toBeUndefined();
            await changeShowAppUse("b1", true);
            expect(get(showAppUseStates)).toEqual({ b1: true });
            seedShowAppUse("b2", false);
            expect(get(showAppUseStates)).toEqual({ b1: true, b2: false });
        });

        it("what a read of the Brick says does not undo a change that is still on its way", async () => {
            let finish: (saved: boolean) => void = () => {};
            game.changeMyBrick.mockReturnValue(
                new Promise<boolean>((resolve) => {
                    finish = resolve;
                })
            );
            const change = changeShowAppUse("b1", false);
            takeShowAppUse("b1", true);
            expect(get(showAppUseStates).b1).toBe(false);
            finish(true);
            await change;
            expect(get(showAppUseStates).b1).toBe(false);
            takeShowAppUse("b1", true);
            expect(get(showAppUseStates).b1).toBe(true);
        });

        it("a second change while one is on its way does nothing", async () => {
            let finish: (saved: boolean) => void = () => {};
            game.changeMyBrick.mockReturnValue(
                new Promise<boolean>((resolve) => {
                    finish = resolve;
                })
            );
            const first = changeShowAppUse("b1", true);
            expect(await changeShowAppUse("b1", false)).toBe(false);
            finish(true);
            expect(await first).toBe(true);
            expect(game.changeMyBrick).toHaveBeenCalledTimes(1);
            expect(get(showAppUseStates).b1).toBe(true);
        });
    });
});
