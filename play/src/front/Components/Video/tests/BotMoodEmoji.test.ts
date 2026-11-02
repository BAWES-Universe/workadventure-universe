import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const video = {
        botMood: () => "In a good mood",
        botWorking: ({ work }: { work: string }) => `Working: ${work}`,
        botWork: { read: () => "reading", search: () => "searching", write: () => "writing" },
    };
    return { default: readable({ video }), LL: readable({ video }) };
});

import BotMoodEmoji from "../BotMoodEmoji.svelte";
import type { BotFeeling } from "../../../Chat/Bots/BotMood";

describe("the emoji beside a bot's Woka (#1667)", () => {
    let target: HTMLElement;
    let shown: BotMoodEmoji | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        shown?.$destroy();
        target.remove();
        vi.useRealTimers();
    });

    const emoji = () => target.querySelector("[data-testid=botMoodEmoji]");
    const mount = (feeling: BotFeeling | undefined, talking = false) => {
        shown = new BotMoodEmoji({ target, props: { feeling, talking } });
        return shown;
    };

    it("shows nothing for a person or a bot with nothing to show", async () => {
        mount(undefined);
        await tick();
        expect(emoji()).toBeNull();
    });

    it("does not play a mood again when the box is drawn again", async () => {
        mount({ mood: "😄", moodSeq: 4 }, false);
        await tick();
        expect(emoji()).toBeNull();
        // A new mood after that still shows
        shown!.$set({ feeling: { mood: "🙂", moodSeq: 5 } });
        await tick();
        expect(emoji()?.textContent?.trim()).toBe("🙂");
    });

    it("shows a mood while the bot talks", async () => {
        mount({ mood: "😄", moodSeq: 1 }, true);
        await tick();
        expect(emoji()?.textContent?.trim()).toBe("😄");
        expect(emoji()?.getAttribute("aria-label")).toBe("In a good mood");
        expect(emoji()?.querySelector(".bob")).not.toBeNull();
    });

    it("shows a mood for a reply that is only read for 2.5 seconds, then lets it go", async () => {
        mount(undefined, false);
        await tick();
        shown!.$set({ feeling: { mood: "🙂", moodSeq: 1 } });
        await tick();
        expect(emoji()?.textContent?.trim()).toBe("🙂");
        vi.advanceTimersByTime(2499);
        await tick();
        expect(emoji()?.textContent?.trim()).toBe("🙂");
        vi.advanceTimersByTime(2);
        await tick();
        // It floats away: the element is gone once the 0.7 s float has run
        vi.advanceTimersByTime(1000);
        await tick();
        expect(emoji()).toBeNull();
    });

    it("shows the work emoji in the mood's place while the bot is not talking, and says it in words", async () => {
        mount({ mood: "😄", moodSeq: 1, work: "search" }, false);
        await tick();
        vi.advanceTimersByTime(3000);
        await tick();
        vi.advanceTimersByTime(1000);
        await tick();
        expect(emoji()?.textContent?.trim()).toBe("🔎");
        expect(emoji()?.getAttribute("aria-label")).toBe("Working: searching");
        expect(emoji()?.querySelector(".wiggle")).not.toBeNull();
    });
});
