import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import { createCallStore } from "../CallStore";
import { createCallRuntime, CALL_TICK_MS, QUIET_STRETCH_MS, type NearbyKind } from "../CallRuntime";

let clock = 0;
const ana = { id: "a", name: "Ana" };
const bo = { id: "b", name: "Bo" };

function setup(start?: { kind?: NearbyKind; people?: Array<{ id: string; name: string }> }) {
    const store = createCallStore(() => clock);
    const nearby = writable<{ kind: NearbyKind; people: Array<{ id: string; name: string }> }>({
        kind: start?.kind ?? "none",
        people: start?.people ?? [],
    });
    const speaking = writable(false);
    const runtime = createCallRuntime({ store, nearby, speaking, now: () => clock });
    const state = () => get(store)?.state;
    const callOn = () => {
        store.start("b1", "Nora");
        store.send({ type: "connected", now: clock });
    };
    return { store, nearby, speaking, runtime, state, callOn };
}

beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
});
afterEach(() => vi.useRealTimers());

const pass = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
};

describe("someone walks up during a call", () => {
    it("shows one card for a person who joins the bubble, and none for people already there", () => {
        const t = setup({ kind: "bubble", people: [ana] });
        t.callOn();
        expect(t.state()?.walkUp).toBeUndefined();
        t.nearby.set({ kind: "bubble", people: [ana, bo] });
        expect(t.state()?.walkUp).toEqual({ id: "b", name: "Bo" });
        expect(t.state()?.phase).toBe("on");
        t.runtime.destroy();
    });

    it("takes the card away when that person leaves the bubble, and asks about whoever is next", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "bubble", people: [ana, bo] });
        expect(t.state()?.walkUp?.id).toBe("a");
        t.nearby.set({ kind: "bubble", people: [bo] });
        expect(t.state()?.walkUp?.id).toBe("b");
        t.nearby.set({ kind: "bubble", people: [] });
        expect(t.state()?.walkUp).toBeUndefined();
        expect(t.state()?.phase).toBe("on");
        t.runtime.destroy();
    });

    it("takes the card away when the bubble goes, and asks again if the person comes back", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "bubble", people: [ana] });
        expect(t.state()?.walkUp?.id).toBe("a");
        t.nearby.set({ kind: "none", people: [] });
        expect(t.state()?.walkUp).toBeUndefined();
        t.nearby.set({ kind: "bubble", people: [ana] });
        expect(t.state()?.walkUp?.id).toBe("a");
        t.runtime.destroy();
    });

    it("Not now leaves the call on, and does not ask about the same person again", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "bubble", people: [ana] });
        t.runtime.notNow();
        expect(t.state()?.walkUp).toBeUndefined();
        expect(t.state()?.phase).toBe("on");
        t.nearby.set({ kind: "bubble", people: [ana] });
        expect(t.state()?.walkUp).toBeUndefined();
        t.runtime.destroy();
    });

    it("asks about the next person once a card is answered", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "bubble", people: [ana, bo] });
        expect(t.state()?.walkUp?.id).toBe("a");
        t.runtime.notNow();
        expect(t.state()?.walkUp?.id).toBe("b");
        t.runtime.destroy();
    });

    it("Hold call and talk puts the call on hold first, for that person, and asks nobody else", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "bubble", people: [ana, bo] });
        t.runtime.holdAndTalk();
        expect(t.state()?.phase).toBe("hold");
        expect(t.state()?.hold).toEqual({ kind: "person", name: "Ana" });
        expect(t.state()?.walkUp).toBeUndefined();
        // Only Resume brings it back, and the people who were here are not asked about then
        t.store.send({ type: "resume", now: clock });
        expect(t.state()?.phase).toBe("on");
        expect(t.state()?.walkUp).toBeUndefined();
        t.runtime.destroy();
    });

    it("never asks about anyone before the call is on, or once it is over", () => {
        const t = setup({ kind: "bubble" });
        t.store.start("b1", "Nora");
        t.nearby.set({ kind: "bubble", people: [ana] });
        expect(t.state()?.walkUp).toBeUndefined();
        t.store.send({ type: "end", by: "you" });
        t.nearby.set({ kind: "bubble", people: [ana, bo] });
        expect(t.state()?.walkUp).toBeUndefined();
        t.runtime.destroy();
    });
});

describe("a meeting", () => {
    it("puts the call on hold once as the person walks in, and leaves it to a tap to bring it back", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "meeting", people: [ana] });
        expect(t.state()?.phase).toBe("hold");
        expect(t.state()?.hold).toEqual({ kind: "meeting" });
        t.store.send({ type: "resume", now: clock });
        t.nearby.set({ kind: "meeting", people: [ana, bo] });
        expect(t.state()?.phase).toBe("on");
        expect(t.state()?.walkUp).toBeUndefined();
        t.runtime.destroy();
    });

    it("holds the call the moment it connects when the person was already in a meeting", () => {
        const t = setup({ kind: "meeting" });
        t.store.start("b1", "Nora");
        t.store.send({ type: "connected", now: clock });
        expect(t.state()?.phase).toBe("hold");
        t.runtime.destroy();
    });
});

describe("a quiet stretch", () => {
    it("ends a call nobody has spoken in, and says it was quiet", () => {
        const t = setup();
        t.callOn();
        pass(QUIET_STRETCH_MS - CALL_TICK_MS);
        expect(t.state()?.phase).toBe("on");
        pass(CALL_TICK_MS * 2);
        expect(t.state()?.phase).toBe("ended");
        expect(t.state()?.endedBy).toBe("quiet");
        t.runtime.destroy();
    });

    it("does not end while the person keeps speaking, however long", () => {
        const t = setup();
        t.callOn();
        t.speaking.set(true);
        pass(QUIET_STRETCH_MS * 3);
        expect(t.state()?.phase).toBe("on");
        t.runtime.destroy();
    });

    it("starts counting again from the last thing heard", () => {
        const t = setup();
        t.callOn();
        pass(QUIET_STRETCH_MS - 10_000);
        t.speaking.set(true);
        t.speaking.set(false);
        pass(QUIET_STRETCH_MS - 10_000);
        expect(t.state()?.phase).toBe("on");
        t.runtime.destroy();
    });

    it("does not end a call on hold, and stops looking at the clock once the call is over", () => {
        const t = setup({ kind: "bubble" });
        t.callOn();
        t.nearby.set({ kind: "meeting", people: [] });
        pass(QUIET_STRETCH_MS * 2);
        expect(t.state()?.phase).toBe("hold");
        t.store.send({ type: "end", by: "you" });
        expect(vi.getTimerCount()).toBe(0);
        t.runtime.destroy();
    });
});
