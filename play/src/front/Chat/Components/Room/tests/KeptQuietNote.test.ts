import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";
import type { KeptQuiet } from "../../../Connection/ChatConnection";

vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            chat: {
                voiceDraft: {
                    unsaidForOthers: () => "Not said out loud, so nobody else hears it",
                    stoppedForOthers: () => "Stopped, so nobody else hears it",
                },
            },
        }),
    };
});

import KeptQuietNote from "../KeptQuietNote.svelte";

describe("the note under a voice bot's reply that was kept from other people's ears (#1993)", () => {
    let target: HTMLElement | undefined;
    let shown: { $destroy: () => void } | undefined;

    afterEach(() => {
        shown?.$destroy();
        target?.remove();
    });

    it("is not there for a reply that was said as usual, and says which of the two happened otherwise", async () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        const keptQuiet = writable<KeptQuiet>("");
        shown = new KeptQuietNote({ target, props: { keptQuiet } });
        await tick();
        expect(target.querySelector("[data-testid=keptQuiet]")).toBeNull();

        keptQuiet.set("unsaid");
        await tick();
        expect(target.querySelector("[data-testid=keptQuiet]")?.textContent).toBe(
            "Not said out loud, so nobody else hears it"
        );

        keptQuiet.set("stopped");
        await tick();
        expect(target.querySelectorAll("[data-testid=keptQuiet]")).toHaveLength(1);
        expect(target.querySelector("[data-testid=keptQuiet]")?.textContent).toBe("Stopped, so nobody else hears it");
    });
});
