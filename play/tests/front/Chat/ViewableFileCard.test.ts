import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { readable, writable } from "svelte/store";

// Vitest's Node conditions select Svelte's SSR no-op onMount; use the browser
// lifecycle hook that the compiled DOM component uses in the running client.
vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

const actions = vi.hoisted(() => ({
    openChatFileInViewer: vi.fn(),
    openChatFileInNewTab: vi.fn(),
    saveMessageFiles: vi.fn(() => Promise.resolve()),
}));
const openKeys = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../../../src/front/Chat/Components/Room/MessageActions/availableActions", () => ({
    saveMessageFiles: actions.saveMessageFiles,
}));
vi.mock("../../../src/front/FileViewer/openFileViewer", async () => {
    const { writable: createWritable } = await import("svelte/store");
    openKeys.current = createWritable(new Set<string>());
    return {
        openChatFileInViewer: actions.openChatFileInViewer,
        openChatFileInNewTab: actions.openChatFileInNewTab,
        openFileViewerKeys: openKeys.current,
    };
});
// Every text is the key it comes from, so the test reads the buttons by their test ids.
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { default: readable(deep()) };
});

import MessageFile from "../../../src/front/Chat/Components/Room/Message/MessageFile.svelte";
import ViewableFileCard from "../../../src/front/Chat/Components/Room/Message/ViewableFileCard.svelte";
import { MESSAGE_SENDER_CONTEXT } from "../../../src/front/Chat/Components/Room/Message/messageSenderContext";

function byTestId(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!element) throw new Error(`No element with test id ${id}`);
    return element;
}

describe("a chat file card", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        (openKeys.current as ReturnType<typeof writable<Set<string>>>).set(new Set());
        target = document.createElement("div");
        document.body.appendChild(target);
        global.fetch = vi.fn(() =>
            Promise.resolve({ blob: () => Promise.resolve({ size: 2048 }) })
        ) as unknown as typeof fetch;
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mountPdfCard(): void {
        component = new ViewableFileCard({
            target,
            props: { url: "blob:http://play/report", name: "Report.pdf" },
            context: new Map([[MESSAGE_SENDER_CONTEXT, { name: "Sara", isMine: false }]]),
        });
    }

    it("opens the file beside the map when tapped, saying who sent it", async () => {
        mountPdfCard();
        await tick();

        byTestId("fileCard").querySelector("a")?.click();

        expect(actions.openChatFileInViewer).toHaveBeenCalledWith({
            url: "blob:http://play/report",
            name: "Report.pdf",
            senderName: "Sara",
            sentByMe: false,
        });
        expect(actions.openChatFileInNewTab).not.toHaveBeenCalled();
    });

    it("opens the browser's own viewer in a new tab on Ctrl or Cmd click", async () => {
        mountPdfCard();
        await tick();
        const link = byTestId("fileCard").querySelector("a");

        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));

        expect(actions.openChatFileInNewTab).toHaveBeenCalledTimes(2);
        expect(actions.openChatFileInViewer).not.toHaveBeenCalled();
    });

    it("downloads with the separate Download button and does not open the viewer", async () => {
        mountPdfCard();
        await tick();

        byTestId("fileCardDownload").click();

        expect(actions.saveMessageFiles).toHaveBeenCalledWith([{ url: "blob:http://play/report", name: "Report.pdf" }]);
        expect(actions.openChatFileInViewer).not.toHaveBeenCalled();
    });

    it("shows the file size from the copy chat already holds", async () => {
        mountPdfCard();
        await vi.waitFor(() => expect(byTestId("fileCard").textContent).toContain("PDF · 2 KB"));
    });

    it("is outlined while its file is open in the viewer", async () => {
        mountPdfCard();
        await tick();
        expect(byTestId("fileCard").classList.contains("open")).toBe(false);

        (openKeys.current as ReturnType<typeof writable<Set<string>>>).set(new Set(["chat:blob:http://play/report"]));
        await tick();

        expect(byTestId("fileCard").classList.contains("open")).toBe(true);
    });

    describe("in a message", () => {
        function mountMessageFile(filename: string, url: string | undefined): void {
            component = new MessageFile({
                target,
                props: { content: writable({ body: filename, filename, url, urls: undefined, fileNames: undefined }) },
            });
        }

        it("keeps every other file a plain download link", async () => {
            mountMessageFile("bundle.zip", "blob:http://play/zip");
            await tick();

            const link = target.querySelector("a");
            expect(link?.getAttribute("download")).toBe("bundle.zip");
            expect(link?.getAttribute("href")).toBe("blob:http://play/zip");
            expect(document.querySelector('[data-testid="fileCard"]')).toBeNull();
        });

        it("keeps a picture-named office file a plain download link", async () => {
            mountMessageFile("Budget.xlsx", "blob:http://play/xlsx");
            await tick();

            expect(target.querySelector("a")?.getAttribute("download")).toBe("Budget.xlsx");
            expect(document.querySelector('[data-testid="fileCard"]')).toBeNull();
        });

        it("shows a PDF as a card once its file is ready", async () => {
            mountMessageFile("Report.pdf", "blob:http://play/report");
            await tick();

            expect(document.querySelector('[data-testid="fileCard"]')).not.toBeNull();
        });

        it("shows a PDF that is still loading as the loading row, not a link", async () => {
            mountMessageFile("Report.pdf", undefined);
            await tick();

            expect(document.querySelector('[data-testid="fileCard"]')).toBeNull();
            expect(target.querySelector("a")).toBeNull();
            expect(target.querySelector('[aria-busy="true"]')).not.toBeNull();
        });
    });
});
