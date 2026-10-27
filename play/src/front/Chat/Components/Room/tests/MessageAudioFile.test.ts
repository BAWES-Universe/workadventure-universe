import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable } from "svelte/store";

vi.mock("../../../VoiceNote/AudioShape", () => ({ readAudioShape: () => Promise.resolve(undefined) }));
vi.mock("../MessageActions/availableActions", () => ({ saveMessageFiles: vi.fn() }));
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const voiceNote = new Proxy({}, { get: () => () => "label" });
    const audioFile = {
        from: ({ name }: { name: string }) => `Audio from ${name}`,
        untitled: () => "Audio",
        download: () => "Download",
        loading: () => "Loading…",
        cantPlay: () => "Can't play this file here. Download it instead.",
    };
    return { default: readable({ chat: { voiceNote, audioFile } }) };
});

import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import MessageAudioFile from "../Message/MessageAudioFile.svelte";
import { MESSAGE_SENDER_CONTEXT } from "../Message/messageSenderContext";
import { saveMessageFiles } from "../MessageActions/availableActions";

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

    it("shows the speed chip before it plays, and the time as played / length while it plays", async () => {
        await show(14);
        expect(target.querySelector(".voice-speed")?.textContent?.trim()).toBe("1×");
        expect(visibleText()).toContain("0:14");

        const audio = target.querySelector("audio") as HTMLAudioElement;
        audio.currentTime = 5;
        audio.dispatchEvent(new Event("timeupdate"));
        audio.dispatchEvent(new Event("play"));
        await tick();

        expect(visibleText()).toContain("0:05 / 0:14");
    });
});

describe("an audio file in chat", () => {
    let target: HTMLElement;
    const shown: { $destroy: () => void }[] = [];
    let pause: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        pause = vi.fn();
        HTMLMediaElement.prototype.pause = pause;
        vi.mocked(saveMessageFiles).mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        shown.splice(0).forEach((component) => component.$destroy());
        target.remove();
    });

    const visibleText = () => (target.textContent ?? "").replace(/\s+/g, " ").trim();

    async function show(filename: string, url = "blob:https://play.test/" + filename) {
        const holder = document.createElement("div");
        target.appendChild(holder);
        shown.push(
            new MessageAudioFile({
                target: holder,
                props: { content: readable(content({ url, filename, body: filename })) },
                context: new Map([[MESSAGE_SENDER_CONTEXT, { name: "Imagine [Music]", isMine: false }]]),
            })
        );
        await tick();
        return holder;
    }

    it("names a file with a machine-made name after its sender, and keeps the real name for Download", async () => {
        const holder = await show("ed481479-5635-4eea-af1c-d3686553d637.mp3");

        expect(holder.querySelector("[data-testid=audioFileTitle]")?.textContent?.trim()).toBe(
            "Audio from Imagine [Music]"
        );
        expect(visibleText()).not.toContain("ed481479");

        (holder.querySelector("button[aria-label=Download]") as HTMLButtonElement).click();

        expect(saveMessageFiles).toHaveBeenCalledWith([
            {
                url: "blob:https://play.test/ed481479-5635-4eea-af1c-d3686553d637.mp3",
                name: "ed481479-5635-4eea-af1c-d3686553d637.mp3",
            },
        ]);
    });

    it("shows a name a person gave the file, tidied, with its type", async () => {
        const holder = await show("Desert_Drive.mp3");

        expect(holder.querySelector("[data-testid=audioFileTitle]")?.textContent?.trim()).toBe("Desert Drive");
        expect(visibleText()).toContain("MP3");
    });

    it("can be played as soon as the file is here, before the browser has read anything of it", async () => {
        const holder = await show("Desert Drive.mp3");

        expect(visibleText()).not.toContain("Loading");
        expect((holder.querySelector(".voice-play") as HTMLButtonElement).disabled).toBe(false);
    });

    it("says when the file can't play here and keeps Download", async () => {
        const holder = await show("old-recording.wma");
        holder.querySelector("audio")?.dispatchEvent(new Event("error"));
        await tick();

        expect(visibleText()).toContain("Can't play this file here");
        expect(holder.querySelector("audio")).toBeNull();
        expect(holder.querySelector("button[aria-label=Download]")).not.toBeNull();
    });

    it("plays one audio at a time: starting a second pauses the first", async () => {
        const first = await show("Desert Drive.mp3");
        const second = await show("ambient-loop.mp3");
        const firstAudio = first.querySelector("audio") as HTMLAudioElement;
        const secondAudio = second.querySelector("audio") as HTMLAudioElement;

        firstAudio.dispatchEvent(new Event("play"));
        secondAudio.dispatchEvent(new Event("play"));

        expect(pause.mock.contexts).toContain(firstAudio);
        expect(pause.mock.contexts).not.toContain(secondAudio);
    });
});
