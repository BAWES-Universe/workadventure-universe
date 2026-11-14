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
    saveGitHubKey: vi.fn<(key: string) => Promise<unknown>>(),
    dropGitHubKey: vi.fn<() => Promise<unknown>>(),
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
        saveGitHubKey: game.saveGitHubKey,
        dropGitHubKey: game.dropGitHubKey,
    },
}));
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
        game.getReadyMadeApps.mockRejectedValue(new Error("API error: 404"));
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
            expect(words(byId("appsAddOwn"))).toBe("Add your own app Paste its MCP link, like Firecrawl");
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
            expect(allById("teamAppManager").map(words)).toEqual(["Khalid (you) Owns BAWES Universe", "Sara Remove"]);
            expect(words(byId("teamAppUses"))).toBe("212 uses");
            expect(text).toContain("Counted for BAWES Universe, in Orbit's costs.");
            expect(byId("teamAppEnded")).toBeNull();
            expect(byId("teamAppLeft")).toBeNull();
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
    });

    describe("the sheets on their own", () => {
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
