import { derived, get, writable } from "svelte/store";
import type { Observable, Subscription } from "rxjs";
import type { FriendsUpdateMessage, RingAnswer, RingIncoming, RingReplyAnswer } from "@workadventure/messages";

/** What the ring store needs from the room's connection (a RoomConnection), kept small for tests. */
export interface RingConnection {
    queryRing(targetUuid: string): Promise<RingAnswer>;
    queryRingReply(ringId: string, action: "stop" | "accept" | "decline"): Promise<RingReplyAnswer>;
    friendsUpdateMessageStream: Observable<FriendsUpdateMessage>;
}

/** How long a ring lasts, and how long an unanswered one keeps you from ringing them again (the pusher's rules). */
export const RING_MS = 30_000;
export const RING_AGAIN_MS = 10 * 60_000;
/** "On the way" stays on their row this long, or until they arrive. */
const ON_THE_WAY_MS = 3 * 60_000;

export type OutgoingState = "starting" | "ringing" | "accepted" | "declined" | "no_answer" | "stopped" | "too_soon";

/** A ring you made, by the friend's uuid. */
export interface OutgoingRing {
    ringId?: string;
    name: string;
    state: OutgoingState;
    startedAt: number;
    /** When Ring works again for them; set once a ring ends without them coming. */
    retryAt?: number;
    /** When this entry goes away by itself. */
    until: number;
}

/** A friend ringing you. */
export interface IncomingRingCard extends RingIncoming {
    receivedAt: number;
}

/** A one-line message at the top of the screen about your rings. */
export interface RingToast {
    id: number;
    kind: RingToastKind;
    name: string;
    /** For "too_soon": minutes left. */
    minutes?: number;
}

export type RingToastKind =
    | "arrived"
    | "accepted"
    | "declined"
    | "no_answer"
    | "busy"
    | "offline"
    | "not_allowed"
    | "not_friends"
    | "too_soon"
    | "already_ringing"
    | "ended"
    | "failed";

const TOAST_MS = 5000;

export function createRingStore(now: () => number = Date.now) {
    const incoming = writable<IncomingRingCard | undefined>(undefined);
    const outgoing = writable<Map<string, OutgoingRing>>(new Map());
    const toasts = writable<RingToast[]>([]);
    let connection: RingConnection | undefined;
    let updates: Subscription | undefined;
    let incomingTimer: ReturnType<typeof setTimeout> | undefined;
    const entryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let nextToast = 1;

    function toast(kind: RingToastKind, name: string, minutes?: number) {
        const id = nextToast++;
        // One line per friend: "came over" replaces "on the way".
        toasts.update((list) => [...list.filter((t) => t.name !== name).slice(-2), { id, kind, name, minutes }]);
        setTimeout(() => toasts.update((list) => list.filter((t) => t.id !== id)), TOAST_MS);
    }

    function setEntry(uuid: string, entry: OutgoingRing | undefined) {
        const timer = entryTimers.get(uuid);
        if (timer) clearTimeout(timer);
        entryTimers.delete(uuid);
        outgoing.update((map) => {
            const next = new Map(map);
            if (entry) next.set(uuid, entry);
            else next.delete(uuid);
            return next;
        });
        if (entry) {
            entryTimers.set(
                uuid,
                setTimeout(() => {
                    entryTimers.delete(uuid);
                    const current = get(outgoing).get(uuid);
                    if (current === entry) setEntry(uuid, undefined);
                }, Math.max(0, entry.until - now()))
            );
        }
    }

    // A ring that ended without them coming: Ring waits until the pusher allows it again.
    function endUnanswered(uuid: string, entry: OutgoingRing, state: "declined" | "no_answer" | "stopped") {
        const retryAt = now() + RING_AGAIN_MS;
        setEntry(uuid, { ...entry, state, retryAt, until: retryAt });
    }

    function findByRingId(ringId: string): [string, OutgoingRing] | undefined {
        for (const [uuid, entry] of get(outgoing)) {
            if (entry.ringId === ringId) return [uuid, entry];
        }
        return undefined;
    }

    function clearIncoming() {
        if (incomingTimer) clearTimeout(incomingTimer);
        incomingTimer = undefined;
        incoming.set(undefined);
    }

    function onUpdate(message: FriendsUpdateMessage) {
        switch (message.update?.$case) {
            case "ringIncoming": {
                const ring = message.update.ringIncoming;
                if (incomingTimer) clearTimeout(incomingTimer);
                incoming.set({ ...ring, receivedAt: now() });
                // The pusher says when it ends; this only cleans up if that message never comes.
                incomingTimer = setTimeout(() => {
                    if (get(incoming)?.ringId === ring.ringId) clearIncoming();
                }, (ring.expiresInMs || RING_MS) + 2000);
                break;
            }
            case "ringEnded": {
                if (get(incoming)?.ringId === message.update.ringEnded.ringId) clearIncoming();
                break;
            }
            case "ringResult": {
                const { ringId, targetUuid, result } = message.update.ringResult;
                const found = findByRingId(ringId);
                const uuid = found?.[0] ?? targetUuid;
                const entry = found?.[1] ?? get(outgoing).get(uuid);
                // Nothing to say about a ring this tab no longer knows (another tab's, or one already cleared).
                if (!entry) return;
                const name = entry.name;
                if (result === "arrived") {
                    setEntry(uuid, undefined);
                    toast("arrived", name);
                } else if (result === "accepted") {
                    setEntry(uuid, { ...entry, state: "accepted", until: now() + ON_THE_WAY_MS });
                    toast("accepted", name);
                } else if (entry.state === "stopped") {
                    // You stopped it, though the stop may not have reached the pusher: no "didn't answer" after that.
                    return;
                } else if (result === "declined" || result === "no_answer") {
                    endUnanswered(uuid, entry, result);
                    toast(result, name);
                }
                break;
            }
        }
    }

    function requireConnection(): RingConnection {
        if (!connection) throw new Error("Rings are for signed-in players");
        return connection;
    }

    return {
        incoming: { subscribe: incoming.subscribe },
        outgoing: { subscribe: outgoing.subscribe },
        toasts: { subscribe: toasts.subscribe },
        attach(newConnection: RingConnection, signedIn: boolean): void {
            updates?.unsubscribe();
            clearIncoming();
            connection = signedIn ? newConnection : undefined;
            updates = signedIn ? newConnection.friendsUpdateMessageStream.subscribe(onUpdate) : undefined;
            // A new room is a new connection: rings from the last one ended with it.
            for (const [uuid, entry] of get(outgoing)) {
                if (entry.state === "ringing" || entry.state === "starting") setEntry(uuid, undefined);
            }
        },
        detach(): void {
            updates?.unsubscribe();
            updates = undefined;
            connection = undefined;
            clearIncoming();
        },
        /** Rings a friend. A refusal shows a toast; resolves whether it is ringing. */
        async ring(uuid: string, name: string): Promise<boolean> {
            // Still ringing, on their way, or rung lately: one at a time.
            if (get(outgoing).has(uuid)) return false;
            // One friend at a time, as the pusher has it: say so now rather than show two rings for a moment.
            for (const entry of get(outgoing).values()) {
                if (entry.state === "starting" || entry.state === "ringing") {
                    toast("already_ringing", name);
                    return false;
                }
            }
            const startedAt = now();
            const starting: OutgoingRing = { name, state: "starting", startedAt, until: startedAt + RING_MS };
            setEntry(uuid, starting);
            let answer: RingAnswer;
            try {
                answer = await requireConnection().queryRing(uuid);
            } catch (e) {
                console.error("Ring: could not ring", e);
                if (get(outgoing).get(uuid) === starting) setEntry(uuid, undefined);
                // Too many rings in a minute: the limit lifts within a minute.
                if (e instanceof Error && e.message === "rate_limited") toast("too_soon", name, 1);
                else toast("failed", name);
                return false;
            }
            if (get(outgoing).get(uuid) !== starting) return false;
            if (answer.outcome === "ringing") {
                setEntry(uuid, {
                    ...starting,
                    ringId: answer.ringId,
                    state: "ringing",
                    // The pusher ends it; a little slack in case its message is late.
                    until: now() + RING_MS + 5000,
                });
                return true;
            }
            if (answer.outcome === "too_soon") {
                const retryAt = now() + answer.retryAfterSeconds * 1000;
                setEntry(uuid, { ...starting, state: "too_soon", retryAt, until: retryAt });
                toast("too_soon", name, Math.max(1, Math.ceil(answer.retryAfterSeconds / 60)));
                return false;
            }
            setEntry(uuid, undefined);
            const known: RingToastKind[] = ["busy", "offline", "not_allowed", "not_friends", "already_ringing"];
            toast(known.includes(answer.outcome as RingToastKind) ? (answer.outcome as RingToastKind) : "failed", name);
            return false;
        },
        /** Stops your ring to them. */
        async stop(uuid: string): Promise<void> {
            const entry = get(outgoing).get(uuid);
            if (!entry?.ringId || entry.state !== "ringing") return;
            endUnanswered(uuid, entry, "stopped");
            try {
                await requireConnection().queryRingReply(entry.ringId, "stop");
            } catch (e) {
                console.error("Ring: could not stop", e);
            }
        },
        /** Come over: resolves where the caller is, or undefined when the ring is already over. */
        async accept(): Promise<{ playUri: string; callerUuid: string } | undefined> {
            const card = get(incoming);
            if (!card) return undefined;
            clearIncoming();
            try {
                const answer = await requireConnection().queryRingReply(card.ringId, "accept");
                if (!answer.ok) {
                    toast("ended", card.fromName);
                    return undefined;
                }
                return { playUri: answer.playUri || card.playUri, callerUuid: answer.callerUuid || card.fromUuid };
            } catch (e) {
                console.error("Ring: could not answer", e);
                toast("ended", card.fromName);
                return undefined;
            }
        },
        /** Not now. */
        async decline(): Promise<void> {
            const card = get(incoming);
            if (!card) return;
            clearIncoming();
            try {
                await requireConnection().queryRingReply(card.ringId, "decline");
            } catch (e) {
                console.error("Ring: could not answer", e);
            }
        },
    };
}

export const ringStore = createRingStore();
export const incomingRingStore = ringStore.incoming;
export const outgoingRingsStore = ringStore.outgoing;
export const ringToastsStore = ringStore.toasts;

/** Ticks every second while something counts down, so labels like "Ringing · 18 s" stay current. */
export const ringClockStore = derived(
    [ringStore.outgoing, ringStore.incoming],
    ([$outgoing, $incoming], set: (value: number) => void) => {
        set(Date.now());
        if ($outgoing.size === 0 && !$incoming) return;
        const interval = setInterval(() => set(Date.now()), 1000);
        return () => clearInterval(interval);
    },
    Date.now()
);
