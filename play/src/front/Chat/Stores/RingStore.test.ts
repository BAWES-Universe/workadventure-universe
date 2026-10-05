import { get } from "svelte/store";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FriendsUpdateMessage, RingAnswer, RingReplyAnswer } from "@workadventure/messages";
import type { RingConnection } from "./RingStore";
import { createRingStore, RING_AGAIN_MS } from "./RingStore";

function fakeConnection(
    ringAnswer: RingAnswer,
    replyAnswer: RingReplyAnswer = { ok: true, playUri: "", callerUuid: "" }
) {
    const updates = new Subject<FriendsUpdateMessage>();
    const queryRing = vi.fn(() => Promise.resolve(ringAnswer));
    const queryRingReply = vi.fn(() => Promise.resolve(replyAnswer));
    const connection: RingConnection = {
        queryRing,
        queryRingReply,
        friendsUpdateMessageStream: updates.asObservable(),
    };
    return { connection, updates, queryRing, queryRingReply };
}

const ringing: RingAnswer = { outcome: "ringing", ringId: "r1", retryAfterSeconds: 0 };

function result(result: string, ringId = "r1"): FriendsUpdateMessage {
    return { update: { $case: "ringResult", ringResult: { ringId, targetUuid: "sara", result } } };
}

describe("ringStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("rings, shows Stop, and on no answer waits ten minutes before Ring works again", async () => {
        const store = createRingStore();
        const { connection, updates, queryRing } = fakeConnection(ringing);
        store.attach(connection, true);

        expect(await store.ring("sara", "Sara")).toBe(true);
        expect(get(store.outgoing).get("sara")).toMatchObject({ state: "ringing", ringId: "r1" });

        updates.next(result("no_answer"));
        const entry = get(store.outgoing).get("sara");
        expect(entry).toMatchObject({ state: "no_answer" });
        expect(entry?.retryAt).toBe(Date.now() + RING_AGAIN_MS);
        expect(get(store.toasts).map((t) => t.kind)).toEqual(["no_answer"]);

        // A second ring meanwhile isn't even sent.
        expect(await store.ring("sara", "Sara")).toBe(false);
        expect(queryRing).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(RING_AGAIN_MS);
        expect(get(store.outgoing).has("sara")).toBe(false);
    });

    it("says on the way, then that they came over", async () => {
        const store = createRingStore();
        const { connection, updates, queryRing } = fakeConnection(ringing);
        store.attach(connection, true);
        await store.ring("sara", "Sara");

        updates.next(result("accepted"));
        expect(get(store.outgoing).get("sara")?.state).toBe("accepted");
        // While they are on the way, Ring isn't sent again.
        expect(await store.ring("sara", "Sara")).toBe(false);
        expect(queryRing).toHaveBeenCalledTimes(1);
        updates.next(result("arrived"));
        expect(get(store.outgoing).has("sara")).toBe(false);
        expect(get(store.toasts).map((t) => t.kind)).toEqual(["arrived"]);

        // Arriving after "on the way" was cleared says nothing (there is no name to say it with).
        vi.advanceTimersByTime(10_000);
        updates.next(result("arrived"));
        expect(get(store.toasts)).toEqual([]);
    });

    it("tells why a ring was refused, and how long to wait when it was too soon", async () => {
        const store = createRingStore();
        store.attach(fakeConnection({ outcome: "busy", ringId: "", retryAfterSeconds: 0 }).connection, true);
        expect(await store.ring("sara", "Sara")).toBe(false);
        expect(get(store.outgoing).has("sara")).toBe(false);

        const soon = createRingStore();
        soon.attach(fakeConnection({ outcome: "too_soon", ringId: "", retryAfterSeconds: 130 }).connection, true);
        await soon.ring("sara", "Sara");
        expect(get(soon.outgoing).get("sara")?.state).toBe("too_soon");
        expect(get(soon.toasts)[0]).toMatchObject({ kind: "too_soon", minutes: 3 });
        expect(get(store.toasts)[0]).toMatchObject({ kind: "busy", name: "Sara" });
    });

    it("stops a ring and waits before ringing again", async () => {
        const store = createRingStore();
        const { connection, queryRingReply } = fakeConnection(ringing);
        store.attach(connection, true);
        await store.ring("sara", "Sara");
        await store.stop("sara");
        expect(queryRingReply).toHaveBeenCalledWith("r1", "stop");
        expect(get(store.outgoing).get("sara")?.state).toBe("stopped");
    });

    it("says nothing more about a ring you stopped, even when the stop got lost", async () => {
        const store = createRingStore();
        const { connection, updates, queryRingReply } = fakeConnection(ringing);
        queryRingReply.mockRejectedValueOnce(new Error("socket closed"));
        store.attach(connection, true);
        await store.ring("sara", "Sara");
        await store.stop("sara");
        updates.next(result("no_answer"));
        expect(get(store.outgoing).get("sara")?.state).toBe("stopped");
        expect(get(store.toasts)).toEqual([]);
    });

    it("rings one friend at a time", async () => {
        const store = createRingStore();
        const { connection, queryRing } = fakeConnection(ringing);
        store.attach(connection, true);
        const first = store.ring("sara", "Sara");
        expect(await store.ring("noura", "Noura")).toBe(false);
        expect(await first).toBe(true);
        expect(queryRing).toHaveBeenCalledTimes(1);
        expect(get(store.outgoing).has("noura")).toBe(false);
        expect(get(store.toasts)[0]).toMatchObject({ kind: "already_ringing", name: "Noura" });
    });

    it("says to wait a minute after too many rings", async () => {
        const store = createRingStore();
        const { connection, queryRing } = fakeConnection(ringing);
        queryRing.mockRejectedValueOnce(new Error("rate_limited"));
        store.attach(connection, true);
        expect(await store.ring("sara", "Sara")).toBe(false);
        expect(get(store.toasts)[0]).toMatchObject({ kind: "too_soon", minutes: 1 });
    });

    it("shows a friend's ring until it ends, and answers it", async () => {
        const store = createRingStore();
        const { connection, updates, queryRingReply } = fakeConnection(ringing, {
            ok: true,
            playUri: "https://play/@/u/w/hall",
            callerUuid: "omar",
        });
        store.attach(connection, true);
        const incoming = (ringId: string): FriendsUpdateMessage => ({
            update: {
                $case: "ringIncoming",
                ringIncoming: {
                    ringId,
                    fromUuid: "omar",
                    fromName: "Omar",
                    playUri: "https://play/@/u/w/hall",
                    roomName: "Main Hall",
                    worldName: "Bawes",
                    universeName: "",
                    expiresInMs: 30000,
                },
            },
        });

        updates.next(incoming("a"));
        expect(get(store.incoming)?.fromName).toBe("Omar");
        updates.next({ update: { $case: "ringEnded", ringEnded: { ringId: "a", reason: "expired" } } });
        expect(get(store.incoming)).toBeUndefined();

        updates.next(incoming("b"));
        expect(await store.accept()).toEqual({ playUri: "https://play/@/u/w/hall", callerUuid: "omar" });
        expect(queryRingReply).toHaveBeenCalledWith("b", "accept");
        expect(get(store.incoming)).toBeUndefined();

        // Never told it ended: it goes away on its own.
        updates.next(incoming("c"));
        vi.advanceTimersByTime(33_000);
        expect(get(store.incoming)).toBeUndefined();
    });

    it("drops a friend's ring when its connection closes, but not a newer connection's", () => {
        const store = createRingStore();
        const first = fakeConnection(ringing);
        store.attach(first.connection, true);
        const second = fakeConnection(ringing);
        store.detach(second.connection);
        first.updates.next({
            update: {
                $case: "ringIncoming",
                ringIncoming: {
                    ringId: "a",
                    fromUuid: "omar",
                    fromName: "Omar",
                    playUri: "",
                    roomName: "",
                    worldName: "",
                    universeName: "",
                    expiresInMs: 30000,
                },
            },
        });
        expect(get(store.incoming)?.ringId).toBe("a");
        store.detach(first.connection);
        expect(get(store.incoming)).toBeUndefined();
    });

    it("rings nobody for guests", async () => {
        const store = createRingStore();
        const { connection, queryRing } = fakeConnection(ringing);
        store.attach(connection, false);
        expect(await store.ring("sara", "Sara")).toBe(false);
        expect(queryRing).not.toHaveBeenCalled();
        expect(get(store.toasts)[0]?.kind).toBe("failed");
    });
});
