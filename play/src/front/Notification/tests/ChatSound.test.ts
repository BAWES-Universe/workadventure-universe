import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatSoundPlayed, playsChatSound, PLAYED_WITHIN_MS, WAIT_FOR_SOUND_MS } from "../ChatSound";

describe("ChatSound: whether this page rang for a chat's newest message (#1493)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("says yes for a sound just played in that chat", async () => {
        chatSoundPlayed("!a:chat", 1_000);

        await expect(playsChatSound("!a:chat", 1_000 + PLAYED_WITHIN_MS - 1)).resolves.toBe(true);
    });

    it("waits for the sound when the push comes before the message", async () => {
        const answer = playsChatSound("!b:chat", Date.now());
        chatSoundPlayed("!b:chat");

        await expect(answer).resolves.toBe(true);
    });

    it("says no when no sound comes for that chat in time", async () => {
        const answer = playsChatSound("!c:chat", Date.now());
        chatSoundPlayed("!other:chat");
        await vi.advanceTimersByTimeAsync(WAIT_FOR_SOUND_MS);

        await expect(answer).resolves.toBe(false);
    });

    it("does not count an older sound as this message's", async () => {
        chatSoundPlayed("!d:chat", 1_000);
        const answer = playsChatSound("!d:chat", 1_000 + PLAYED_WITHIN_MS);
        await vi.advanceTimersByTimeAsync(WAIT_FOR_SOUND_MS);

        await expect(answer).resolves.toBe(false);
    });
});
