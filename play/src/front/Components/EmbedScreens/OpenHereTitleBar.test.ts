import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
    // An upright phone: the window is a sheet there (the computer's window is picked by the `floating` prop below).
    window.innerWidth = 390;
    window.innerHeight = 844;
});
import { tick } from "svelte";
import { get, writable } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the window needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Stores/CardOverWindowStore", () => ({ cardOverWindowStore: writable(false) }));
vi.mock("../../Stores/MobileLayoutStore", async () => {
    const { writable } = await import("svelte/store");
    return { mobileLayoutStore: writable(true) };
});
vi.mock("../../../i18n/i18n-svelte", async () => (await import("../Woka/tests/i18nStub")).i18nStub);
const closeAllOpenItems = vi.hoisted(() => vi.fn());
vi.mock("../../Stores/ClosedItemsStore", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    closeAllOpenItems,
}));

// The game manager loads first, as it does in the game: its scene and the Api it listens to depend on that order.
import { gameManager } from "../../Phaser/Game/GameManager";
import { coWebsites } from "../../Stores/CoWebsiteStore";
import { openHereTuckedStore } from "../../Stores/SideWindowInFrontStore";
import { titleBarHiddenItem, titleBarHiddenItemStore } from "../../Stores/TitleBarStore";
import type { GameScene } from "../../Phaser/Game/GameScene";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
import OpenHereWindow from "./OpenHereWindow.svelte";

function site(hideTitleBar: boolean, closable = true): SimpleCoWebsite {
    return new SimpleCoWebsite(
        new URL("https://example.com/game"),
        false,
        undefined,
        50,
        closable,
        false,
        hideTitleBar
    );
}

function file(name: string): FileViewerCoWebsite {
    // The file never arrives: only the window's own frame and row are under test.
    return new FileViewerCoWebsite({
        key: `chat:blob:http://play/${name}`,
        name,
        load: () => new Promise<ArrayBuffer>(() => {}),
        download: () => Promise.resolve(),
    });
}

describe("titleBarHiddenItem", () => {
    it("hides the bar only for a page with the switch on that is alone", () => {
        const hidden = site(true);
        expect(titleBarHiddenItem([hidden])).toBe(hidden);
        expect(titleBarHiddenItem([site(false)])).toBeUndefined();
        expect(titleBarHiddenItem([])).toBeUndefined();
    });

    it("brings the bar back as soon as a second item is open, and hides it again once the page is alone", () => {
        const hidden = site(true);
        const other = file("plan.pdf");
        expect(titleBarHiddenItem([hidden, other])).toBeUndefined();
        expect(titleBarHiddenItem([other, hidden])).toBeUndefined();
        expect(titleBarHiddenItem([hidden])).toBe(hidden);
    });

    it("leaves a file alone, and a tucked sheet keeps its slim row", () => {
        expect(titleBarHiddenItem([file("plan.pdf")])).toBeUndefined();
        expect(titleBarHiddenItem([site(true)], true)).toBeUndefined();
    });

    it("is off when the page was not given the switch", () => {
        expect(new SimpleCoWebsite(new URL("https://example.com")).getHideTitleBar()).toBe(false);
    });
});

describe("Hide title bar in the Open here window", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;
    let sceneSpy: MockInstance | undefined;

    const rows = () => target.querySelectorAll('[data-testid="openHereRow"]');
    const iframe = () => target.querySelector("iframe");
    const handleClose = () => target.querySelector<HTMLElement>('[data-testid="openHereHandleClose"]');
    const rowClose = () => target.querySelector<HTMLElement>('[data-testid="openHereSheetClose"]');

    async function mount(floating: boolean, ...items: Array<SimpleCoWebsite | FileViewerCoWebsite>) {
        items.forEach((item) => coWebsites.add(item));
        component = new OpenHereWindow({ target, props: { floating } });
        await tick();
    }

    beforeEach(() => {
        HTMLElement.prototype.setPointerCapture = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
        target = document.createElement("div");
        document.body.append(target);
        closeAllOpenItems.mockClear();
        sceneSpy = vi
            .spyOn(gameManager, "tryGetCurrentGameScene")
            .mockReturnValue({ reposition: vi.fn() } as unknown as GameScene);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        sceneSpy?.mockRestore();
        target.remove();
        coWebsites.removeAll();
        openHereTuckedStore.set(false);
    });

    describe("on a computer", () => {
        it("draws no row above a page with the switch on while it is alone", async () => {
            await mount(true, site(true));

            expect(rows()).toHaveLength(0);
            expect(iframe()).not.toBeNull();
            expect(get(titleBarHiddenItemStore)).not.toBeUndefined();
        });

        it("keeps the row of a page without the switch, exactly as before", async () => {
            await mount(true, site(false));

            expect(rows()).toHaveLength(1);
            expect(get(titleBarHiddenItemStore)).toBeUndefined();
        });

        it("brings the row back when something else opens, hides it when that closes, and never reloads the page", async () => {
            const page = site(true);
            await mount(true, page);
            const frame = iframe();
            expect(frame).not.toBeNull();
            expect(rows()).toHaveLength(0);

            const other = file("plan.pdf");
            coWebsites.add(other);
            await tick();
            // The new item is in front; the page's own row is back behind it (hidden), and the tabs are showing.
            expect(rows().length).toBeGreaterThan(0);
            expect(target.querySelector(".height-tab")?.classList.contains("hidden")).toBe(false);
            expect(iframe()).toBe(frame);
            expect(frame?.isConnected).toBe(true);

            coWebsites.remove(other);
            await tick();
            expect(rows()).toHaveLength(0);
            expect(iframe()).toBe(frame);
            expect(frame?.isConnected).toBe(true);
        });

        it("keeps the pill (expand and close) as it is", async () => {
            await mount(true, site(true));

            expect(target.querySelector('[data-testid="openHereExpand"]')).not.toBeNull();
            expect(target.querySelector('[data-testid="openHereClose"]')).not.toBeNull();
            expect(handleClose()).toBeNull();
        });
    });

    describe("on an upright phone", () => {
        it("moves the close to the handle line when the row is hidden, and it closes like the row's", async () => {
            await mount(false, site(true));

            expect(rows()).toHaveLength(0);
            expect(rowClose()).toBeNull();
            expect(handleClose()).not.toBeNull();
            expect(handleClose()?.closest('[data-testid="openHereSheet"]')).not.toBeNull();

            handleClose()?.click();
            expect(closeAllOpenItems).toHaveBeenCalledTimes(1);
        });

        it("shows no close at all for a page that may not be closed", async () => {
            await mount(false, site(true, false));

            expect(rows()).toHaveLength(0);
            expect(handleClose()).toBeNull();
            expect(rowClose()).toBeNull();
        });

        it("goes back to the row with its close when a second item opens, and to the handle when it is alone again", async () => {
            const page = site(true);
            await mount(false, page);
            const frame = iframe();
            expect(handleClose()).not.toBeNull();

            const other = file("plan.pdf");
            coWebsites.add(other);
            await tick();
            expect(handleClose()).toBeNull();
            expect(rowClose()).not.toBeNull();
            expect(target.querySelector('[data-testid="openHereList"]')).not.toBeNull();

            coWebsites.remove(other);
            await tick();
            expect(rowClose()).toBeNull();
            expect(handleClose()).not.toBeNull();
            expect(iframe()).toBe(frame);
        });

        it("keeps the row on a page without the switch, with the close in it", async () => {
            await mount(false, site(false));

            expect(rows()).toHaveLength(1);
            expect(rowClose()).not.toBeNull();
            expect(handleClose()).toBeNull();
        });

        it("shows the row in the slim tucked sheet, which is all it shows of the page", async () => {
            await mount(false, site(true));
            openHereTuckedStore.set(true);
            await tick();

            expect(rows()).toHaveLength(1);
            expect(handleClose()).toBeNull();
        });
    });
});
