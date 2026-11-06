import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The wording is the approved mock's, word for word.
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const voiceDraft = {
        onlyYou: () => "Only you see this",
        lost: () => "Some of your words didn't come through. Nothing was sent.",
        edit: () => "Edit",
        send: () => "Send",
        discard: () => "Discard",
        said: () => "Said out loud",
    };
    return { default: readable({ chat: { voiceDraft } }) };
});

import type { BotVoiceDraft } from "../../../Bots/BotVoiceDraft";
import VoiceDraftCard from "../VoiceDraftCard.svelte";

const draft = (state: BotVoiceDraft["state"], text: string): BotVoiceDraft => ({
    botId: "b-1",
    botName: "Nora",
    turnId: "1-1",
    state,
    text,
});

describe("the card for what a voice bot hears you say", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;
    const onEdit = vi.fn();
    const onSend = vi.fn();
    const onDiscard = vi.fn();

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        vi.clearAllMocks();
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    async function show(value: BotVoiceDraft) {
        shown = new VoiceDraftCard({ target, props: { draft: value, onEdit, onSend, onDiscard } });
        await tick();
    }
    const text = (id: string) =>
        (target.querySelector(`[data-testid=${id}]`)?.textContent ?? "").replace(/\s+/g, " ").trim();
    const buttons = () => [...target.querySelectorAll("button")].map((button) => button.textContent?.trim());

    it("says only you see a live draft, shows the words with the newest one quieter and a caret, and has no buttons", async () => {
        await show(draft("live", "Actually which of them replied this week"));
        expect(text("voiceDraftNote")).toBe("Only you see this");
        expect(text("voiceDraftWords")).toBe("Actually which of them replied this week");
        expect(target.querySelector(".tail")?.textContent).toBe("week");
        expect(target.querySelector(".caret")).not.toBeNull();
        expect(buttons()).toEqual([]);
    });

    it("tells words that did not come through apart, in amber, with the three choices and no caret", async () => {
        await show(draft("lost", "Actually, which of them replied"));
        expect(target.querySelector("[data-testid=voiceDraft]")?.classList.contains("lost")).toBe(true);
        expect(text("voiceDraftNote")).toBe("Some of your words didn't come through. Nothing was sent.");
        expect(text("voiceDraftWords")).toBe("Actually, which of them replied");
        expect(target.querySelector(".caret")).toBeNull();
        expect(buttons()).toEqual(["Edit", "Send", "Discard"]);
    });

    it("gives each choice its own action for that stretch of speech", async () => {
        await show(draft("lost", "words"));
        (target.querySelector("[data-testid=voiceDraftEdit]") as HTMLButtonElement).click();
        (target.querySelector("[data-testid=voiceDraftSend]") as HTMLButtonElement).click();
        (target.querySelector("[data-testid=voiceDraftDiscard]") as HTMLButtonElement).click();
        expect(onEdit).toHaveBeenCalledWith("1-1");
        expect(onSend).toHaveBeenCalledWith("1-1");
        expect(onDiscard).toHaveBeenCalledWith("1-1");
    });
});
