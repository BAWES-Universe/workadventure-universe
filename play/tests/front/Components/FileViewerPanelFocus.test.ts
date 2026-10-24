import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount, onDestroy, afterUpdate } = await import("svelte/internal");
    return { ...svelte, onMount, onDestroy, afterUpdate };
});

import FileViewerCowebsiteComponent from "../../../src/front/Components/Cowebsites/FileViewerCowebsiteComponent.svelte";
import { FileViewerCoWebsite } from "../../../src/front/WebRtc/CoWebsite/FileViewerCoWebsite";
import { inputFormFocusStore } from "../../../src/front/Stores/UserInputStore";

describe("the file panel and the game's keys", () => {
    let target: HTMLElement | undefined;

    afterEach(() => {
        target?.remove();
        target = undefined;
        inputFormFocusStore.set(false);
    });

    function mountPanel(): FileViewerCowebsiteComponent {
        target = document.createElement("div");
        document.body.appendChild(target);
        const coWebsite = new FileViewerCoWebsite({
            key: "chat:blob:http://play/panel",
            name: "plan.pdf",
            // The file never arrives: only the panel's own frame is under test.
            load: () => new Promise<ArrayBuffer>(() => {}),
            download: () => Promise.resolve(),
        });
        return new FileViewerCowebsiteComponent({ target, props: { actualCowebsite: coWebsite, visible: true } });
    }

    it("leaves the keys alone when a panel that was never used is removed while another box has the focus", async () => {
        const panel = mountPanel();
        await tick();
        // The person is typing in the chat box: the game's keys are switched off by that box.
        inputFormFocusStore.set(true);

        panel.$destroy();

        expect(get(inputFormFocusStore)).toBe(true);
    });

    it("hands the keys back to the game when the panel that had the focus is removed", async () => {
        const panel = mountPanel();
        await tick();
        const frame = target?.firstElementChild as HTMLElement;
        frame.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(get(inputFormFocusStore)).toBe(true);

        panel.$destroy();

        expect(get(inputFormFocusStore)).toBe(false);
    });

    it("hands the keys back to the game when the panel that had the focus is hidden", async () => {
        const panel = mountPanel();
        await tick();
        const frame = target?.firstElementChild as HTMLElement;
        frame.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(get(inputFormFocusStore)).toBe(true);

        // Hiding the panel reports no focusout in some browsers.
        panel.$set({ visible: false });
        await tick();

        expect(get(inputFormFocusStore)).toBe(false);
        panel.$destroy();
    });
});
