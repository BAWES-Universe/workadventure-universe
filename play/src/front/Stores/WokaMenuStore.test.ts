import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { PENDING_ANSWER_TIMEOUT_MS, wokaMenuStore } from "./WokaMenuStore";

describe("the card waits for its answers before showing buttons", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        wokaMenuStore.initialize("Sara", 7, "sara-uuid", undefined);
    });
    afterEach(() => {
        wokaMenuStore.clear();
        vi.useRealTimers();
    });

    it("starts with nothing to wait for", () => {
        expect(get(wokaMenuStore)?.pending).toEqual([]);
    });

    it("waits from the moment an answer is expected until it is in", () => {
        wokaMenuStore.expect("sara-uuid", "membership");
        wokaMenuStore.expect("sara-uuid", "bot-message");
        expect(get(wokaMenuStore)?.pending).toEqual(["membership", "bot-message"]);
        wokaMenuStore.settle("sara-uuid", "membership");
        expect(get(wokaMenuStore)?.pending).toEqual(["bot-message"]);
        wokaMenuStore.settle("sara-uuid", "bot-message");
        expect(get(wokaMenuStore)?.pending).toEqual([]);
    });

    it("counts one expected answer once", () => {
        wokaMenuStore.expect("sara-uuid", "membership");
        wokaMenuStore.expect("sara-uuid", "membership");
        expect(get(wokaMenuStore)?.pending).toEqual(["membership"]);
    });

    it("ignores an answer meant for someone else's card", () => {
        wokaMenuStore.expect("omar-uuid", "membership");
        expect(get(wokaMenuStore)?.pending).toEqual([]);
        wokaMenuStore.expect("sara-uuid", "membership");
        wokaMenuStore.settle("omar-uuid", "membership");
        expect(get(wokaMenuStore)?.pending).toEqual(["membership"]);
    });

    it("stops waiting for an answer that never comes", () => {
        wokaMenuStore.expect("sara-uuid", "membership");
        vi.advanceTimersByTime(PENDING_ANSWER_TIMEOUT_MS - 1);
        expect(get(wokaMenuStore)?.pending).toEqual(["membership"]);
        vi.advanceTimersByTime(1);
        expect(get(wokaMenuStore)?.pending).toEqual([]);
    });

    it("waits for nothing from the card before when it turns to someone else", () => {
        wokaMenuStore.expect("sara-uuid", "membership");
        wokaMenuStore.initialize("Omar", 8, "omar-uuid", undefined);
        expect(get(wokaMenuStore)?.pending).toEqual([]);
        // The old card's timer must not settle anything on the new one
        wokaMenuStore.expect("omar-uuid", "membership");
        vi.advanceTimersByTime(PENDING_ANSWER_TIMEOUT_MS - 1);
        expect(get(wokaMenuStore)?.pending).toEqual(["membership"]);
    });
});

describe("wokaMenuStore opening", () => {
    it("counts each opening, so a card opened again for the same person can ask again", () => {
        wokaMenuStore.initialize("Bot", 1, "bot-1", undefined);
        const first = get(wokaMenuStore)?.opening;
        wokaMenuStore.initialize("Bot", 1, "bot-1", undefined);
        expect(get(wokaMenuStore)?.opening).toBe((first ?? 0) + 1);
        wokaMenuStore.clear();
    });
});
