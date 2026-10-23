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

import FileViewerText from "../../../src/front/Components/Cowebsites/FileViewer/FileViewerText.svelte";
import type { FileViewerKind } from "../../../src/front/FileViewer/fileKinds";

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("the text reader", () => {
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

    function mount(kind: FileViewerKind, bytes: ArrayBuffer) {
        const events = { loaded: vi.fn(), failed: vi.fn(), download: vi.fn() };
        const reader = new FileViewerText({ target, props: { kind, bytes } });
        component = reader;
        for (const [name, handler] of Object.entries(events)) {
            (reader as unknown as { $on(name: string, handler: (event: unknown) => void): void }).$on(name, handler);
        }
        return events;
    }

    it("shows Markdown formatted and runs nothing in it", async () => {
        mount("markdown", encode("# Title\n\n<script>window.__ran = true</script>\n\n[a](https://example.com)"));
        await tick();

        expect(target.querySelector(".md h1")?.textContent).toBe("Title");
        expect(target.querySelector("script")).toBeNull();
        expect((window as unknown as { __ran?: boolean }).__ran).toBeUndefined();
        expect(target.querySelector(".md a")?.getAttribute("target")).toBe("_blank");
    });

    it("shows text as it is, and one-line JSON over several lines", async () => {
        mount("text", encode("<b>not bold</b>\n  kept"));
        await tick();
        expect(target.querySelector(".plain")?.textContent).toBe("<b>not bold</b>\n  kept");
        expect(target.querySelector("b")).toBeNull();
        component?.$destroy();

        mount("json", encode('{"a":[1,2]}'));
        await tick();
        expect(target.querySelector(".plain")?.textContent).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    });

    it("shows a CSV as a table with every cell as text", async () => {
        mount("csv", encode('Name,Note\nSara,"<img src=x onerror=alert(1)>"\nOmar,ok'));
        await tick();

        expect(target.querySelectorAll("th")).toHaveLength(2);
        expect(target.querySelectorAll("tbody tr")).toHaveLength(2);
        expect(target.querySelector("td img")).toBeNull();
        expect(target.textContent).toContain("<img src=x onerror=alert(1)>");
        expect(target.querySelector('[data-testid="fileViewerLimit"]')).toBeNull();
    });

    it("cuts a long text at 1 MB, says so, and offers the download", async () => {
        const events = mount("text", encode("x".repeat(1024 * 1024 + 10)));
        await tick();

        expect(target.querySelector(".plain")?.textContent).toHaveLength(1024 * 1024);
        const note = target.querySelector('[data-testid="fileViewerLimit"]');
        expect(note?.textContent).toContain("chat.fileViewer.textCut");
        note?.querySelector("button")?.click();
        expect(events.download).toHaveBeenCalledOnce();
    });

    it("cuts a table at 1,000 rows with the total", async () => {
        mount("csv", encode(Array.from({ length: 1005 }, (_, index) => `r${index},x`).join("\n")));
        await tick();

        expect(target.querySelectorAll("tbody tr")).toHaveLength(999);
        expect(target.querySelector('[data-testid="fileViewerLimit"]')?.textContent).toContain('"total":1005');
    });
});
