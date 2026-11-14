import { get, type Readable } from "svelte/store";
import { isLive, type CallState } from "./CallSession";
import type { botCallStore } from "./CallStore";
import { createWalkUpTracker, type Nearby } from "./WalkUpTracker";

/**
 * A call with no one speaking for this long ends (a quiet stretch). Built in, not a setting: a call left open would keep
 * the bot's voice listening (and the owner's key paying), while someone who has simply stopped to think is not cut off
 * in the first ten minutes. Anything the bot says counts as someone speaking.
 */
export const QUIET_STRETCH_MS = 10 * 60 * 1000;
/** How often the call looks at the clock. */
export const CALL_TICK_MS = 5000;

/** What the game says is around the person: nothing, a bubble, a meeting room, or a speaker zone. */
export type NearbyKind = "none" | "bubble" | "meeting" | "stream";

export interface CallRuntimeDeps {
    store: Pick<typeof botCallStore, "subscribe" | "send">;
    /** Who is with the person right now (bots left out), and what kind of place it is. */
    nearby: Readable<{ kind: NearbyKind; people: readonly Nearby[] }>;
    /** Whether the person is speaking right now. */
    speaking: Readable<boolean>;
    now(): number;
    quietMs?: number;
    tickMs?: number;
}

/**
 * What goes on around a live call (game #2004), as events for CallSession's rules: the clock that ends a quiet stretch,
 * the person's own voice, someone walking up, and a meeting. Every piece it needs comes in, so a test runs it without a
 * game. It never touches the person's status: Busy and Do not disturb stay as they set them.
 */
export function createCallRuntime(deps: CallRuntimeDeps) {
    const tracker = createWalkUpTracker();
    let running = false;
    const cleanups: Array<() => void> = [];
    let kind: NearbyKind = "none";
    let people: readonly Nearby[] = [];
    let lastKind: NearbyKind = "none";
    let speaking = false;
    let seeded = false;

    const state = (): CallState | undefined => get(deps.store as Readable<{ state: CallState } | undefined>)?.state;

    // Looks at what is around the person, and answers with at most one event each time
    const evaluate = (): void => {
        const current = state();
        if (!running || !seeded || !current) return;
        // A meeting puts the call on hold, once, as the person walks in (the person's tap on Resume is what brings it back)
        if (kind === "meeting" && lastKind !== "meeting") deps.store.send({ type: "meeting-joined" });
        lastKind = kind;
        if (kind !== "bubble") return;
        const newcomer = tracker.next(people, state() ?? current);
        if (newcomer) deps.store.send({ type: "someone-here", id: newcomer.id, name: newcomer.name });
    };

    const begin = (): void => {
        running = true;
        seeded = false;
        lastKind = "none";
        cleanups.push(
            deps.nearby.subscribe((here) => {
                kind = here.kind;
                people = here.people;
                evaluate();
            })
        );
        // Whoever is in the bubble as the call begins is not new
        tracker.start(kind === "bubble" ? people : []);
        seeded = true;
        cleanups.push(
            deps.speaking.subscribe((now) => {
                speaking = now;
                if (now && state()?.phase === "on") deps.store.send({ type: "heard", now: deps.now() });
            })
        );
        const timer = setInterval(() => {
            // Talking for a long time is one change of a flag, so it is counted again at each look at the clock
            if (speaking && state()?.phase === "on") deps.store.send({ type: "heard", now: deps.now() });
            deps.store.send({ type: "tick", now: deps.now(), quietMs: deps.quietMs ?? QUIET_STRETCH_MS });
        }, deps.tickMs ?? CALL_TICK_MS);
        cleanups.push(() => clearInterval(timer));
        evaluate();
    };

    const stop = (): void => {
        running = false;
        seeded = false;
        speaking = false;
        for (const clean of cleanups.splice(0)) clean();
    };

    const watch = deps.store.subscribe((call) => {
        const live = !!call && isLive(call.state);
        if (live && !running) begin();
        else if (!live && running) stop();
        // A card answered (or a call put back on) can leave someone else still to ask about
        else if (live) evaluate();
    });

    return {
        /** "Not now": this person is dealt with, and the call goes on untouched. */
        notNow(): void {
            const asked = state()?.walkUp;
            if (asked) tracker.answer(asked.id);
            deps.store.send({ type: "not-now" });
        },
        /** "Hold call and talk": hold first, then the person talks with whoever is here. */
        holdAndTalk(): void {
            tracker.answerAll(people);
            deps.store.send({ type: "hold-and-talk" });
        },
        /** Stops watching altogether (for a test). */
        destroy(): void {
            watch();
            stop();
        },
    };
}
