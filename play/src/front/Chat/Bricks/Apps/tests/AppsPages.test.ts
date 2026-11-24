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
    getAppCatalog: vi.fn<() => Promise<unknown>>(),
    getReadyMadeApps: vi.fn<() => Promise<unknown>>(),
    getInstantApps: vi.fn<() => Promise<unknown>>(),
    getMyApp: vi.fn<(id: string) => Promise<unknown>>(),
    getMyAppUniverses: vi.fn<() => Promise<unknown>>(),
    getUniverseApps: vi.fn<(id: string) => Promise<unknown>>(),
    getTeamApp: vi.fn<(id: string) => Promise<unknown>>(),
    lendApp: vi.fn<(id: string, lend: unknown) => Promise<unknown>>(),
    changeAppLend: vi.fn<(id: string, universe: string, change: unknown) => Promise<unknown>>(),
    takeAppBack: vi.fn<(id: string, universe: string) => Promise<unknown>>(),
    letBrickUseApp: vi.fn<(id: string, botId: string) => Promise<unknown>>(),
    removeBrickFromApp: vi.fn<(id: string, botId: string) => Promise<unknown>>(),
    disconnectMyApp: vi.fn<(id: string) => Promise<unknown>>(),
    addTeamAppManager: vi.fn<(id: string, userId: string) => Promise<unknown>>(),
    removeTeamAppManager: vi.fn<(id: string, personId: string) => Promise<unknown>>(),
    disconnectTeamApp: vi.fn<(id: string) => Promise<unknown>>(),
    getAppsABotCouldUse: vi.fn<(botId: string) => Promise<unknown>>(),
    letBotUseApp: vi.fn<(botId: string, connectionId: string) => Promise<unknown>>(),
    discoverMcpOAuthEndpoints: vi.fn<(url: string, callback: string) => Promise<unknown>>(),
    addMyApp: vi.fn<(app: unknown) => Promise<unknown>>(),
    getMyAppThings: vi.fn<(id: string) => Promise<unknown>>(),
    getBotMcpServers: vi.fn<(botId: string) => Promise<unknown>>(),
    saveGitHubKey: vi.fn<(key: string) => Promise<unknown>>(),
    dropGitHubKey: vi.fn<() => Promise<unknown>>(),
    getAppShare: vi.fn<(id: string, botId: string) => Promise<unknown>>(),
    startAppShare: vi.fn<(id: string, botId: string, start: unknown) => Promise<unknown>>(),
    changeAppShare: vi.fn<(id: string, botId: string, change: unknown) => Promise<unknown>>(),
    stopAppShare: vi.fn<(id: string, botId: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the pages read on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        isInitialized: () => true,
        getMyApps: game.getMyApps,
        getAppCatalog: game.getAppCatalog,
        getReadyMadeApps: game.getReadyMadeApps,
        getInstantApps: game.getInstantApps,
        getMyApp: game.getMyApp,
        getMyAppUniverses: game.getMyAppUniverses,
        getUniverseApps: game.getUniverseApps,
        getTeamApp: game.getTeamApp,
        lendApp: game.lendApp,
        changeAppLend: game.changeAppLend,
        takeAppBack: game.takeAppBack,
        letBrickUseApp: game.letBrickUseApp,
        removeBrickFromApp: game.removeBrickFromApp,
        disconnectMyApp: game.disconnectMyApp,
        addTeamAppManager: game.addTeamAppManager,
        removeTeamAppManager: game.removeTeamAppManager,
        disconnectTeamApp: game.disconnectTeamApp,
        getAppsABotCouldUse: game.getAppsABotCouldUse,
        letBotUseApp: game.letBotUseApp,
        discoverMcpOAuthEndpoints: game.discoverMcpOAuthEndpoints,
        addMyApp: game.addMyApp,
        getMyAppThings: game.getMyAppThings,
        getBotMcpServers: game.getBotMcpServers,
        // What the Brick's own screens ask for once opened: these tests only check that they open
        getMcpServerTools: () => new Promise(() => {}),
        saveGitHubKey: game.saveGitHubKey,
        dropGitHubKey: game.dropGitHubKey,
        getAppShare: game.getAppShare,
        startAppShare: game.startAppShare,
        changeAppShare: game.changeAppShare,
        stopAppShare: game.stopAppShare,
    },
}));
// A Brick wearing a WOKA is drawn by the game's picture loader, which has nothing to do with these pages
vi.mock("../../BrickLookPicture", async () => {
    const store = await import("svelte/store");
    return { brickPicture: () => store.readable(undefined) };
});
// The pictures of the person's Bricks: only what the page reads from the store
vi.mock("../../MyBricksStore", async () => {
    const store = await import("svelte/store");
    return {
        myBricksStore: store.writable([{ id: "b1", name: "Brick", characterTextureId: "brick-orange" }]),
        loadMyBricks: vi.fn(() => Promise.resolve()),
    };
});
vi.mock("../../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
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
vi.mock("../Reconnect", () => ({
    reconnectApp: vi.fn(() => Promise.resolve("done")),
    signInInPopup: vi.fn(() => Promise.resolve("done")),
}));

import { reconnectApp } from "../Reconnect";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import AddManagerSheet from "../AddManagerSheet.svelte";
import AppPage from "../AppPage.svelte";
import AppsPage from "../AppsPage.svelte";
import { forgetMyApps } from "../AppsStore";
import GitHubWaitingSheet from "../GitHubWaitingSheet.svelte";
import LendSheet from "../LendSheet.svelte";
import MoreApps from "../MoreApps.svelte";
import TeamAppPage from "../TeamAppPage.svelte";
import TeamAppsPage from "../TeamAppsPage.svelte";

const HEADINGS = { lookUp: "rightAway", make: "rightAway", change: "asksFirst", deleteSend: "asksFirst" };
const tavily = (over: Record<string, unknown> = {}) => ({
    id: "tavily",
    name: "Tavily",
    authType: "api-key",
    source: "link",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-04T09:00:00.000Z",
    lendable: true,
    kind: "mcp",
    keyLast4: null,
    keyMode: null,
    bricks: [{ botId: "b1", botName: "Brick", serverId: "s1", enabled: true, headings: HEADINGS }],
    ...over,
});
const gmail = tavily({ id: "gmail", name: "Gmail", authType: "oauth", source: "catalog", lendable: false });
const lentRow = (over: Record<string, unknown> = {}) => ({
    universeId: "u1",
    universeName: "BAWES Universe",
    things: null,
    usesPerDay: 200,
    usedToday: 12,
    bots: [{ botId: "g", botName: "Guide", serverId: "sg", enabled: true, usesThisMonth: 34 }],
    ...over,
});
const appPage = (over: Record<string, unknown> = {}) => ({
    app: tavily(),
    canLetUse: [{ id: "b2", name: "Studio Brick" }],
    lentTo: [],
    canLendTo: [
        { id: "u1", name: "BAWES Universe", access: "owner" },
        { id: "u2", name: "Kuwait Makers", access: "manage" },
    ],
    ...over,
});
const shareJob = (over: Record<string, unknown> = {}) => ({
    tool: "search",
    title: "Search the web",
    description: "Looks things up",
    heading: "lookUp",
    picked: false,
    needsPicking: false,
    inputs: [
        { name: "query", required: true, picked: false },
        { name: "max_results", required: false, picked: false },
    ],
    returns: { names: ["title", "url", "content"], picked: null },
    ...over,
});
const shareView = (over: Record<string, unknown> = {}) => ({
    shareable: true,
    shared: false,
    reachable: true,
    limits: { usesPerDayEveryone: 50, usesPerDayPerson: 5 },
    usedToday: 0,
    jobs: [shareJob()],
    ...over,
});
/** The view of a Brick that shares Search the web, with the one job picked as the owner left it */
const sharedView = (over: Record<string, unknown> = {}) =>
    shareView({
        shared: true,
        usedToday: 12,
        jobs: [
            shareJob({
                picked: true,
                inputs: [
                    { name: "query", required: true, picked: true },
                    { name: "max_results", required: false, picked: false },
                ],
                returns: { names: ["title", "url", "content"], picked: ["title", "url"] },
            }),
            shareJob({
                tool: "extract",
                title: "Read a page",
                description: null,
                inputs: [],
                returns: { names: null, picked: null },
            }),
        ],
        ...over,
    });
const teamApp = (over: Record<string, unknown> = {}) => ({
    id: "notion",
    name: "Notion",
    universeId: "u1",
    universeName: "BAWES Universe",
    authType: "oauth",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-12T09:00:00.000Z",
    connectedBy: { id: "k", name: "Khalid", stillManages: true },
    managers: [
        { id: "k", name: "Khalid", owner: true, you: true },
        { id: "s", name: "Sara", owner: false },
    ],
    bots: [{ botId: "g", botName: "Guide", serverId: "sg", enabled: true }],
    usesThisMonth: 212,
    youManage: true,
    ...over,
});

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
async function click(id: string, index = 0): Promise<void> {
    allById(id)[index]?.click();
    await settle();
}

describe("the Apps pages (#2001)", () => {
    let target: HTMLElement;
    let page: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyApps();
        target = document.createElement("div");
        document.body.appendChild(target);
        game.getMyApps.mockResolvedValue({ apps: [gmail, tavily()], bricks: [] });
        game.getMyAppUniverses.mockResolvedValue({ universes: [] });
        game.getAppCatalog.mockResolvedValue({ apps: [] });
        game.getReadyMadeApps.mockResolvedValue({ apps: [] });
        game.getInstantApps.mockResolvedValue({ apps: [] });
        game.getMyApp.mockResolvedValue(appPage());
        game.lendApp.mockResolvedValue({});
        game.changeAppLend.mockResolvedValue({});
        game.takeAppBack.mockResolvedValue(undefined);
        game.letBrickUseApp.mockResolvedValue({});
        game.removeBrickFromApp.mockResolvedValue(undefined);
        game.disconnectMyApp.mockResolvedValue(undefined);
        game.getTeamApp.mockResolvedValue({
            app: teamApp(),
            canAddAsManager: [
                { id: "n", name: "Noura" },
                { id: "f", name: "Fahad" },
            ],
        });
        game.addTeamAppManager.mockResolvedValue({});
        game.removeTeamAppManager.mockResolvedValue(undefined);
        game.disconnectTeamApp.mockResolvedValue(undefined);
        game.getAppsABotCouldUse.mockResolvedValue({ apps: [] });
        game.letBotUseApp.mockResolvedValue({});
        game.getBotMcpServers.mockResolvedValue([]);
        game.getAppShare.mockResolvedValue(shareView());
        game.startAppShare.mockResolvedValue(sharedView());
        game.changeAppShare.mockResolvedValue(sharedView());
        game.stopAppShare.mockResolvedValue(undefined);
    });

    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
        document.body.innerHTML = "";
    });

    describe("the Apps page", () => {
        it("lists the connected apps with the Bricks that use them, and marks one added by the person", async () => {
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            const rows = allById("appsRow").map(words);
            expect(rows[0]).toBe("Gmail Used by Brick");
            expect(rows[1]).toBe("Tavily Added by you · Used by Brick");
            expect(byId("appsUniverses")).toBeNull();
        });

        it("lists the Instant Apps as Ready to use, with no Connect button, and no section when there are none", async () => {
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(byId("appsInstant")).toBeNull();
            expect(allById("appsInstantRow")).toHaveLength(0);
            page.$destroy();
            game.getInstantApps.mockResolvedValue({
                apps: [
                    { key: "instant-video", name: "Instant video", blurb: "Make short videos" },
                    { key: "instant-flights", name: "Instant flights", blurb: "" },
                ],
            });
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(words(byId("appsInstant"))).toBe("Ready to use");
            const rows = allById("appsInstantRow");
            expect(rows.map(words)).toEqual(["Instant video Make short videos", "Instant flights"]);
            expect(rows[0].querySelector('[data-testid="appsConnect"]')).toBeNull();
            expect(rows[0].tagName).toBe("DIV");
        });

        it("searches the Instant Apps by name and line, and shows no price or provider", async () => {
            game.getInstantApps.mockResolvedValue({
                apps: [
                    { key: "instant-video", name: "Instant video", blurb: "Make short videos" },
                    { key: "instant-flights", name: "Instant flights", blurb: "Find flights" },
                ],
            });
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            const input = byId("appsSearchInput") as HTMLInputElement;
            input.value = "flights";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await settle();
            expect(allById("appsInstantRow").map(words)).toEqual(["Instant flights Find flights"]);
            expect(words(byId("appsFound"))).toBe("1 app");
            expect(document.body.textContent).not.toMatch(/\$|composio|per use|credit/i);
        });

        it("shows the rest of the page when the Instant Apps could not be read", async () => {
            game.getInstantApps.mockRejectedValue(new Error("offline"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            warn.mockRestore();
            expect(allById("appsRow")).toHaveLength(2);
            expect(byId("appsInstant")).toBeNull();
            expect(byId("appsLoadFailed")).toBeNull();
        });

        it("treats an Instant Apps answer it cannot read as a failed read, with the message and Try again in a search", async () => {
            game.getInstantApps.mockResolvedValue({ apps: [{ name: "Instant video", blurb: "Make short videos" }] });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(byId("appsInstant")).toBeNull();
            const input = byId("appsSearchInput") as HTMLInputElement;
            input.value = "video";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await settle();
            expect(byId("appsInstantFailed")).not.toBeNull();
            expect(byId("appsNoMatch")).toBeNull();
            game.getInstantApps.mockResolvedValue({
                apps: [{ key: "instant-video", name: "Instant video", blurb: "Make short videos" }],
            });
            await click("appsInstantTryAgain");
            warn.mockRestore();
            expect(byId("appsInstantFailed")).toBeNull();
            expect(allById("appsInstantRow").map(words)).toEqual(["Instant video Make short videos"]);
        });

        it("keeps the Instant Apps when an older read ends after the newer one", async () => {
            let answerFirst: (answer: unknown) => void = () => undefined;
            game.getInstantApps.mockReset();
            game.getInstantApps
                .mockReturnValueOnce(
                    new Promise((resolve) => {
                        answerFirst = resolve;
                    })
                )
                .mockResolvedValue({
                    apps: [{ key: "instant-video", name: "Instant video", blurb: "Make short videos" }],
                });
            game.getAppCatalog.mockRejectedValueOnce(new Error("offline"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(byId("appsConnectListFailed")).not.toBeNull();
            // The retry starts a second read, which answers with the list while the first is still out
            await click("appsConnectListTryAgain");
            expect(allById("appsInstantRow")).toHaveLength(1);
            answerFirst({ apps: [] });
            await settle();
            warn.mockRestore();
            expect(allById("appsInstantRow")).toHaveLength(1);
            expect(byId("appsInstant")).not.toBeNull();
        });

        it("says the ready-to-use apps could not be read when a search needs them, and reads them again", async () => {
            game.getInstantApps.mockReset();
            game.getInstantApps.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({
                apps: [{ key: "instant-flights", name: "Instant flights", blurb: "Find flights" }],
            });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(byId("appsInstantFailed")).toBeNull();
            const input = byId("appsSearchInput") as HTMLInputElement;
            input.value = "flights";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await settle();
            // No claim of "no match" and no count that leaves them out
            expect(byId("appsNoMatch")).toBeNull();
            expect(byId("appsFound")).toBeNull();
            expect(words(byId("appsInstantFailed"))).toBe(
                "Couldn't load the ready-to-use apps, so they are not in these results."
            );
            await click("appsInstantTryAgain");
            warn.mockRestore();
            expect(byId("appsInstantFailed")).toBeNull();
            expect(allById("appsInstantRow").map(words)).toEqual(["Instant flights Find flights"]);
            expect(words(byId("appsFound"))).toBe("1 app");
        });

        it("has Add your own app as its last row, which opens the sheet, and Done opens the new app's page to choose Bricks", async () => {
            game.discoverMcpOAuthEndpoints.mockResolvedValue({
                discovered: true,
                name: "Zapier",
                signsInWith: "Zapier",
                authorizeUrl: "https://zapier.com/authorize",
                tokenUrl: "https://zapier.com/token",
                clientId: "c1",
                registrationStatus: "auto",
            });
            game.addMyApp.mockResolvedValue({ id: "zapier", name: "Zapier" });
            game.getMyAppThings.mockResolvedValue({ things: ["Find Events"] });
            game.getMyApp.mockResolvedValue(appPage({ app: tavily({ id: "zapier", name: "Zapier" }) }));
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(words(byId("appsAddOwn"))).toBe("Add your own app Paste its link, like Firecrawl");
            expect(byId("addAppSheet")).toBeNull();
            await click("appsAddOwn");
            expect(byId("addAppSheet")).not.toBeNull();
            const link = byId("addAppLink") as HTMLInputElement;
            link.value = "https://mcp.zapier.com/api/mcp/mcp";
            link.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
            await settle();
            await click("addAppSignIn");
            expect(byId("addAppConnected")).not.toBeNull();
            await click("addAppDone");
            expect(byId("addAppSheet")).toBeNull();
            expect(game.getMyApp).toHaveBeenCalledWith("zapier");
            expect(byId("appPage")).not.toBeNull();
        });

        it("says so when no Brick uses an app yet, and when its sign-in ended", async () => {
            game.getMyApps.mockResolvedValue({
                apps: [tavily({ bricks: [] }), gmail && { ...gmail, reconnectRequired: true }],
                bricks: [],
            });
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            const rows = allById("appsRow").map(words);
            expect(rows[0]).toBe("Tavily Added by you · Not used by any Brick yet");
            expect(rows[1]).toBe("Gmail Sign-in ended · reconnect it");
        });

        it("shows Your universes only for someone who manages bots somewhere, and opens a universe's apps", async () => {
            game.getMyAppUniverses.mockResolvedValue({
                universes: [
                    { id: "u1", name: "BAWES Universe", apps: 2 },
                    { id: "u2", name: "Kuwait Makers", apps: 0 },
                ],
            });
            game.getUniverseApps.mockResolvedValue({ apps: [teamApp()] });
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(allById("appsUniverseRow").map(words)).toEqual([
                "BAWES Universe 2 apps · they belong to the universe",
                "Kuwait Makers No apps yet",
            ]);
            await click("appsUniverseRow");
            expect(byId("teamAppsPage")).not.toBeNull();
            expect(game.getUniverseApps).toHaveBeenCalledWith("u1");
            expect(words(byId("teamAppRow"))).toBe("Notion Used by Guide");
        });

        it("says it could not read the apps, and tries again", async () => {
            game.getMyApps.mockRejectedValueOnce(new Error("down"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            expect(byId("appsLoadFailed")).not.toBeNull();
            await click("appsTryAgain");
            warn.mockRestore();
            expect(allById("appsRow")).toHaveLength(2);
        });

        it("opens an app's page from its row", async () => {
            page = new AppsPage({ target, props: { onBack: () => {} } });
            await settle();
            await click("appsRow", 1);
            expect(byId("appPage")).not.toBeNull();
            expect(game.getMyApp).toHaveBeenCalledWith("tavily");
        });
    });

    describe("Other people: letting others use an app through a Brick (#2006)", () => {
        const open = async (id = "tavily") => {
            page = new AppPage({ target, props: { appId: id, onBack: () => {} } });
            await settle();
        };
        const sheetButton = (label: string): HTMLElement | undefined =>
            [...document.querySelectorAll<HTMLElement>('[data-testid="appShareSheet"] button')].find(
                (one) => words(one) === label
            );
        const tapSheet = async (label: string) => {
            sheetButton(label)?.click();
            await settle();
        };
        const twoJobs = () =>
            shareView({
                jobs: [
                    shareJob(),
                    shareJob({
                        tool: "extract",
                        title: "Read a page",
                        description: null,
                        inputs: [],
                        returns: { names: null, picked: null },
                    }),
                ],
            });

        it("says Only you with one button for a Brick that uses the app, reading what is shared for that Brick", async () => {
            await open();
            expect(game.getAppShare).toHaveBeenCalledWith("tavily", "b1");
            expect(words(byId("appShareOff"))).toBe(
                "Only you People who chat with Brick can't use it Let others use it"
            );
            expect(allById("appShareStart")).toHaveLength(1);
            expect(byId("appOnlyYou")).toBeNull();
        });

        it("starts at once when the app has one thing to ask for, then shows what people can ask for and the two limits", async () => {
            await open();
            await click("appShareStart");
            expect(game.startAppShare).toHaveBeenCalledWith("tavily", "b1", {});
            expect(byId("appShareSheet")).toBeNull();
            expect(words(byId("appShareOn"))).toContain("People who chat with Brick Can ask for: Search the web");
            expect(words(byId("appShareLimits"))).toBe("50 uses a day for everyone · 5 for each person");
            expect(words(byId("appShareToday"))).toBe("Today: 12 of 50 used. Your own chats never count.");
        });

        it("opens a sheet to pick jobs when there are several, and starts only the ones picked, with what they fill in and get back", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            await open();
            await click("appShareStart");
            expect(game.startAppShare).not.toHaveBeenCalled();
            expect(byId("appShareSheet")).not.toBeNull();
            // Nothing picked yet: nothing can be sent
            expect(byId("appSharePickOne")).not.toBeNull();
            expect(byId("appShareConfirm")?.hasAttribute("disabled")).toBe(true);
            await click("appShareJobPick", 0);
            expect(byId("appSharePickOne")).toBeNull();
            expect(byId("appShareConfirm")?.hasAttribute("disabled")).toBe(false);
            // What it cannot work without is offered and cannot be taken out; the optional one is the owner's to add
            const inputs = allById("appShareInput");
            expect(inputs.map((one) => one.getAttribute("aria-checked"))).toEqual(["true", "false"]);
            expect(inputs[0]?.hasAttribute("disabled")).toBe(true);
            await click("appShareInput", 1);
            // One field of its answer taken out
            await click("appShareReturn", 2);
            await tapSheet("Let others use it");
            expect(game.startAppShare).toHaveBeenCalledWith("tavily", "b1", {
                jobs: [{ tool: "search", inputs: ["query", "max_results"], returns: ["title", "url"] }],
                usesPerDayEveryone: 50,
                usesPerDayPerson: 5,
            });
            expect(byId("appShareSheet")).toBeNull();
            expect(byId("appShareOn")).not.toBeNull();
        });

        it("says a job that gives back no named fields gives its whole answer, nothing more", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            await open();
            await click("appShareStart");
            await click("appShareJobPick", 1);
            expect(words(byId("appShareGetBackAll"))).toBe("Its whole answer, nothing else of Tavily");
            await tapSheet("Let others use it");
            expect(game.startAppShare).toHaveBeenCalledWith("tavily", "b1", {
                jobs: [{ tool: "extract", inputs: [], returns: null }],
                usesPerDayEveryone: 50,
                usesPerDayPerson: 5,
            });
        });

        it("brings back what was set for a job when it is unticked and ticked again", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            await open();
            await click("appShareStart");
            await click("appShareJobPick", 0);
            // Only title and url come back, and the optional input is added
            await click("appShareReturn", 2);
            await click("appShareInput", 1);
            await click("appShareJobPick", 0);
            await click("appShareJobPick", 0);
            expect(allById("appShareReturn").map((one) => one.getAttribute("aria-checked"))).toEqual([
                "true",
                "true",
                "false",
            ]);
            expect(allById("appShareInput").map((one) => one.getAttribute("aria-checked"))).toEqual(["true", "true"]);
            await tapSheet("Let others use it");
            expect(game.startAppShare).toHaveBeenCalledWith("tavily", "b1", {
                jobs: [{ tool: "search", inputs: ["query", "max_results"], returns: ["title", "url"] }],
                usesPerDayEveryone: 50,
                usesPerDayPerson: 5,
            });
        });

        it("cannot send a job with nothing coming back", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            await open();
            await click("appShareStart");
            await click("appShareJobPick", 0);
            await click("appShareReturn", 0);
            await click("appShareReturn", 1);
            await click("appShareReturn", 2);
            expect(byId("appShareGetBackOne")).not.toBeNull();
            expect(byId("appShareConfirm")?.hasAttribute("disabled")).toBe(true);
        });

        it("changes what is shared and the limits in one go, with the jobs already shared picked as they are", async () => {
            game.getAppShare.mockResolvedValue(sharedView());
            await open();
            await click("appShareChange");
            const picks = allById("appShareJobPick").map((one) => one.getAttribute("aria-checked"));
            expect(picks).toEqual(["true", "false"]);
            // The returns the owner left are kept: title and url, not content
            expect(allById("appShareReturn").map((one) => one.getAttribute("aria-checked"))).toEqual([
                "true",
                "true",
                "false",
            ]);
            const chip = [
                ...document.querySelectorAll<HTMLElement>('[data-testid="appShareSheet"] [role="radio"]'),
            ].find((one) => words(one) === "100");
            chip?.click();
            await settle();
            await tapSheet("Save");
            expect(game.changeAppShare).toHaveBeenCalledWith("tavily", "b1", {
                jobs: [{ tool: "search", inputs: ["query"], returns: ["title", "url"] }],
                usesPerDayEveryone: 100,
                usesPerDayPerson: 5,
            });
            expect(byId("appShareSheet")).toBeNull();
        });

        it("shows a restricted choice for a job whose app no longer names its fields, never as the whole answer", async () => {
            game.getAppShare.mockResolvedValue(
                sharedView({
                    jobs: [
                        shareJob({
                            picked: true,
                            inputs: [{ name: "query", required: true, picked: true }],
                            returns: { names: null, picked: ["title", "url"] },
                        }),
                    ],
                })
            );
            await open();
            await click("appShareChange");
            expect(byId("appShareGetBackAll")).toBeNull();
            expect(allById("appShareGetBackKept").map((one) => words(one))).toEqual(["title", "url"]);
        });

        it("reads what is shared again when a change got no answer (a timeout), and keeps the old state as it was only for a definite refusal", async () => {
            game.getAppShare.mockResolvedValue(sharedView());
            game.changeAppShare.mockRejectedValue(new Error("offline"));
            await open();
            await click("appShareChange");
            await tapSheet("Save");
            expect(game.getAppShare).toHaveBeenCalledTimes(2);
            game.getAppShare.mockClear();
            // A definite refusal: nothing changed, nothing is read again
            game.changeAppShare.mockRejectedValue(Object.assign(new Error("No."), { status: 409 }));
            await click("appShareChange");
            await tapSheet("Save");
            expect(game.getAppShare).not.toHaveBeenCalled();
        });

        it("keeps the sheet, its picks and its failure line open when a save got no answer and what is shared is read again", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            game.startAppShare.mockRejectedValue(new Error("offline"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            await open();
            await click("appShareStart");
            await click("appShareJobPick", 1);
            await tapSheet("Let others use it");
            warn.mockRestore();
            // It was read again (the answer may have gone through), and the sheet is still there with what was picked and a failure shown
            expect(game.getAppShare).toHaveBeenCalledTimes(2);
            expect(byId("appShareSheet")).not.toBeNull();
            expect(byId("appShareFailed")).not.toBeNull();
            expect(allById("appShareJobPick").map((one) => one.getAttribute("aria-checked"))).toEqual([
                "false",
                "true",
            ]);
        });

        it("stops at once with one tap and nothing to confirm, and then says Only you again", async () => {
            game.getAppShare.mockResolvedValueOnce(sharedView());
            await open();
            expect(words(byId("appShareStopLine"))).toBe(
                "Anyone asking after this gets nothing from Tavily, also in a chat that is already open."
            );
            game.getAppShare.mockResolvedValue(shareView());
            await click("appShareStop");
            expect(game.stopAppShare).toHaveBeenCalledWith("tavily", "b1");
            expect(byId("appShareSheet")).toBeNull();
            expect(byId("appShareOff")).not.toBeNull();
            expect(byId("appShareOn")).toBeNull();
        });

        it("keeps sharing shown and says nothing changed when Orbit refused to stop it", async () => {
            game.getAppShare.mockResolvedValue(sharedView());
            game.stopAppShare.mockRejectedValue(Object.assign(new Error("refused"), { status: 409 }));
            await open();
            await click("appShareStop");
            expect(game.warn).toHaveBeenCalledWith("That didn't go through. Nothing changed.");
            expect(byId("appShareOn")).not.toBeNull();
            // Only the first read: a refusal leaves sharing as it was
            expect(game.getAppShare).toHaveBeenCalledTimes(1);
        });

        it("does not say nothing changed when the answer to stopping never came: it reads what is shared again", async () => {
            game.getAppShare.mockResolvedValueOnce(sharedView());
            game.stopAppShare.mockRejectedValue(new Error("Orbit did not answer in time"));
            await open();
            // Orbit did stop it, only the answer was lost
            game.getAppShare.mockResolvedValue(shareView());
            await click("appShareStop");
            expect(game.warn).toHaveBeenCalledWith("We couldn't tell if sharing stopped. Checking now.");
            expect(game.warn).not.toHaveBeenCalledWith("That didn't go through. Nothing changed.");
            expect(game.getAppShare).toHaveBeenCalledTimes(2);
            expect(byId("appShareOff")).not.toBeNull();
            expect(byId("appShareOn")).toBeNull();
        });

        it("does not show sharing as on when it stopped but reading what is shared again failed, and offers to try again", async () => {
            game.getAppShare.mockResolvedValueOnce(sharedView());
            await open();
            game.getAppShare.mockRejectedValueOnce(new Error("down"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            await click("appShareStop");
            expect(game.stopAppShare).toHaveBeenCalledWith("tavily", "b1");
            expect(byId("appShareOn")).toBeNull();
            expect(byId("appShareLoadFailed")).not.toBeNull();
            game.getAppShare.mockResolvedValue(shareView());
            await click("appShareTryAgain");
            warn.mockRestore();
            expect(byId("appShareOff")).not.toBeNull();
        });

        it("keeps the row locked until what is shared has been read again after stopping", async () => {
            game.getAppShare.mockResolvedValueOnce(sharedView());
            await open();
            let finishRead: (value: unknown) => void = () => undefined;
            game.getAppShare.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finishRead = resolve;
                    })
            );
            await click("appShareStop");
            // Reading again has not finished: the old row is gone, so Change cannot open an editor for sharing that has stopped
            expect(byId("appShareChange")).toBeNull();
            expect(byId("appShareSheet")).toBeNull();
            finishRead(shareView());
            await settle();
            expect(byId("appShareOff")).not.toBeNull();
        });

        it("says so, and offers no way to change what is shared, when sharing is on but the app cannot be read", async () => {
            game.getAppShare.mockResolvedValue(sharedView({ reachable: false }));
            await open();
            expect(byId("appShareUnreachable")).not.toBeNull();
            expect(byId("appShareChange")).toBeNull();
            // Stopping is always possible
            expect(byId("appShareStop")).not.toBeNull();
        });

        it("keeps the sheet's choices from changing while it is saving, and lets them change again when saving failed", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            await open();
            await click("appShareStart");
            await click("appShareJobPick", 0);
            let answer: (value: unknown) => void = () => undefined;
            let failSave: (error: unknown) => void = () => undefined;
            game.startAppShare.mockImplementation(
                () =>
                    new Promise((resolve, reject) => {
                        answer = resolve;
                        failSave = reject;
                    })
            );
            await tapSheet("Let others use it");
            const locked = [
                ...allById("appShareJobPick"),
                ...allById("appShareReturn"),
                ...document.querySelectorAll<HTMLElement>('[data-testid="appShareSheet"] [role="radio"]'),
            ];
            expect(locked.length).toBeGreaterThan(4);
            expect(locked.every((one) => one.hasAttribute("disabled"))).toBe(true);
            expect(allById("appShareInput").every((one) => one.hasAttribute("disabled"))).toBe(true);
            expect(answer).toBeDefined();
            // Nor does the sheet close under a save that is on its way: not by Cancel, Escape or a tap beside it
            expect(byId("appShareCancel")?.hasAttribute("disabled")).toBe(true);
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            document.querySelector<HTMLElement>(".sh-scrim")?.click();
            await settle();
            expect(byId("appShareSheet")).not.toBeNull();
            vi.spyOn(console, "warn").mockImplementation(() => undefined);
            failSave(new Error("offline"));
            await settle();
            expect(byId("appShareCancel")?.hasAttribute("disabled")).toBe(false);
            expect(allById("appShareJobPick").every((one) => !one.hasAttribute("disabled"))).toBe(true);
            expect(allById("appShareReturn").every((one) => !one.hasAttribute("disabled"))).toBe(true);
        });

        it("shows Orbit's own words in the sheet when it would not take a pick, and keeps the sheet open", async () => {
            game.getAppShare.mockResolvedValue(twoJobs());
            const refused = Object.assign(
                new Error("The job needs an input that is not offered, so nobody could ask for it"),
                { status: 400 }
            );
            game.startAppShare.mockRejectedValue(refused);
            await open();
            await click("appShareStart");
            await click("appShareJobPick", 0);
            await tapSheet("Let others use it");
            expect(words(byId("appShareFailed"))).toBe(
                "The job needs an input that is not offered, so nobody could ask for it"
            );
            expect(byId("appShareSheet")).not.toBeNull();
        });

        it("offers no button when the app did not answer, and says to try again soon", async () => {
            game.getAppShare.mockResolvedValue(shareView({ reachable: false }));
            await open();
            expect(byId("appShareStart")).toBeNull();
            expect(words(byId("appShareUnreachable"))).toBe(
                "Tavily didn't answer just now, so what people can ask for can't be picked. Try again soon."
            );
        });

        it("says there is nothing to ask for, with no button, when the app has no job that can be shared", async () => {
            game.getAppShare.mockResolvedValue(shareView({ jobs: [] }));
            await open();
            expect(byId("appShareStart")).toBeNull();
            expect(byId("appShareNothing")).not.toBeNull();
        });

        it("marks a job that changed since it was shared as paused, and does not count it as shared", async () => {
            game.getAppShare.mockResolvedValue(
                sharedView({
                    jobs: [
                        shareJob({ picked: true }),
                        shareJob({
                            tool: "extract",
                            title: "Read a page",
                            needsPicking: true,
                            inputs: [],
                            returns: { names: null, picked: null },
                        }),
                    ],
                })
            );
            await open();
            expect(words(byId("appShareOn"))).toContain("Can ask for: Search the web");
            expect(words(byId("appShareOn"))).not.toContain("Read a page");
            await click("appShareChange");
            expect(words(byId("appSharePaused"))).toBe(
                "It changed since you shared it, so it is paused. Pick it again to share it."
            );
        });

        it("has a block for each Brick that uses the app", async () => {
            game.getMyApp.mockResolvedValue(
                appPage({
                    app: tavily({
                        bricks: [
                            { botId: "b1", botName: "Brick", serverId: "s1", enabled: true, headings: HEADINGS },
                            { botId: "b2", botName: "Studio Brick", serverId: "s2", enabled: true, headings: HEADINGS },
                        ],
                    }),
                })
            );
            await open();
            expect(game.getAppShare).toHaveBeenCalledWith("tavily", "b1");
            expect(game.getAppShare).toHaveBeenCalledWith("tavily", "b2");
            expect(allById("appShareOff").map(words)).toEqual([
                "Only you People who chat with Brick can't use it Let others use it",
                "Only you People who chat with Studio Brick can't use it Let others use it",
            ]);
        });

        it("says Only for you, with no button and no reading of shares, for an app signed in as the person", async () => {
            game.getMyApp.mockResolvedValue(appPage({ app: gmail }));
            await open("gmail");
            expect(byId("appOnlyForYou")).not.toBeNull();
            expect(byId("appShare")).toBeNull();
            expect(game.getAppShare).not.toHaveBeenCalled();
        });

        it("says so, with Try again, when what is shared could not be read", async () => {
            game.getAppShare.mockRejectedValueOnce(new Error("offline"));
            await open();
            expect(words(byId("appShareLoadFailed"))).toBe("Couldn't read who can ask for this.");
            await click("appShareTryAgain");
            expect(byId("appShareOff")).not.toBeNull();
        });
    });

    describe("an app of the person's own", () => {
        const open = async (id = "tavily") => {
            page = new AppPage({ target, props: { appId: id, onBack: () => {} } });
            await settle();
        };

        it("shows Lent to, with nowhere yet, for an app added with a link and a key", async () => {
            await open();
            expect(byId("appLentTo")).not.toBeNull();
            expect(words(byId("appPage"))).toContain(
                "No universe yet. Bots in a universe can't use Tavily until you lend it there."
            );
            expect(byId("appLendGo")).not.toBeNull();
            expect(byId("appOnlyForYou")).toBeNull();
        });

        it("says Only you under Other people, with no button, for an app that can be lent and no Brick uses yet", async () => {
            game.getMyApp.mockResolvedValue(appPage({ app: tavily({ bricks: [] }) }));
            await open();
            expect(words(byId("appOnlyYou"))).toBe("Only you People who chat with your Bricks can't use it");
            expect(byId("appOnlyYou")?.querySelector("button")).toBeNull();
            expect(words(byId("appPage"))).toContain("Other people");
            expect(game.getAppShare).not.toHaveBeenCalled();
        });

        it("shows each Brick's picture, and opens what that Brick may do from its row and its arrow", async () => {
            await open();
            const row = byId("appBrickRow");
            expect(row?.querySelector("img.bk-look")).not.toBeNull();
            expect(words(byId("appPage"))).toContain("Tap a Brick that uses it to change what it may do");
            expect(byId("appBrickScreen")).toBeNull();
            await click("appRowGo");
            expect(byId("appBrickScreen")).not.toBeNull();
            expect(byId("appPage")).toBeNull();
            // Back goes to the app's page, and reads it again
            const callsBefore = game.getMyApp.mock.calls.length;
            byId("appBrickScreen")?.querySelector<HTMLElement>("button")?.click();
            await settle();
            expect(byId("appPage")).not.toBeNull();
            expect(game.getMyApp.mock.calls.length).toBeGreaterThan(callsBefore);
            await click("appRowOpen");
            expect(byId("appBrickScreen")).not.toBeNull();
        });

        it("says Only for you, and has no Lent to at all, for an app signed in as the person", async () => {
            game.getMyApp.mockResolvedValue(appPage({ app: gmail, canLendTo: [], canLetUse: [] }));
            await open("gmail");
            expect(words(byId("appOnlyForYou"))).toContain("Only for you");
            expect(byId("appLentTo")).toBeNull();
            expect(byId("appLendGo")).toBeNull();
            expect(byId("appLentTo")).toBeNull();
        });

        it("lends to the universe picked, for all four things and 200 a day, then reads the page again", async () => {
            await open();
            await click("appLendGo");
            expect(words(byId("appLendSheet"))).toContain("Lend Tavily");
            expect(allById("appLendUniverse").map(words)).toEqual([
                "BAWES Universe You own this universe",
                "Kuwait Makers You have Manage bots here",
            ]);
            await click("appLendUniverse", 1);
            game.getMyApp.mockResolvedValue(
                appPage({ lentTo: [lentRow({ universeId: "u2", universeName: "Kuwait Makers", bots: [] })] })
            );
            await click("appLendConfirm");
            expect(game.lendApp).toHaveBeenCalledWith("tavily", { universeId: "u2", things: null, usesPerDay: 200 });
            expect(byId("appLendSheet")).toBeNull();
            expect(words(byId("appLent"))).toContain("Kuwait Makers");
            expect(words(byId("appLent"))).toContain("Do all 4 things · 200 uses a day");
            expect(words(byId("appLent"))).toContain(
                "No bot uses it yet. In a bot you manage there, let it use Tavily under Apps."
            );
        });

        it("lends only the things ticked, and the limit picked, and cannot lend with none ticked", async () => {
            await open();
            await click("appLendGo");
            await click("appLendOnly");
            // All four start ticked: untick every one
            // eslint-disable-next-line no-await-in-loop
            for (let i = 0; i < 4; i++) await click("appLendThing", i);
            expect(byId("appLendPickOne")).not.toBeNull();
            expect((byId("appLendConfirm") as HTMLButtonElement).disabled).toBe(true);
            await click("appLendThing", 0);
            await click("appLendThing", 1);
            const chips = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"] .bp-chip')];
            chips.find((chip) => chip.textContent?.trim() === "No limit")?.click();
            await settle();
            await click("appLendConfirm");
            expect(game.lendApp).toHaveBeenCalledWith("tavily", {
                universeId: "u1",
                things: ["lookUp", "make"],
                usesPerDay: null,
            });
        });

        it("says it did not go through, and keeps the sheet, when Orbit refuses", async () => {
            game.lendApp.mockRejectedValue(new Error("403"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            await open();
            await click("appLendGo");
            await click("appLendConfirm");
            warn.mockRestore();
            expect(byId("appLendSheet")).not.toBeNull();
            expect(game.warn).toHaveBeenCalledWith("That didn't go through. Nothing changed.");
        });

        it("shows a lend with what bots may do, each bot's uses, and today's count, and changes it", async () => {
            game.getMyApp.mockResolvedValue(
                appPage({ lentTo: [lentRow({ things: ["lookUp", "make"] })], canLendTo: [] })
            );
            await open();
            const lent = words(byId("appLent"));
            expect(lent).toContain("Only: looks things up, makes new things · 200 uses a day");
            expect(lent).toContain("Guide · 34 uses this month");
            expect(lent).toContain("Today 12 of 200 used. Every use is counted on your Usage page.");
            await click("appLendChange");
            expect(words(byId("appLendSheet"))).toContain("Change Tavily for BAWES Universe");
            expect(allById("appLendUniverse")).toHaveLength(0);
            await click("appLendConfirm");
            expect(game.changeAppLend).toHaveBeenCalledWith("tavily", "u1", {
                things: ["lookUp", "make"],
                usesPerDay: 200,
            });
        });

        it("says no limit on a lend with none, and does not say '0 of' anything", async () => {
            game.getMyApp.mockResolvedValue(appPage({ lentTo: [lentRow({ usesPerDay: null })], canLendTo: [] }));
            await open();
            const lent = words(byId("appLent"));
            expect(lent).toContain("No limit on uses");
            expect(lent).toContain("Today 12 used. Every use is counted on your Usage page.");
        });

        it("takes an app back only after asking, and says what stops", async () => {
            game.getMyApp.mockResolvedValue(appPage({ lentTo: [lentRow()], canLendTo: [] }));
            await open();
            await click("appTakeBack");
            expect(game.takeAppBack).not.toHaveBeenCalled();
            expect(words(byId("appTakeBackSheet"))).toContain("Take Tavily back from BAWES Universe?");
            expect(words(byId("appTakeBackSheet"))).toContain(
                "Guide stops using Tavily at once, also in a chat that is already open."
            );
            expect(words(byId("appTakeBackSheet"))).toContain("Lending it again later does not give it back to them.");
            await click("appTakeBackSheet-confirm");
            expect(game.takeAppBack).toHaveBeenCalledWith("tavily", "u1");
        });

        it("names the bots that stop when two or more use the lend, and says 'Bots there' only when none does", async () => {
            const bot = (botId: string, botName: string) => ({
                botId,
                botName,
                serverId: `s${botId}`,
                enabled: true,
                usesThisMonth: 1,
            });
            game.getMyApp.mockResolvedValue(
                appPage({ lentTo: [lentRow({ bots: [bot("g", "Guide"), bot("s", "Scout")] })], canLendTo: [] })
            );
            await open();
            await click("appTakeBack");
            expect(words(byId("appTakeBackSheet"))).toContain(
                "Guide and Scout stop using Tavily at once, also in a chat that is already open."
            );
            expect(words(byId("appTakeBackSheet"))).not.toContain("Bots there");
            page?.$destroy();
            game.getMyApp.mockResolvedValue(
                appPage({
                    lentTo: [
                        lentRow({ bots: [bot("g", "Guide"), bot("s", "Scout"), bot("h", "Helper"), bot("k", "Kit")] }),
                    ],
                    canLendTo: [],
                })
            );
            await open();
            await click("appTakeBack");
            expect(words(byId("appTakeBackSheet"))).toContain(
                "Guide, Scout and 2 more stop using Tavily at once, also in a chat that is already open."
            );
            page?.$destroy();
            game.getMyApp.mockResolvedValue(appPage({ lentTo: [lentRow({ bots: [] })], canLendTo: [] }));
            await open();
            await click("appTakeBack");
            expect(words(byId("appTakeBackSheet"))).toContain(
                "Bots there stop using Tavily at once, also in a chat that is already open."
            );
        });

        it("closes the lend sheet and says nothing is wrong when the lend went through but reading the page again failed", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            await open();
            await click("appLendGo");
            game.getMyApp.mockRejectedValue(new Error("down"));
            await click("appLendConfirm");
            warn.mockRestore();
            expect(game.lendApp).toHaveBeenCalledTimes(1);
            expect(byId("appLendSheet")).toBeNull();
            expect(game.warn).not.toHaveBeenCalledWith("That didn't go through. Nothing changed.");
        });

        it("asks nothing of anyone when Cancel is chosen on Take back", async () => {
            game.getMyApp.mockResolvedValue(appPage({ lentTo: [lentRow()], canLendTo: [] }));
            await open();
            await click("appTakeBack");
            await click("appTakeBackSheet-cancel");
            expect(game.takeAppBack).not.toHaveBeenCalled();
            expect(byId("appTakeBackSheet")).toBeNull();
        });

        it("lets one of the person's Bricks use it, and takes it from one", async () => {
            await open();
            await click("appBrickLetUse");
            expect(game.letBrickUseApp).toHaveBeenCalledWith("tavily", "b2");
            await click("appBrickRemove");
            expect(game.removeBrickFromApp).toHaveBeenCalledWith("tavily", "b1");
        });

        it("asks before it disconnects", async () => {
            await open();
            await click("appDisconnect");
            expect(game.disconnectMyApp).not.toHaveBeenCalled();
            expect(words(byId("appDisconnectSheet"))).toContain("Disconnect Tavily?");
            await click("appDisconnectSheet-confirm");
            expect(game.disconnectMyApp).toHaveBeenCalledWith("tavily");
        });

        it("offers Reconnect when the sign-in ended", async () => {
            game.getMyApp.mockResolvedValue(
                appPage({ app: { ...gmail, reconnectRequired: true }, canLendTo: [], canLetUse: [] })
            );
            await open("gmail");
            expect(words(byId("appSignInEnded"))).toContain("Your Bricks can't use Gmail until you reconnect it.");
            expect(words(byId("appReconnect"))).toBe("Reconnect Gmail");
        });
    });

    describe("GitHub (#2041)", () => {
        const github = (over: Record<string, unknown> = {}) =>
            appPage({
                app: tavily({ id: "gh", name: "GitHub", authType: "oauth", source: "github", lendable: false }),
                canLendTo: [],
                canLetUse: [],
                github: {
                    login: "BAWES",
                    ownKey: false,
                    places: [
                        {
                            account: "BAWES",
                            type: "User",
                            repos: "all",
                            manageUrl: "https://github.com/settings/installations/1",
                        },
                        {
                            account: "BAWES-Universe",
                            type: "Organization",
                            repos: "all",
                            manageUrl: "https://github.com/x/2",
                        },
                    ],
                    waiting: [{ account: "acme-corp", type: "Organization" }],
                    addPlaceUrl: "https://github.com/apps/bawes-universe/installations/select_target",
                    installUrl: "https://github.com/apps/bawes-universe/installations/new",
                    ownKeyPage: "https://github.com/settings/tokens/new",
                    known: true,
                    ...over,
                },
            });
        const open = async () => {
            page = new AppPage({ target, props: { appId: "gh", onBack: () => {} } });
            await settle();
        };
        const type = async (value: string) => {
            const input = byId("gitHubKeyInput") as HTMLInputElement;
            input.value = value;
            input.dispatchEvent(new Event("input"));
            await settle();
        };

        beforeEach(() => {
            game.getMyApp.mockResolvedValue(github());
            game.saveGitHubKey.mockResolvedValue({ id: "gh", login: "BAWES" });
            game.dropGitHubKey.mockResolvedValue({ id: "gh" });
        });

        it("says who it is signed in as, where it works, what waits for an owner, and that Bricks work as the person", async () => {
            await open();
            expect(words(byId("appPage"))).toContain("Signed in as @BAWES");
            expect(allById("gitHubPlace").map(words)).toEqual([
                "BAWES Your account · all repos",
                "BAWES-Universe All repos",
            ]);
            expect(words(byId("gitHubWaiting"))).toBe("acme-corp Waiting for an owner's OK");
            expect(words(byId("gitHubAddPlace"))).toBe("Add a place or change repos Opens GitHub");
            expect(words(byId("appPage"))).toContain(
                "Your Bricks work as you. What they push, open and merge shows as @BAWES on GitHub."
            );
            expect(words(byId("appOnlyForYou"))).toContain("GitHub is signed in as you");
            expect(words(byId("gitHubUseKey"))).toContain("Use my own GitHub key instead");
            expect(words(byId("appPage"))).toContain(
                "Every Brick stops using it at once. Nothing on GitHub is deleted."
            );
            expect(byId("gitHubKeyEverywhere")).toBeNull();
        });

        it("says it could not check with GitHub, and says when it is added nowhere yet", async () => {
            game.getMyApp.mockResolvedValue(github({ known: false, places: [], waiting: [] }));
            await open();
            expect(words(byId("appPage"))).toContain("Couldn't check with GitHub just now.");
            page?.$destroy();
            game.getMyApp.mockResolvedValue(github({ places: [], waiting: [] }));
            await open();
            expect(words(byId("appPage"))).toContain("Not added anywhere yet.");
        });

        it("opens GitHub to add a place, and reads the page again on coming back", async () => {
            const opened = vi.spyOn(window, "open").mockReturnValue(null);
            await open();
            await click("gitHubAddPlace");
            expect(opened).toHaveBeenCalledWith(
                "https://github.com/apps/bawes-universe/installations/select_target",
                "_blank",
                "noopener"
            );
            game.getMyApp.mockClear();
            window.dispatchEvent(new Event("focus"));
            await settle();
            expect(game.getMyApp).toHaveBeenCalledTimes(1);
            window.dispatchEvent(new Event("focus"));
            await settle();
            expect(game.getMyApp).toHaveBeenCalledTimes(1);
            opened.mockRestore();
        });

        it("never lets a slower reading from coming back to the page undo the key that was just saved", async () => {
            const opened = vi.spyOn(window, "open").mockReturnValue(null);
            await open();
            await click("gitHubAddPlace");
            let answerLate: (value: unknown) => void = () => undefined;
            game.getMyApp.mockReturnValueOnce(
                new Promise((resolve) => {
                    answerLate = resolve;
                })
            );
            window.dispatchEvent(new Event("focus"));
            await settle();
            game.getMyApp.mockResolvedValue(github({ ownKey: true }));
            await click("gitHubUseKey");
            await type("ghp_abcdefghij1234");
            await click("gitHubKeySave");
            expect(words(byId("appPage"))).toContain("Your own key · @BAWES");
            answerLate(github());
            await settle();
            expect(words(byId("appPage"))).toContain("Your own key · @BAWES");
            expect(byId("gitHubKeyEverywhere")).not.toBeNull();
            opened.mockRestore();
        });

        it("shows the waiting sheet with the link to send, and goes on to the key from there", async () => {
            await open();
            await click("gitHubWaiting");
            expect(words(byId("gitHubWaitingSheet"))).toContain("Waiting for acme-corp");
            expect(words(byId("gitHubInstallLink"))).toBe("github.com/apps/bawes-universe/installations/new");
            await click("gitHubCantWait");
            expect(byId("gitHubWaitingSheet")).toBeNull();
            expect(byId("gitHubKeySheet")).not.toBeNull();
        });

        it("saves a pasted key cleaned of spaces, says when GitHub refuses one, and closes when it is taken", async () => {
            await open();
            await click("gitHubUseKey");
            expect((byId("gitHubKeySave") as HTMLButtonElement).disabled).toBe(true);
            game.saveGitHubKey.mockRejectedValueOnce(
                Object.assign(new Error("GitHub did not take this key"), { code: "refused" })
            );
            await type(" ghp_abcdefghij\n1234 ");
            await click("gitHubKeySave");
            expect(game.saveGitHubKey).toHaveBeenCalledWith("ghp_abcdefghij1234");
            expect(words(byId("gitHubKeyProblem"))).toContain("GitHub didn't take this key");
            game.saveGitHubKey.mockRejectedValueOnce(new Error("Orbit did not answer in time"));
            await click("gitHubKeySave");
            expect(words(byId("gitHubKeyProblem"))).toContain("Couldn't reach GitHub just now");
            game.getMyApp.mockResolvedValue(github({ ownKey: true }));
            await click("gitHubKeySave");
            expect(byId("gitHubKeySheet")).toBeNull();
            expect(words(byId("appPage"))).toContain("Your own key · @BAWES");
        });

        it("does not let a key save that was started before a Cancel close the sheet that was opened after it", async () => {
            let finish: (value: unknown) => void = () => undefined;
            game.saveGitHubKey.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            await open();
            await click("gitHubUseKey");
            await type("ghp_abcdefghij1234");
            await click("gitHubKeySave");
            await click("gitHubKeyCancel");
            expect(byId("gitHubKeySheet")).toBeNull();
            await click("gitHubUseKey");
            await type("ghp_second1234567");
            finish({ id: "gh", login: "BAWES" });
            await settle();
            expect(byId("gitHubKeySheet")).not.toBeNull();
            expect((byId("gitHubKeyInput") as HTMLInputElement).value).toBe("ghp_second1234567");
        });

        it("with the person's own key: works everywhere it does, switches back through GitHub's sign-in, and offers no key", async () => {
            game.getMyApp.mockResolvedValue(github({ ownKey: true }));
            await open();
            expect(words(byId("gitHubKeyEverywhere"))).toBe(
                "Everywhere your key works Every repo you can reach on GitHub"
            );
            expect(byId("gitHubPlace")).toBeNull();
            expect(byId("gitHubAddPlace")).toBeNull();
            expect(byId("gitHubUseKey")).toBeNull();
            await click("gitHubSwitchBack");
            expect(reconnectApp).toHaveBeenCalledWith("gh");
            expect(game.dropGitHubKey).toHaveBeenCalledTimes(1);
        });

        it("keeps the key when the sign-in is stopped", async () => {
            vi.mocked(reconnectApp).mockResolvedValueOnce("stopped");
            game.getMyApp.mockResolvedValue(github({ ownKey: true }));
            await open();
            await click("gitHubSwitchBack");
            expect(game.dropGitHubKey).not.toHaveBeenCalled();
        });
    });

    describe("a universe's own app", () => {
        const open = async () => {
            page = new TeamAppPage({ target, props: { appId: "notion", onBack: () => {} } });
            await settle();
        };

        it("says whose it is, who connected it, its bots, its managers and this month's uses", async () => {
            await open();
            const text = words(byId("teamAppPage"));
            expect(text).toContain("Belongs to BAWES Universe");
            expect(text).toContain("Connected by Khalid");
            expect(text).toContain("Since 12 Nov");
            expect(words(byId("teamAppBot"))).toBe("Guide Uses it");
            expect(words(byId("teamAppPage"))).toContain("Tap one that uses it to change what it may do");
            expect(allById("teamAppManager").map(words)).toEqual(["Khalid (you) Owns BAWES Universe", "Sara Remove"]);
            expect(words(byId("teamAppUses"))).toBe("212 uses");
            expect(text).toContain("Counted for BAWES Universe, in Orbit's costs.");
            expect(byId("teamAppEnded")).toBeNull();
            expect(byId("teamAppLeft")).toBeNull();
        });

        it("opens what a bot may do with the app from its row", async () => {
            await open();
            await click("appRowGo");
            expect(byId("appBrickScreen")).not.toBeNull();
            expect(byId("teamAppPage")).toBeNull();
        });

        it("offers Let it use for the bots in the universe that cannot use it yet, and reads the page again", async () => {
            game.getTeamApp.mockResolvedValue({
                app: teamApp(),
                canAddAsManager: [],
                canLetUse: [{ id: "h", name: "Hala" }],
            });
            await open();
            expect(words(byId("teamAppBotOff"))).toBe("Hala Can't use Notion Let it use Notion");
            await click("teamAppLetUse");
            expect(game.letBotUseApp).toHaveBeenCalledWith("h", "notion");
            expect(game.getTeamApp).toHaveBeenCalledTimes(2);
        });

        it("says the page could not be read again, and offers Try again, when it did not come back after a change", async () => {
            game.getTeamApp.mockResolvedValueOnce({
                app: teamApp(),
                canAddAsManager: [],
                canLetUse: [{ id: "h", name: "Hala" }],
            });
            await open();
            game.getTeamApp.mockRejectedValueOnce(new Error("offline"));
            await click("teamAppLetUse");
            // What was read before is still shown, with a line that it may be out of date
            expect(byId("teamAppLoadFailed")).not.toBeNull();
            expect(byId("teamAppTryAgain")).not.toBeNull();
            expect(words(byId("teamAppPage"))).toContain("Belongs to BAWES Universe");
        });

        it("never lets a slow older read bring back a manager that a newer read no longer shows", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const withSara = { app: teamApp(), canAddAsManager: [], canLetUse: [{ id: "h", name: "Hala" }] };
            const withoutSara = {
                app: teamApp({ managers: [{ id: "k", name: "Khalid", owner: true, you: true }] }),
                canAddAsManager: [],
                canLetUse: [],
            };
            game.getTeamApp.mockResolvedValueOnce(withSara);
            await open();
            // The read after a change fails: Try again is offered, and is tapped twice
            game.getTeamApp.mockRejectedValueOnce(new Error("offline"));
            await click("teamAppLetUse");
            let older: (value: unknown) => void = () => undefined;
            game.getTeamApp.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        older = resolve;
                    })
            );
            await click("teamAppTryAgain");
            game.getTeamApp.mockResolvedValueOnce(withoutSara);
            await click("teamAppTryAgain");
            expect(allById("teamAppManager").map(words)).toEqual(["Khalid (you) Owns BAWES Universe"]);
            older(withSara);
            await settle();
            expect(allById("teamAppManager").map(words)).toEqual(["Khalid (you) Owns BAWES Universe"]);
            expect(byId("teamAppLoadFailed")).toBeNull();
            warn.mockRestore();
        });

        it("offers no Let it use when Orbit sends nobody, and says Orbit's line when it refuses", async () => {
            await open();
            expect(byId("teamAppBotOff")).toBeNull();
            page?.$destroy();
            page = undefined;
            game.getTeamApp.mockResolvedValue({
                app: teamApp(),
                canAddAsManager: [],
                canLetUse: [{ id: "h", name: "Hala" }],
            });
            game.letBotUseApp.mockRejectedValue(
                Object.assign(new Error("Maximum of 5 apps per bot reached"), { status: 422 })
            );
            await open();
            await click("teamAppLetUse");
            expect(game.warn).toHaveBeenCalledWith("Maximum of 5 apps per bot reached");
        });

        it("offers Remove only for someone Orbit says does not own the universe", async () => {
            game.getTeamApp.mockResolvedValue({
                app: teamApp({
                    managers: [
                        { id: "k", name: "Khalid" },
                        { id: "s", name: "Sara", owner: false },
                    ],
                }),
                canAddAsManager: [],
            });
            await open();
            expect(allById("teamAppRemoveManager")).toHaveLength(1);
            await click("teamAppRemoveManager");
            expect(game.removeTeamAppManager).toHaveBeenCalledWith("notion", "s");
        });

        it("says the sign-in ended, who can reconnect it, and offers one Reconnect", async () => {
            game.getTeamApp.mockResolvedValue({
                app: teamApp({ reconnectRequired: true, signInLostAt: "2026-11-11T09:00:00.000Z" }),
                canAddAsManager: [],
            });
            await open();
            const ended = words(byId("teamAppEnded"));
            expect(ended).toContain("Sign-in ended on 11 Nov");
            expect(ended).toContain("Bots can't use Notion until it is reconnected. Khalid and Sara can reconnect it.");
            expect(words(byId("teamAppReconnect"))).toBe("Reconnect Notion");
        });

        it("says so, and offers Reconnect, when the person who connected it no longer manages it", async () => {
            game.getTeamApp.mockResolvedValue({
                app: teamApp({ name: "GitHub", connectedBy: { id: "o", name: "Omar", stillManages: false } }),
                canAddAsManager: [],
            });
            await open();
            const left = words(byId("teamAppLeft"));
            expect(left).toContain("Omar no longer manages GitHub");
            expect(left).toContain("Bots keep using it for now, on Omar's sign-in.");
            expect(left).toContain("so it no longer depends on Omar");
            expect(words(byId("teamAppReconnect"))).toBe("Reconnect GitHub");
        });

        it("says nothing of a connector who left when the app is a key and not a sign-in", async () => {
            game.getTeamApp.mockResolvedValue({
                app: teamApp({ authType: "api-key", connectedBy: { id: "o", name: "Omar", stillManages: false } }),
                canAddAsManager: [],
            });
            await open();
            expect(byId("teamAppLeft")).toBeNull();
            expect(byId("teamAppReconnect")).toBeNull();
        });

        it("adds a manager from the people Orbit offers, and reads the page again", async () => {
            await open();
            await click("teamAppAddManager");
            expect(words(byId("addManagerSheet"))).toContain("Add a manager to Notion");
            expect(allById("addManagerPerson").map((one) => words(one).split(" ")[0])).toEqual(["N", "F"]);
            await click("addManagerPerson", 1);
            expect(words(byId("addManagerGo"))).toBe("Add Fahad");
            await click("addManagerGo");
            expect(game.addTeamAppManager).toHaveBeenCalledWith("notion", "f");
            expect(byId("addManagerSheet")).toBeNull();
        });

        it("asks before it disconnects, and goes back when it did", async () => {
            const back = vi.fn();
            page = new TeamAppPage({ target, props: { appId: "notion", onBack: back } });
            await settle();
            await click("teamAppDisconnect");
            expect(game.disconnectTeamApp).not.toHaveBeenCalled();
            await click("teamAppDisconnectSheet-confirm");
            expect(game.disconnectTeamApp).toHaveBeenCalledWith("notion");
            expect(back).toHaveBeenCalled();
        });
    });

    describe("a universe's apps", () => {
        it("warns on an app whose sign-in ended and on one whose connector no longer manages it", async () => {
            game.getUniverseApps.mockResolvedValue({
                apps: [
                    teamApp({ id: "a", name: "Notion", reconnectRequired: true }),
                    teamApp({ id: "b", name: "GitHub", connectedBy: { id: "o", name: "Omar", stillManages: false } }),
                    teamApp({ id: "c", name: "Slack", bots: [] }),
                ],
            });
            page = new TeamAppsPage({
                target,
                props: { universe: { id: "u1", name: "BAWES Universe", apps: 3 }, onBack: () => {} },
            });
            await settle();
            expect(allById("teamAppRow").map(words)).toEqual([
                "Notion Sign-in ended · reconnect it",
                "GitHub Omar no longer manages it · reconnect it",
                "Slack No bot uses it yet",
            ]);
        });

        it("never lets a slow older read bring back an app that a newer read no longer shows", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            game.getUniverseApps.mockRejectedValueOnce(new Error("offline"));
            page = new TeamAppsPage({
                target,
                props: { universe: { id: "u1", name: "BAWES Universe", apps: 2 }, onBack: () => {} },
            });
            await settle();
            let older: (value: unknown) => void = () => undefined;
            game.getUniverseApps.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        older = resolve;
                    })
            );
            await click("teamAppsTryAgain");
            game.getUniverseApps.mockResolvedValueOnce({ apps: [teamApp({ id: "a", name: "Notion" })] });
            await click("teamAppsTryAgain");
            expect(allById("teamAppRow")).toHaveLength(1);
            older({ apps: [teamApp({ id: "a", name: "Notion" }), teamApp({ id: "b", name: "GitHub" })] });
            await settle();
            expect(allById("teamAppRow").map((row) => words(row).split(" ")[0])).toEqual(["Notion"]);
            warn.mockRestore();
        });

        it("says nothing is connected yet", async () => {
            game.getUniverseApps.mockResolvedValue({ apps: [] });
            page = new TeamAppsPage({
                target,
                props: { universe: { id: "u1", name: "BAWES Universe", apps: 0 }, onBack: () => {} },
            });
            await settle();
            expect(words(byId("teamAppsPage"))).toContain("Nothing is connected here yet.");
        });
    });

    describe("a bot's page: more apps it can use here", () => {
        it("offers each app lent here or owned by the universe, and lets the bot use one", async () => {
            game.getAppsABotCouldUse.mockResolvedValue({
                apps: [
                    { connectionId: "c1", name: "Tavily", kind: "lent" },
                    { connectionId: "c2", name: "Notion", kind: "team" },
                ],
            });
            const onLet = vi.fn();
            page = new MoreApps({ target, props: { botId: "guide", botName: "Guide", onLet } });
            await settle();
            expect(allById("moreAppsRow").map(words)).toEqual([
                "Tavily Lent by you Let Guide use it",
                "Notion Belongs to the universe · you manage it Let Guide use it",
            ]);
            expect(words(byId("moreApps"))).toContain("More apps it can use here");
            await click("moreAppsLet", 1);
            expect(game.letBotUseApp).toHaveBeenCalledWith("guide", "c2");
            expect(onLet).toHaveBeenCalled();
        });

        it("shows nothing when there is nothing to offer, and nothing for a bot Orbit will not say anything about", async () => {
            page = new MoreApps({ target, props: { botId: "guide", botName: "Guide", onLet: () => {} } });
            await settle();
            expect(byId("moreApps")).toBeNull();
            page.$destroy();
            game.getAppsABotCouldUse.mockRejectedValue(new Error("404"));
            page = new MoreApps({ target, props: { botId: "brick", botName: "Brick", onLet: () => {} } });
            await settle();
            expect(byId("moreApps")).toBeNull();
        });

        it("says so when the bot could not be let use it", async () => {
            game.getAppsABotCouldUse.mockResolvedValue({
                apps: [{ connectionId: "c1", name: "Tavily", kind: "lent" }],
            });
            game.letBotUseApp.mockRejectedValue(new Error("404"));
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const onLet = vi.fn();
            page = new MoreApps({ target, props: { botId: "guide", botName: "Guide", onLet } });
            await settle();
            await click("moreAppsLet");
            warn.mockRestore();
            expect(game.warn).toHaveBeenCalledWith("That didn't go through. Nothing changed.");
            expect(onLet).not.toHaveBeenCalled();
        });

        it("shows Orbit's own words when the bot already has all the apps it may have", async () => {
            game.getAppsABotCouldUse.mockResolvedValue({
                apps: [{ connectionId: "c1", name: "Tavily", kind: "lent" }],
            });
            game.letBotUseApp.mockRejectedValue(
                Object.assign(new Error("Maximum of 5 apps per bot reached"), { status: 422 })
            );
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const onLet = vi.fn();
            page = new MoreApps({ target, props: { botId: "guide", botName: "Guide", onLet } });
            await settle();
            await click("moreAppsLet");
            warn.mockRestore();
            expect(game.warn).toHaveBeenCalledWith("Maximum of 5 apps per bot reached");
            expect(onLet).not.toHaveBeenCalled();
        });

        it("shows the line Orbit gives for a cap other than 5, and not a 500's words", async () => {
            game.getAppsABotCouldUse.mockResolvedValue({
                apps: [{ connectionId: "c1", name: "Tavily", kind: "lent" }],
            });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            page = new MoreApps({ target, props: { botId: "guide", botName: "Guide", onLet: vi.fn() } });
            await settle();
            game.letBotUseApp.mockRejectedValueOnce(
                Object.assign(new Error("Maximum of 8 apps per bot reached"), { status: 422 })
            );
            await click("moreAppsLet");
            expect(game.warn).toHaveBeenLastCalledWith("Maximum of 8 apps per bot reached");
            game.letBotUseApp.mockRejectedValueOnce(Object.assign(new Error("prisma exploded"), { status: 500 }));
            await click("moreAppsLet");
            warn.mockRestore();
            expect(game.warn).toHaveBeenLastCalledWith("That didn't go through. Nothing changed.");
        });
    });

    describe("the sheets on their own", () => {
        it("does not stay shut for good when the lend is rejected: it says so and a tap tries again", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const onSubmit = vi
                .fn<() => Promise<boolean>>()
                .mockRejectedValueOnce(new Error("down"))
                .mockResolvedValue(true);
            page = new LendSheet({
                target,
                props: {
                    app: "Tavily",
                    universes: [{ id: "u2", name: "Kuwait Makers", access: "manage" }],
                    onSubmit,
                    onClose: () => {},
                },
            });
            await settle();
            await click("appLendConfirm");
            expect((byId("appLendConfirm") as HTMLButtonElement).disabled).toBe(false);
            expect(byId("appLendFailed")).not.toBeNull();
            await click("appLendConfirm");
            expect(onSubmit).toHaveBeenCalledTimes(2);
            warn.mockRestore();
        });

        it("shows the whole install link to copy by hand when the browser does not let it be copied", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
            const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error("denied"));
            Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
            page = new GitHubWaitingSheet({
                target,
                props: {
                    account: "acme-corp",
                    installUrl: "https://github.com/apps/bawes-universe/installations/new?target_id=42",
                    onUseKey: () => {},
                    onClose: () => {},
                },
            });
            await settle();
            expect(byId("gitHubCopyFailed")).toBeNull();
            await click("gitHubCopyLink");
            expect(words(byId("gitHubCopyFailed"))).toBe(
                "Couldn't copy it. Select the whole link below and copy it yourself."
            );
            expect(words(byId("gitHubInstallFull"))).toBe(
                "https://github.com/apps/bawes-universe/installations/new?target_id=42"
            );
            // a copy that works afterwards says so and drops the fallback
            writeText.mockResolvedValue(undefined);
            await click("gitHubCopyLink");
            expect(byId("gitHubCopyFailed")).toBeNull();
            expect(words(byId("gitHubCopyLink"))).toBe("Copied");
            warn.mockRestore();
        });

        it("shows 'You have Manage bots here' for a person who does not own the universe, and sends what was picked", async () => {
            const onSubmit = vi.fn(() => Promise.resolve(true));
            page = new LendSheet({
                target,
                props: {
                    app: "Tavily",
                    universes: [{ id: "u2", name: "Kuwait Makers", access: "manage" }],
                    onSubmit,
                    onClose: () => {},
                },
            });
            await settle();
            expect(words(byId("appLendUniverse"))).toBe("Kuwait Makers You have Manage bots here");
            await click("appLendConfirm");
            expect(onSubmit).toHaveBeenCalledWith({ universeId: "u2", things: null, usesPerDay: 200 });
        });

        it("closes on Escape and on Cancel", async () => {
            const onClose = vi.fn();
            page = new AddManagerSheet({
                target,
                props: {
                    app: "Notion",
                    universe: "BAWES Universe",
                    people: [],
                    onAdd: () => Promise.resolve(true),
                    onClose,
                },
            });
            await settle();
            expect(byId("addManagerNone")).not.toBeNull();
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expect(onClose).toHaveBeenCalledTimes(1);
            await click("addManagerCancel");
            expect(onClose).toHaveBeenCalledTimes(2);
        });
    });
});
