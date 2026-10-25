/* eslint-disable no-await-in-loop -- each step has to finish before the next one starts */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
    // An upright phone.
    window.innerWidth = 390;
    window.innerHeight = 844;
});
import { tick } from "svelte";
import { writable } from "svelte/store";

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

const sheets = [
    { name: "January", rows: [[{ text: "Jan", number: false }]] },
    { name: "February", rows: [[{ text: "Feb", number: false }]] },
].map((sheet) => ({
    ...sheet,
    columnCount: 1,
    totalRows: 1,
    rowsCut: false,
    columnsCut: false,
    textCut: false,
    styled: false,
    columnWidths: [],
}));
vi.mock("../../FileViewer/spreadsheet", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readSpreadsheet: () => Promise.resolve(sheets),
}));

import { gameManager } from "../../Phaser/Game/GameManager";
import { coWebsites } from "../../Stores/CoWebsiteStore";
import type { GameScene } from "../../Phaser/Game/GameScene";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import OpenHereWindow from "./OpenHereWindow.svelte";

function workbook(name: string): FileViewerCoWebsite {
    return new FileViewerCoWebsite({
        key: `chat:blob:http://play/${name}`,
        name,
        // The first bytes of a zip: what a workbook starts with.
        load: () => Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer),
        download: () => Promise.resolve(),
    });
}

/** jsdom has no layout: scrolling is a place each element remembers. */
const places = new WeakMap<Element, { left: number; top: number }>();

describe("the readers of the files open in the window", () => {
    let component: OpenHereWindow | undefined;
    let target: HTMLDivElement;

    const sheetsShown = () => target.querySelectorAll('[data-testid="fileViewerSheet"]');
    const flush = async () => {
        for (let i = 0; i < 6; i++) await tick();
    };

    async function open(...names: string[]) {
        for (const name of names) {
            coWebsites.add(workbook(name));
            await flush();
        }
    }

    beforeEach(() => {
        HTMLElement.prototype.setPointerCapture = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollTop", {
            configurable: true,
            get(this: Element) {
                return places.get(this)?.top ?? 0;
            },
            set(this: Element, top: number) {
                places.set(this, { left: places.get(this)?.left ?? 0, top });
            },
        });
        Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
            configurable: true,
            get(this: Element) {
                return places.get(this)?.left ?? 0;
            },
            set(this: Element, left: number) {
                places.set(this, { left, top: places.get(this)?.top ?? 0 });
            },
        });
        vi.spyOn(gameManager, "tryGetCurrentGameScene").mockReturnValue({
            reposition: vi.fn(),
        } as unknown as GameScene);
        target = document.createElement("div");
        document.body.append(target);
        component = new OpenHereWindow({ target, props: { floating: false } });
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        coWebsites.removeAll();
        vi.restoreAllMocks();
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTop");
        Reflect.deleteProperty(HTMLElement.prototype, "scrollLeft");
    });

    it("keeps a reader only for the item in front and the one used before it, out of five open", async () => {
        await open("a.xlsx", "b.xlsx", "c.xlsx", "d.xlsx", "e.xlsx");

        expect(sheetsShown()).toHaveLength(2);
    });

    it("reads a file again when it is brought forward, on the sheet and at the place it was left", async () => {
        await open("a.xlsx", "b.xlsx", "c.xlsx", "d.xlsx", "e.xlsx");
        const items = [...target.querySelectorAll<HTMLElement>('[data-testid="fileViewerSheet"]')];
        expect(items).toHaveLength(2);

        // Pick the first file from the list: it was put away, so it is read again.
        target.querySelector<HTMLElement>('[data-testid="openHereList"]')?.click();
        await flush();
        target.querySelector<HTMLElement>('[data-testid="openHereListItem1"]')?.click();
        await flush();
        expect(sheetsShown()).toHaveLength(2);

        // On its second sheet, scrolled down and across.
        const shown = () => [...sheetsShown()].find((sheet) => sheet.closest(".viewer:not(.hidden)"));
        const tabs = shown()!.querySelectorAll<HTMLElement>('[role="tab"]');
        tabs[1].click();
        await flush();
        const scroller = shown()!.querySelector<HTMLElement>(".scroller")!;
        scroller.scrollTop = 240;
        scroller.scrollLeft = 30;

        // Four other files come to the front in turn, so the first one is put away again.
        for (const number of [2, 3, 4, 5]) {
            target.querySelector<HTMLElement>('[data-testid="openHereList"]')?.click();
            await flush();
            target.querySelector<HTMLElement>(`[data-testid="openHereListItem${number}"]`)?.click();
            await flush();
        }
        expect(sheetsShown()).toHaveLength(2);
        expect([...sheetsShown()].some((sheet) => places.get(sheet.querySelector(".scroller")!)?.top === 240)).toBe(
            false
        );

        target.querySelector<HTMLElement>('[data-testid="openHereList"]')?.click();
        await flush();
        target.querySelector<HTMLElement>('[data-testid="openHereListItem1"]')?.click();
        await flush();

        const back = shown()!;
        expect(back.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("February");
        const again = back.querySelector<HTMLElement>(".scroller")!;
        expect(again.scrollTop).toBe(240);
        expect(again.scrollLeft).toBe(30);
    });
});
