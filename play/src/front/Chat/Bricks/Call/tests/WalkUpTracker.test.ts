import { describe, expect, it } from "vitest";
import { createWalkUpTracker } from "../WalkUpTracker";
import { callReducer, startCall, type CallState } from "../CallSession";

const ana = { id: "a", name: "Ana" };
const bo = { id: "b", name: "Bo" };
const on = (): CallState => callReducer(startCall(0), { type: "connected", now: 1 });

describe("who has walked up during a call", () => {
    it("does not ask about people who were already here when the call started", () => {
        const tracker = createWalkUpTracker();
        tracker.start([ana]);
        expect(tracker.next([ana], on())).toBeUndefined();
        expect(tracker.next([ana, bo], on())).toEqual(bo);
    });

    it("asks about the new person once their card is answered, and not again while they stay", () => {
        const tracker = createWalkUpTracker();
        tracker.start([]);
        expect(tracker.next([ana], on())).toEqual(ana);
        tracker.answer("a");
        expect(tracker.next([ana], on())).toBeUndefined();
    });

    it("asks about the next person on their own after one card is answered", () => {
        const tracker = createWalkUpTracker();
        tracker.start([]);
        expect(tracker.next([ana, bo], on())).toEqual(ana);
        tracker.answer("a");
        expect(tracker.next([ana, bo], on())).toEqual(bo);
    });

    it("does not ask while a card is showing, or while the call is not on", () => {
        const tracker = createWalkUpTracker();
        tracker.start([]);
        const showing = callReducer(on(), { type: "someone-here", id: "a", name: "Ana" });
        expect(tracker.next([ana, bo], showing)).toBeUndefined();
        expect(tracker.next([ana], startCall(0))).toBeUndefined();
        const held = callReducer(showing, { type: "hold-and-talk" });
        expect(tracker.next([ana, bo], held)).toBeUndefined();
    });

    it("counts someone who leaves and comes back as walking up again", () => {
        const tracker = createWalkUpTracker();
        tracker.start([]);
        expect(tracker.next([ana], on())).toEqual(ana);
        tracker.answer("a");
        expect(tracker.next([], on())).toBeUndefined();
        expect(tracker.next([ana], on())).toEqual(ana);
    });

    it("takes everyone in the bubble as dealt with when the person holds the call to talk", () => {
        const tracker = createWalkUpTracker();
        tracker.start([]);
        tracker.answerAll([ana, bo]);
        expect(tracker.next([ana, bo], on())).toBeUndefined();
    });

    it("starts afresh for the next call", () => {
        const tracker = createWalkUpTracker();
        tracker.start([]);
        tracker.answer("a");
        tracker.start([]);
        expect(tracker.next([ana], on())).toEqual(ana);
    });
});
