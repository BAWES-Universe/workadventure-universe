/* eslint-disable no-await-in-loop -- each tick has to finish before the next one starts */
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The tests run Svelte's server build, where onMount does nothing; the readers need the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../../i18n/i18n-svelte", async () => (await import("../../../Woka/tests/i18nStub")).i18nStub);
vi.mock("../../../../FileViewer/spreadsheet", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readSpreadsheet: () =>
        Promise.resolve([
            {
                name: "January",
                rows: [[{ text: "Jan", number: false }]],
                columnCount: 1,
                totalRows: 1,
                rowsCut: false,
                columnsCut: false,
                textCut: false,
                styled: false,
                columnWidths: [],
            },
        ]),
}));

import FileViewerExcel from "../FileViewerExcel.svelte";

describe("where a reader reports it is", () => {
    let component: FileViewerExcel | undefined;

    afterEach(() => {
        component?.$destroy();
        component = undefined;
    });

    it("says nothing before the file has been read, so the place that was saved stays", async () => {
        component = new FileViewerExcel({
            target: document.body,
            props: { bytes: new ArrayBuffer(8), view: { sheet: 1, scrollY: 240 } },
        });
        expect(component.getView()).toBeUndefined();

        for (let i = 0; i < 6; i++) await tick();
        expect(component.getView()).toMatchObject({ sheet: 0 });
    });

    it("keeps the zoom it had when it is brought back", async () => {
        component = new FileViewerExcel({
            target: document.body,
            props: { bytes: new ArrayBuffer(8), view: { zoom: 2, sheet: 0 } },
        });
        for (let i = 0; i < 6; i++) await tick();
        expect(component.getView()).toMatchObject({ zoom: 2 });
    });
});
