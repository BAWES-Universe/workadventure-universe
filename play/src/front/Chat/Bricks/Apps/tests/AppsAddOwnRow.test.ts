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
    discoverMcpOAuthEndpoints: vi.fn<(url: string, callback: string) => Promise<unknown>>(),
    addMyApp: vi.fn<(app: unknown) => Promise<unknown>>(),
    getMyAppThings: vi.fn<(id: string) => Promise<unknown>>(),
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
        discoverMcpOAuthEndpoints: game.discoverMcpOAuthEndpoints,
        addMyApp: game.addMyApp,
        getMyAppThings: game.getMyAppThings,
    },
}));
// A Brick wearing a WOKA is drawn by the game's picture loader, and the person's Bricks come from their own store: neither
// has anything to do with this page, and the picture loader reaches code the tests cannot load
vi.mock("../../BrickLookPicture", async () => {
    const store = await import("svelte/store");
    return { brickPicture: () => store.readable(undefined) };
});
vi.mock("../../MyBricksStore", async () => {
    const store = await import("svelte/store");
    return { myBricksStore: store.writable([]), loadMyBricks: vi.fn(() => Promise.resolve()) };
});
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
vi.mock("../Reconnect", () => ({
    reconnectApp: vi.fn(() => Promise.resolve("done")),
    signInInPopup: vi.fn(() => Promise.resolve("done")),
}));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import AppsPage from "../AppsPage.svelte";
import { forgetMyApps } from "../AppsStore";

const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
};
const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const words = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("Add your own app on the Apps page (#2001)", () => {
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
        game.getMyApps.mockResolvedValue({ apps: [], bricks: [] });
        game.getAppCatalog.mockResolvedValue({ apps: [] });
        game.getReadyMadeApps.mockRejectedValue(new Error("API error: 404"));
        game.getMyAppUniverses.mockResolvedValue({ universes: [] });
    });

    afterEach(() => {
        page?.$destroy();
        page = undefined;
        target.remove();
        document.body.innerHTML = "";
    });

    it("has the row under the apps, before the note, and says 'Not here?' under a search that found nothing", async () => {
        page = new AppsPage({ target, props: { onBack: vi.fn() } });
        await settle();
        expect(words(byId("appsAddOwn"))).toBe("Add your own app Paste its link, like Firecrawl");
        const row = byId("appsAddOwn");
        const note = byId("appsSignInNote");
        expect(row && note && row.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const input = byId("appsSearchInput") as HTMLInputElement;
        input.value = "zzz";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
        expect(words(byId("appsAddOwn"))).toBe("Not here? Add your own app Paste its link, like Firecrawl");
        byId("appsAddOwn")?.click();
        await settle();
        expect(byId("addAppSheet")).not.toBeNull();
    });
});
