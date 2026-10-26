import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount, onDestroy } = await import("svelte/internal");
    return { ...svelte, onMount, onDestroy };
});

import { coWebsites } from "../../../src/front/Stores/CoWebsiteStore";
import type { CoWebsite } from "../../../src/front/WebRtc/CoWebsite/CoWebsite";
import KeyedPanels from "./probes/KeyedPanels.svelte";
import { panelEvents } from "./probes/panelEvents";

function fakePanel(id: string): CoWebsite {
    return { getId: () => id, getWidthPercent: () => undefined } as unknown as CoWebsite;
}

describe("bringing an open panel back to the front", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        panelEvents.length = 0;
        coWebsites.removeAll();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        coWebsites.removeAll();
    });

    it("moves the panel without taking it down, so its zoom, search and place are kept", async () => {
        const first = fakePanel("file");
        const second = fakePanel("page");
        coWebsites.add(first);
        coWebsites.add(second);
        component = new KeyedPanels({ target });
        await tick();
        panelEvents.length = 0;

        // What opening an already open file again does.
        coWebsites.remove(first);
        coWebsites.add(first);
        await tick();

        expect(panelEvents).toEqual([]);
        expect(Array.from(target.querySelectorAll("[data-panel]")).map((el) => el.getAttribute("data-panel"))).toEqual([
            "page",
            "file",
        ]);
    });
});
