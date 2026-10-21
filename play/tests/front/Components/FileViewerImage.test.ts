import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

import FileViewerImage from "../../../src/front/Components/Cowebsites/FileViewer/FileViewerImage.svelte";
import type { ViewerController } from "../../../src/front/FileViewer/viewerController";

describe("the picture reader's first fit", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;
    let resized: (() => void) | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        URL.createObjectURL = vi.fn(() => "blob:http://play/picture");
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal(
            "ResizeObserver",
            class {
                constructor(callback: () => void) {
                    resized = callback;
                }
                observe(): void {}
                disconnect(): void {}
            }
        );
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        vi.unstubAllGlobals();
    });

    function open(): {
        area: HTMLElement;
        picture: HTMLImageElement;
        controller: () => Required<Pick<ViewerController, "zoomPercent">>;
    } {
        const reader = new FileViewerImage({ target, props: { bytes: new ArrayBuffer(8), name: "plan.png" } });
        component = reader;
        const internals = (reader as unknown as { $$: { ctx: unknown[]; props: Record<string, number> } }).$$;
        return {
            area: target.querySelector(".image-area") as HTMLElement,
            picture: target.querySelector("img") as HTMLImageElement,
            controller: () =>
                internals.ctx[internals.props.controller] as Required<Pick<ViewerController, "zoomPercent">>,
        };
    }

    function size(element: HTMLElement, width: number, height: number): void {
        Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
        Object.defineProperty(element, "clientHeight", { configurable: true, value: height });
    }

    it("fits a picture to the panel once it has a size", async () => {
        const { area, picture, controller } = open();
        await tick();
        size(area, 400, 300);
        Object.defineProperty(picture, "naturalWidth", { configurable: true, value: 800 });
        Object.defineProperty(picture, "naturalHeight", { configurable: true, value: 600 });
        picture.dispatchEvent(new Event("load"));
        await tick();

        expect(get(controller().zoomPercent)).toBe(50);
    });

    it("waits to fit a picture that loaded while the panel was hidden, then fits it", async () => {
        const { area, picture, controller } = open();
        await tick();
        size(area, 0, 0);
        Object.defineProperty(picture, "naturalWidth", { configurable: true, value: 800 });
        Object.defineProperty(picture, "naturalHeight", { configurable: true, value: 600 });
        picture.dispatchEvent(new Event("load"));
        await tick();
        // Not squeezed to the smallest zoom while there is no room to measure.
        expect(get(controller().zoomPercent)).toBe(100);

        size(area, 400, 300);
        resized?.();
        await tick();
        expect(get(controller().zoomPercent)).toBe(50);
    });
});
