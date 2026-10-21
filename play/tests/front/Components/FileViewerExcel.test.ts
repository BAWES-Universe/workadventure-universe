import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { readable } from "svelte/store";

// Vitest's Node conditions select Svelte's SSR no-op onMount; use the browser
// lifecycle hook that the compiled DOM component uses in the running client.
vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});
// Every text is its own key and its values, so the test reads what the panel says.
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy((values?: Record<string, unknown>) => `${path.join(".")}${values ? JSON.stringify(values) : ""}`, {
            get: (_target, key: string) => text([...path, key]),
        });
    return { default: readable(text([])) };
});

import FileViewerExcel from "../../../src/front/Components/Cowebsites/FileViewer/FileViewerExcel.svelte";

function workbookBytes(sheets: Record<string, unknown[][]>): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
    }
    return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("the spreadsheet reader panel", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mount(bytes: ArrayBuffer) {
        const reader = new FileViewerExcel({ target, props: { bytes } });
        component = reader;
    }

    it("draws the sheet with column letters and row numbers, and the cells as text", async () => {
        mount(
            workbookBytes({
                Growth: [
                    ["Month", "<b>Visitors</b>"],
                    ["Jan", 1240],
                ],
            })
        );
        await vi.waitFor(() => expect(target.querySelector("[data-testid=fileViewerSheet]")).not.toBeNull());

        expect([...target.querySelectorAll("thead th.letter")].map((cell) => cell.textContent)).toEqual(["A", "B"]);
        expect([...target.querySelectorAll("tbody th.number")].map((cell) => cell.textContent)).toEqual(["1", "2"]);
        // Markup in a cell shows as written and creates no elements.
        expect(target.querySelector("td b")).toBeNull();
        expect(target.querySelectorAll("tbody tr")[0].textContent).toContain("<b>Visitors</b>");
        expect(target.querySelector("td.num")?.textContent).toBe("1240");
        // One sheet: no tabs.
        expect(target.querySelector(".tabs")).toBeNull();
    });

    it("shows the opening box until the sheet is read", async () => {
        mount(workbookBytes({ Growth: [["Month"], ["Jan"]] }));
        await tick();
        expect(target.querySelector("[data-testid=fileViewerReading]")).not.toBeNull();
        expect(target.querySelector("[data-testid=fileViewerSheet]")).toBeNull();

        await vi.waitFor(() => expect(target.querySelector("[data-testid=fileViewerSheet]")).not.toBeNull());
        expect(target.querySelector("[data-testid=fileViewerReading]")).toBeNull();
    });

    it("switches sheets from the tabs at the bottom", async () => {
        mount(workbookBytes({ First: [["one"]], Second: [["two"]] }));
        await vi.waitFor(() => expect(target.querySelectorAll(".tabs button")).toHaveLength(2));

        expect(target.querySelector("td")?.textContent).toBe("one");
        (target.querySelectorAll(".tabs button")[1] as HTMLButtonElement).click();
        await tick();

        expect(target.querySelector("td")?.textContent).toBe("two");
        expect(target.querySelectorAll(".tabs button")[1].getAttribute("aria-selected")).toBe("true");
    });

    it("says how much of a long sheet it shows, with the way to get the rest", async () => {
        mount(workbookBytes({ Big: Array.from({ length: 1500 }, (_, index) => [index]) }));
        await vi.waitFor(() => expect(target.querySelector("[data-testid=fileViewerLimit]")).not.toBeNull());

        expect(target.querySelectorAll("tbody tr")).toHaveLength(1000);
        expect(target.querySelector("[data-testid=fileViewerLimit]")?.textContent).toContain(
            'chat.fileViewer.rowsCut{"shown":1000,"total":1500}'
        );
        expect(target.querySelector("[data-testid=fileViewerLimit]")?.textContent).toContain(
            "chat.fileViewer.downloadAll"
        );
    });

    it("draws nothing for a file it cannot read", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        mount(new Uint8Array([1, 2, 3, 4]).buffer);
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        expect(target.querySelector("table")).toBeNull();
        warn.mockRestore();
    });
});
