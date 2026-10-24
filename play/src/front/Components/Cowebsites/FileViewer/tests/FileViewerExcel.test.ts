import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { SheetView } from "../../../../FileViewer/spreadsheet";

// The tests run Svelte's server build, where onMount does nothing; the viewer needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../../i18n/i18n-svelte", async () => (await import("../../../Woka/tests/i18nStub")).i18nStub);

const sheet: SheetView = {
    name: "Sheet1",
    rows: [[{ text: "Name", number: false }]],
    columnCount: 1,
    totalRows: 1,
    rowsCut: false,
    columnsCut: false,
    textCut: false,
    styled: false,
    columnWidths: [],
};
vi.mock("../../../../FileViewer/spreadsheet", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readSpreadsheet: () => Promise.resolve([sheet]),
}));

import FileViewerExcel from "../FileViewerExcel.svelte";

function touch(target: Element, type: string, points: Array<[number, number]>): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) });
    target.dispatchEvent(event);
    return event;
}

describe("the spreadsheet viewer's zoom", () => {
    let component: FileViewerExcel | undefined;
    let target: HTMLDivElement;

    beforeEach(async () => {
        target = document.createElement("div");
        document.body.append(target);
        component = new FileViewerExcel({ target, props: { bytes: new ArrayBuffer(0) } });
        await tick();
        await tick();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    const scroller = () => target.querySelector<HTMLElement>(".scroller")!;
    const table = () => target.querySelector<HTMLElement>("table")!;
    // The zoom is set as a custom property on the table, which its style turns into the layout's zoom.
    const zoomOf = () => table().style.getPropertyValue("--sheet-zoom");

    it("is drawn at its size until two fingers pinch it", () => {
        expect(zoomOf()).toBe("");
    });

    it("grows when two fingers move apart, and shrinks when they come together", async () => {
        touch(scroller(), "touchstart", [
            [100, 200],
            [200, 200],
        ]);
        const move = touch(scroller(), "touchmove", [
            [50, 200],
            [250, 200],
        ]);
        await tick();
        await tick();

        expect(move.defaultPrevented).toBe(true);
        expect(zoomOf()).toBe("2");

        touch(scroller(), "touchmove", [
            [100, 200],
            [200, 200],
        ]);
        await tick();
        await tick();
        // Back at its own size, nothing is set.
        expect(zoomOf()).toBe("");
    });

    it("never goes past its smallest or biggest size", async () => {
        touch(scroller(), "touchstart", [
            [100, 200],
            [110, 200],
        ]);
        touch(scroller(), "touchmove", [
            [0, 200],
            [400, 200],
        ]);
        await tick();
        await tick();
        expect(zoomOf()).toBe("4");

        touch(scroller(), "touchmove", [
            [200, 200],
            [201, 200],
        ]);
        await tick();
        await tick();
        expect(zoomOf()).toBe("0.5");
    });

    it("zooms with Ctrl and the wheel, as a trackpad pinch arrives, and not without Ctrl", async () => {
        const plain = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
        scroller().dispatchEvent(plain);
        await tick();
        expect(plain.defaultPrevented).toBe(false);
        expect(zoomOf()).toBe("");

        const pinch = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
        scroller().dispatchEvent(pinch);
        await tick();
        await tick();
        expect(pinch.defaultPrevented).toBe(true);
        expect(Number(zoomOf())).toBeGreaterThan(1);
    });
});
