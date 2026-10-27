import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable } from "svelte/store";

vi.mock("../../../VoiceNote/AudioShape", () => ({ readAudioShape: () => Promise.resolve(undefined) }));
vi.mock("../MessageActions/availableActions", () => ({ saveMessageFiles: vi.fn() }));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const voiceNote = new Proxy({}, { get: () => () => "label" });
    return { default: readable({ chat: { voiceNote } }) };
});

import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import MessageAudioFile from "../Message/MessageAudioFile.svelte";

function content(partial: Partial<ChatMessageContent>): ChatMessageContent {
    return { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined, ...partial };
}

describe("an audio file whose shape could not be read", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        // jsdom does not play media.
        HTMLMediaElement.prototype.pause = vi.fn();
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    const visibleText = () => (target.textContent ?? "").replace(/\s+/g, " ").trim();

    async function show(duration: number) {
        shown = new MessageAudioFile({
            target,
            props: { content: readable(content({ url: "https://example.test/song.m4a", filename: "song.m4a" })) },
        });
        await tick();
        const audio = target.querySelector("audio") as HTMLAudioElement;
        Object.defineProperty(audio, "duration", { configurable: true, value: duration });
        audio.dispatchEvent(new Event("durationchange"));
        await tick();
    }

    it("takes its length from the player", async () => {
        await show(95);

        expect(visibleText()).toContain("1:35");
    });

    it("ignores a length the player cannot tell yet", async () => {
        await show(Infinity);

        expect(visibleText()).toContain("0:00");
    });
});
