import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";

// The wording is the approved mock's, word for word.
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { default: readable({ chat: { voiceDraft: { stopped: () => "Stopped when you spoke" } } }) };
});

import StoppedBySpeechNote from "../StoppedBySpeechNote.svelte";

describe("the note under a voice bot's reply that someone spoke over", () => {
    let target: HTMLElement | undefined;
    let shown: { $destroy: () => void } | undefined;

    afterEach(() => {
        shown?.$destroy();
        target?.remove();
    });

    it("is there only once the voice stopped, and says so in the mock's words", async () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        const stopped = writable(false);
        shown = new StoppedBySpeechNote({ target, props: { stopped } });
        await tick();
        expect(target.querySelector("[data-testid=stoppedBySpeech]")).toBeNull();
        stopped.set(true);
        await tick();
        expect(target.querySelector("[data-testid=stoppedBySpeech]")?.textContent).toBe("Stopped when you spoke");
    });
});
