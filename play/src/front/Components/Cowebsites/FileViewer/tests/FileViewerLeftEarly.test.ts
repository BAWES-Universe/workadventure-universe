/* eslint-disable no-await-in-loop -- each tick has to finish before the next one starts */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";

// The tests run Svelte's server build, where onMount does nothing; the readers need the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../../i18n/i18n-svelte", async () => (await import("../../../Woka/tests/i18nStub")).i18nStub);
vi.mock("../../../../Administration/AnalyticsClient", () => ({
    analyticsClient: new Proxy({}, { get: () => () => {} }),
}));

const reads = vi.hoisted(() => ({ finish: [] as Array<() => void> }));
vi.mock("../../../../FileViewer/spreadsheet", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    // A file that is read when the test says so.
    readSpreadsheet: () =>
        new Promise((resolve) => {
            reads.finish.push(() =>
                resolve(
                    ["January", "February"].map((name) => ({
                        name,
                        rows: [[{ text: name, number: false }]],
                        columnCount: 1,
                        totalRows: 1,
                        rowsCut: false,
                        columnsCut: false,
                        textCut: false,
                        styled: false,
                        columnWidths: [],
                    }))
                )
            );
        }),
}));

import { FileViewerCoWebsite } from "../../../../WebRtc/CoWebsite/FileViewerCoWebsite";
import FileViewerCowebsiteComponent from "../../FileViewerCowebsiteComponent.svelte";

describe("a spreadsheet that leaves the front before its file has been read", () => {
    let component: FileViewerCowebsiteComponent | undefined;
    let target: HTMLDivElement;

    const flush = async () => {
        for (let i = 0; i < 6; i++) await tick();
    };

    beforeEach(() => {
        reads.finish.length = 0;
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("is put away, and read again at the place saved before once it is back", async () => {
        const book = new FileViewerCoWebsite({
            key: "chat:blob:http://play/book.xlsx",
            name: "book.xlsx",
            load: () => Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer),
            download: () => Promise.resolve(),
        });
        component = new FileViewerCowebsiteComponent({
            target,
            props: { actualCowebsite: book, visible: true, parked: false },
        });
        await flush();

        // Read, and on its second sheet; then it leaves the front.
        reads.finish.shift()?.();
        await flush();
        target.querySelectorAll<HTMLElement>('[role="tab"]')[1].click();
        await flush();
        component.$set({ visible: false });
        await flush();

        // Brought forward and read again, and it leaves again before that read is done.
        component.$set({ visible: true, parked: true });
        await flush();
        component.$set({ parked: false });
        await flush();
        expect(reads.finish).toHaveLength(1);
        component.$set({ visible: false });
        await flush();
        expect(target.querySelector('[data-testid="fileViewerSheet"]')).toBeNull();

        // Back in front: it is read again, on the sheet it was left on.
        component.$set({ visible: true });
        await flush();
        expect(reads.finish).toHaveLength(2);
        reads.finish[1]();
        await flush();
        expect(target.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("February");
    });
});
