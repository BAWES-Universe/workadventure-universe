import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPING_IDLE_MS, TYPING_REFRESH_MS, TypingSignal } from "../TypingSignal";

describe("TypingSignal", () => {
    let sent: boolean[];
    let signal: TypingSignal;

    beforeEach(() => {
        vi.useFakeTimers();
        sent = [];
        signal = new TypingSignal((typing) => sent.push(typing));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("says typing once for a burst of keys, not once per key", () => {
        for (let i = 0; i < 10; i++) {
            signal.keyTyped();
            vi.advanceTimersByTime(150);
        }
        expect(sent).toEqual([true]);
    });

    it("says typing again every few seconds while the keys keep coming", () => {
        for (let elapsed = 0; elapsed < TYPING_REFRESH_MS * 3; elapsed += 200) {
            signal.keyTyped();
            vi.advanceTimersByTime(200);
        }
        expect(sent).toEqual([true, true, true]);
    });

    it("never says stopped while someone types non-stop for a long message (#1379)", () => {
        // Long past the old 10 second timer, with keys in bursts and short pauses to think.
        for (let elapsed = 0; elapsed < 40_000; elapsed += 1000) {
            signal.keyTyped();
            vi.advanceTimersByTime(elapsed % 7000 === 0 ? 3000 : 1000);
        }
        expect(sent).not.toContain(false);
    });

    it("says stopped after a few seconds with no key", () => {
        signal.keyTyped();
        vi.advanceTimersByTime(TYPING_IDLE_MS - 1);
        expect(sent).toEqual([true]);
        vi.advanceTimersByTime(1);
        expect(sent).toEqual([true, false]);
    });

    it("says stopped at once when the message is sent, and the idle timer does not say it again", () => {
        signal.keyTyped();
        signal.stop();
        expect(sent).toEqual([true, false]);
        vi.advanceTimersByTime(TYPING_IDLE_MS * 2);
        expect(sent).toEqual([true, false]);
    });

    it("says nothing on stop when it never said typing", () => {
        signal.stop();
        expect(sent).toEqual([]);
    });

    it("says typing straight away when typing starts again after a stop", () => {
        signal.keyTyped();
        signal.stop();
        signal.keyTyped();
        expect(sent).toEqual([true, false, true]);
    });
});
