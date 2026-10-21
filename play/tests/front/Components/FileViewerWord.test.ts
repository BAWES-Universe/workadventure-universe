import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { readable } from "svelte/store";

// Vitest's Node conditions select Svelte's SSR no-op onMount; use the browser
// lifecycle hook that the compiled DOM component uses in the running client.
vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount, afterUpdate } = await import("svelte/internal");
    return { ...svelte, onMount, afterUpdate };
});
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const text = (path: string[]): unknown =>
        new Proxy((values?: Record<string, unknown>) => `${path.join(".")}${values ? JSON.stringify(values) : ""}`, {
            get: (_target, key: string) => text([...path, key]),
        });
    return { default: readable(text([])) };
});
const render = vi.hoisted(() => ({ renderWordDocument: vi.fn() }));
vi.mock("../../../src/front/FileViewer/wordDocument", () => ({ renderWordDocument: render.renderWordDocument }));

import FileViewerWord from "../../../src/front/Components/Cowebsites/FileViewer/FileViewerWord.svelte";

describe("the Word reader's frame", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("draws the document in a sealed frame that can run no script", async () => {
        render.renderWordDocument.mockResolvedValue({
            srcdoc: "<!doctype html><p>Hi</p>",
            pageWidth: 816,
            pageCount: 2,
        });
        component = new FileViewerWord({
            target,
            props: { bytes: new ArrayBuffer(8), name: "plan.docx", compact: false },
        });
        await vi.waitFor(() => expect(target.querySelector("iframe[sandbox]")).not.toBeNull());
        await tick();

        const frame = target.querySelector("iframe[sandbox]") as HTMLIFrameElement;
        expect(frame.getAttribute("srcdoc")).toBe("<!doctype html><p>Hi</p>");
        const rules = frame.getAttribute("sandbox")?.split(/\s+/) ?? [];
        // Same origin only lets the panel measure and zoom the frame; scripts, forms, pop-ups and top navigation stay off.
        expect(rules).toEqual(["allow-same-origin"]);
        expect(frame.getAttribute("src")).toBeNull();
    });

    it("shows the opening box until the document is drawn", async () => {
        let finish: (rendered: { srcdoc: string; pageWidth: number; pageCount: number }) => void = () => undefined;
        render.renderWordDocument.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        component = new FileViewerWord({
            target,
            props: { bytes: new ArrayBuffer(8), name: "plan.docx", compact: false },
        });
        await tick();
        expect(target.querySelector('[data-testid="fileViewerReading"]')).not.toBeNull();
        expect(target.querySelector("iframe[sandbox]")).toBeNull();

        finish({ srcdoc: "<!doctype html><p>Hi</p>", pageWidth: 816, pageCount: 1 });
        await vi.waitFor(() => expect(target.querySelector("iframe[sandbox]")).not.toBeNull());
        await tick();
        expect(target.querySelector('[data-testid="fileViewerReading"]')).toBeNull();
    });

    it("keeps the reader at the same place in the document when the zoom changes", async () => {
        render.renderWordDocument.mockResolvedValue({
            srcdoc: "<!doctype html><p>Hi</p>",
            pageWidth: 816,
            pageCount: 2,
        });
        const reader = new FileViewerWord({
            target,
            props: { bytes: new ArrayBuffer(8), name: "plan.docx", compact: false },
        });
        component = reader;
        await vi.waitFor(() => expect(target.querySelector("iframe[sandbox]")).not.toBeNull());
        await tick();
        const internals = (reader as unknown as { $$: { ctx: unknown[]; props: Record<string, number> } }).$$;
        const controller = internals.ctx[internals.props.controller] as { zoomIn(): void };

        // The document is 2000 tall; after the zoom it is 4000 tall, and the reader was a quarter of the way down.
        const area = target.querySelector('[data-testid="fileViewerWord"]') as HTMLElement;
        let zoomed = false;
        Object.defineProperty(area, "scrollHeight", { configurable: true, get: () => (zoomed ? 4000 : 2000) });
        area.scrollTop = 500;
        zoomed = false;
        controller.zoomIn();
        zoomed = true;
        await tick();

        expect(area.scrollTop).toBe(1000);
    });

    it("keeps the reader at the same place in the document when the panel changes width", async () => {
        render.renderWordDocument.mockResolvedValue({
            srcdoc: "<!doctype html><p>Hi</p>",
            pageWidth: 816,
            pageCount: 2,
        });
        component = new FileViewerWord({
            target,
            props: { bytes: new ArrayBuffer(8), name: "plan.docx", compact: false },
        });
        await vi.waitFor(() => expect(target.querySelector("iframe[sandbox]")).not.toBeNull());
        await tick();

        // The panel is 600 wide with a document 2000 tall; turned to 300 wide, the document is 4000 tall.
        const area = target.querySelector('[data-testid="fileViewerWord"]') as HTMLElement;
        let width = 600;
        // The first read after the turn is the reader's place, taken before the document is resized: the next is after.
        let readsAfterTurn = 0;
        Object.defineProperty(area, "clientWidth", { configurable: true, get: () => width });
        Object.defineProperty(area, "scrollHeight", {
            configurable: true,
            get: () => (width === 300 && readsAfterTurn++ > 0 ? 4000 : 2000),
        });
        const resizer = [...target.querySelectorAll("iframe[aria-hidden]")].find((frame) => frame.contentWindow) as
            | HTMLIFrameElement
            | undefined;
        resizer?.contentWindow?.dispatchEvent(new Event("resize"));
        await tick();
        area.scrollTop = 500;

        width = 300;
        resizer?.contentWindow?.dispatchEvent(new Event("resize"));
        await tick();

        expect(resizer).toBeDefined();
        expect(area.scrollTop).toBe(1000);
    });

    it("says it failed when the file cannot be drawn", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        render.renderWordDocument.mockRejectedValue(new Error("Corrupted zip"));
        const reader = new FileViewerWord({
            target,
            props: { bytes: new ArrayBuffer(8), name: "x.docx", compact: false },
        });
        component = reader;
        const failed = vi.fn();
        (reader as unknown as { $on(name: string, handler: () => void): void }).$on("failed", failed);

        await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
        expect(target.querySelector("iframe[sandbox]")).toBeNull();
        warn.mockRestore();
    });
});
