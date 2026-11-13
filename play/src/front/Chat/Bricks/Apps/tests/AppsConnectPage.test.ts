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
    connectApp: vi.fn<(app: unknown) => Promise<unknown>>(),
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
    },
}));
vi.mock("../ConnectApp", () => ({ connectApp: game.connectApp }));
vi.mock("../../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: vi.fn() } }));
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
vi.mock("../Reconnect", () => ({ reconnectApp: vi.fn(() => Promise.resolve("done")) }));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import AppsPage from "../AppsPage.svelte";
import { appsSearchStart } from "../AppsSearch";
import { forgetMyApps } from "../AppsStore";

const HEADINGS = { lookUp: "rightAway", make: "rightAway", change: "asksFirst", deleteSend: "asksFirst" };
const mine = (over: Record<string, unknown> = {}) => ({
    id: "gmail",
    name: "Gmail",
    authType: "oauth",
    source: "listed",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-04T09:00:00.000Z",
    lendable: false,
    bricks: [{ botId: "b1", botName: "Brick", serverId: "s1", enabled: true, headings: HEADINGS }],
    ...over,
});
const entry = (key: string, name: string, blurb: string, connectionId: string | null = null) => ({
    key,
    name,
    blurb,
    icon: "plug",
    connectionId,
});
const CATALOG = {
    apps: [
        entry("gmail", "Gmail", "Read, draft and send email", "gmail"),
        entry("notion", "Notion", "Notes and docs"),
        entry("slack", "Slack", "Messages and channels"),
        entry("drive", "Google Drive", "Your files"),
        entry("dropbox", "Dropbox", "Your files"),
    ],
};

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
const words = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const names = (id: string) => allById(id).map((row) => words(row.querySelector(".ar-t")));
async function click(id: string, index = 0): Promise<void> {
    allById(id)[index]?.click();
    await settle();
}
async function type(text: string): Promise<void> {
    const input = byId("appsSearchInput") as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
}

describe("Search apps and Connect another (#2001)", () => {
    let target: HTMLElement;
    let page: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyApps();
        appsSearchStart.set(undefined);
        target = document.createElement("div");
        document.body.appendChild(target);
        game.getMyApps.mockResolvedValue({ apps: [mine()], bricks: [] });
        game.getAppCatalog.mockResolvedValue(CATALOG);
        game.getReadyMadeApps.mockResolvedValue({ apps: [] });
        game.getMyAppUniverses.mockResolvedValue({ universes: [] });
        game.getMyApp.mockResolvedValue({ app: mine(), canLetUse: [], lentTo: [], canLendTo: [] });
        game.connectApp.mockResolvedValue({ status: "stopped" });
    });

    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
        document.body.innerHTML = "";
    });

    async function open(): Promise<void> {
        page = new AppsPage({ target, props: { onBack: vi.fn() } });
        // The tests run Svelte's server build, where onMount does nothing: the page reads when it is made
        await settle();
    }

    it("shows what is connected, then Connect another with a Connect button on each app that is not", async () => {
        await open();
        expect(words(byId("appsSearch"))).toBe("");
        expect(names("appsRow")).toEqual(["Gmail"]);
        expect(words(byId("appsAnother"))).toBe("Connect another");
        expect(names("appsConnectRow")).toEqual(["Notion", "Slack", "Google Drive", "Dropbox"]);
        expect(words(allById("appsConnectRow")[0])).toBe("Notion Notes and docs Connect");
        expect(allById("appsConnect")).toHaveLength(4);
        expect(byId("appsSignInNote")?.textContent).toContain("Universe never sees your password");
        expect(byId("appsSignInNote")?.textContent).toContain("connect my Notion");
    });

    it("heads the list Connect an app while nothing is connected", async () => {
        game.getMyApps.mockResolvedValue({ apps: [], bricks: [] });
        await open();
        expect(allById("appsRow")).toHaveLength(0);
        expect(words(byId("appsAnother"))).toBe("Connect an app");
        expect(allById("appsConnectRow")).toHaveLength(5);
    });

    it("keeps an app whose sign-in was started and never finished under Connect another", async () => {
        game.getMyApps.mockResolvedValue({ apps: [mine({ connected: false })], bricks: [] });
        await open();
        expect(allById("appsRow")).toHaveLength(0);
        expect(names("appsConnectRow")).toContain("Gmail");
    });

    it("adds the ready-made apps when Orbit has any, and nothing when it answers 404", async () => {
        game.getReadyMadeApps.mockResolvedValue({ apps: [{ key: "linear", name: "Linear", connectionId: null }] });
        await open();
        expect(names("appsConnectRow")).toContain("Linear");
        page?.$destroy();
        document.body.innerHTML = "";
        target = document.createElement("div");
        document.body.appendChild(target);
        game.getReadyMadeApps.mockResolvedValue({ apps: [] });
        await open();
        expect(names("appsConnectRow")).not.toContain("Linear");
        expect(byId("appsConnectListFailed")).toBeNull();
    });

    it("narrows both lists by what is typed and counts the apps it found", async () => {
        await open();
        await type("dr");
        expect(words(byId("appsFound"))).toBe("2 apps");
        expect(names("appsConnectRow")).toEqual(["Google Drive", "Dropbox"]);
        expect(allById("appsRow")).toHaveLength(0);
        expect(byId("appsAnother")).toBeNull();
        await type("gma");
        expect(words(byId("appsFound"))).toBe("1 app");
        // a connected app is found too, and opens its page
        expect(names("appsRow")).toEqual(["Gmail"]);
        expect(allById("appsConnectRow")).toHaveLength(0);
    });

    it("finds an app by the line under its name", async () => {
        await open();
        await type("notes");
        expect(names("appsConnectRow")).toEqual(["Notion"]);
    });

    it("says so when nothing matches, and still shows the note", async () => {
        await open();
        await type("zzz");
        expect(words(byId("appsFound"))).toBe("0 apps");
        expect(words(byId("appsNoMatch"))).toBe("No app matches “zzz”.");
        expect(byId("appsSignInNote")).not.toBeNull();
    });

    it("starts with the words a card put in Search apps, once", async () => {
        appsSearchStart.set("calendar");
        game.getAppCatalog.mockResolvedValue({
            apps: [entry("gcal", "Google Calendar", "See and plan your day"), entry("notion", "Notion", "Notes")],
        });
        await open();
        expect((byId("appsSearchInput") as HTMLInputElement).value).toBe("calendar");
        expect(names("appsConnectRow")).toEqual(["Google Calendar"]);
        let left: string | undefined = "x";
        appsSearchStart.subscribe((value) => (left = value))();
        expect(left).toBeUndefined();
    });

    it("connects an app on Connect and opens its page to choose Bricks", async () => {
        game.connectApp.mockResolvedValue({ status: "connected", appId: "notion-c" });
        game.getMyApp.mockResolvedValue({
            app: mine({ id: "notion-c", name: "Notion", bricks: [] }),
            canLetUse: [{ id: "b1", name: "Brick" }],
            lentTo: [],
            canLendTo: [],
        });
        await open();
        await click("appsConnect", 0);
        expect(game.connectApp).toHaveBeenCalledWith(expect.objectContaining({ kind: "listed", key: "notion" }));
        expect(game.getMyApp).toHaveBeenCalledWith("notion-c");
        expect(byId("appPage")).not.toBeNull();
    });

    it("keeps the other Connect buttons still while one sign-in is open", async () => {
        let finish: (value: unknown) => void = () => undefined;
        game.connectApp.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        await open();
        await click("appsConnect", 1);
        expect(words(allById("appsConnect")[1])).toBe("Connecting…");
        expect(allById("appsConnect").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        finish({ status: "stopped" });
        await settle();
        expect(allById("appsConnect").every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
        expect(words(allById("appsConnect")[1])).toBe("Connect");
    });

    it("says nothing was connected when the sign-in did not finish, and how to fix a window that did not open", async () => {
        await open();
        await click("appsConnect", 0);
        expect(words(byId("appsConnectNote"))).toBe("The sign-in didn't finish. Nothing was connected.");
        game.connectApp.mockResolvedValue({ status: "blocked" });
        await click("appsConnect", 0);
        expect(words(byId("appsConnectNote"))).toBe(
            "Couldn't open the sign-in page. Allow pop-ups for this site and try again."
        );
    });

    it("keeps the listed apps and says so when the ready-made apps could not be read", async () => {
        game.getReadyMadeApps.mockRejectedValueOnce(new Error("down"));
        await open();
        expect(names("appsConnectRow")).toHaveLength(4);
        expect(words(byId("appsConnectListFailed"))).toBe("Couldn't load the apps you can connect.");
        await click("appsConnectListTryAgain");
        expect(byId("appsConnectListFailed")).toBeNull();
    });

    it("says the list could not be read, and reads it again on Try again", async () => {
        game.getAppCatalog.mockRejectedValueOnce(new Error("down"));
        await open();
        expect(words(byId("appsConnectListFailed"))).toBe("Couldn't load the apps you can connect.");
        expect(allById("appsConnectRow")).toHaveLength(0);
        await click("appsConnectListTryAgain");
        expect(byId("appsConnectListFailed")).toBeNull();
        expect(names("appsConnectRow")).toHaveLength(4);
    });
});
