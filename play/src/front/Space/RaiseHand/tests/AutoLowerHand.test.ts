import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

vi.mock("../../../Stores/MediaStore", () => ({
    localVoiceIndicatorStore: writable(false),
    requestedMicrophoneState: writable(true),
}));
vi.mock("../../../Administration/AnalyticsClient", () => ({
    analyticsClient: { lowerHand: vi.fn(), keepHandRaised: vi.fn() },
}));

import { KEEP_IT_RAISED_MS, SPOKEN_MS, watchSpokenWhileHandRaised } from "../AutoLowerHand";
import { myHandRaisedStore } from "../RaiseHandStore";

describe("watchSpokenWhileHandRaised", () => {
    let talking = writable(false);
    let keep: (() => void) | undefined;
    const onSpoke = vi.fn((k: () => void) => {
        keep = k;
    });
    const onDone = vi.fn();
    let stop: () => void;

    beforeEach(() => {
        vi.useFakeTimers();
        talking = writable(false);
        keep = undefined;
        onSpoke.mockClear();
        onDone.mockClear();
        myHandRaisedStore.set(false);
        stop = watchSpokenWhileHandRaised(myHandRaisedStore, talking, onSpoke, onDone);
    });

    afterEach(() => {
        stop();
        vi.useRealTimers();
    });

    function talkFor(ms: number) {
        talking.set(true);
        vi.advanceTimersByTime(ms);
        talking.set(false);
    }

    it("does nothing while the hand is down", () => {
        talkFor(SPOKEN_MS * 2);
        expect(onSpoke).not.toHaveBeenCalled();
    });

    it("adds up talking time across pauses, then lowers the hand unless kept", () => {
        myHandRaisedStore.set(true);
        talkFor(SPOKEN_MS / 2);
        vi.advanceTimersByTime(3000);
        expect(onSpoke).not.toHaveBeenCalled();
        talkFor(SPOKEN_MS / 2);
        expect(onSpoke).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(KEEP_IT_RAISED_MS - 1);
        expect(get(myHandRaisedStore)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(get(myHandRaisedStore)).toBe(false);
    });

    it("keeps the hand up for good after Keep it raised", () => {
        myHandRaisedStore.set(true);
        talkFor(SPOKEN_MS);
        keep?.();
        vi.advanceTimersByTime(KEEP_IT_RAISED_MS * 2);
        talkFor(SPOKEN_MS * 2);
        expect(get(myHandRaisedStore)).toBe(true);
        expect(onSpoke).toHaveBeenCalledTimes(1);
    });

    it("starts counting again from zero when the hand is raised again", () => {
        myHandRaisedStore.set(true);
        talkFor(SPOKEN_MS - 100);
        myHandRaisedStore.set(false);
        myHandRaisedStore.set(true);
        talkFor(SPOKEN_MS - 100);
        expect(onSpoke).not.toHaveBeenCalled();
    });
});
