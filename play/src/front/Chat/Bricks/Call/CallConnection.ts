import { get, type Readable } from "svelte/store";
import type { Observable } from "rxjs";
import type { CallFailure, CallResult } from "../../../external-modules/bots/services/callFailure";
import type { CallMicGate } from "../../../Space/CallMicGate";
import { micOwner, isLive } from "./CallSession";
import type { botCallStore } from "./CallStore";

/**
 * How one call is carried (game #2004): the bot server makes the bot join the call's private space, this browser joins
 * the same space, and the two talk in it like any two people in a bubble (the same peer-to-peer path). This file only
 * decides when things happen, so every piece it needs comes in and a test runs it without a game:
 *   - the call is "connected" when the bot is in the space, and ends by the bot when it leaves;
 *   - whoever holds the microphone follows the call's phase, and never two places (CallMicGate);
 *   - however the call ends (the person, a quiet stretch, the bot, a lost space), the space is left, the bot is told
 *     and the microphone goes back to the people, once.
 */
export interface CallSpaceLike {
    getName(): string;
    readonly usersStore: Readable<ReadonlyMap<string, unknown>>;
    readonly observeUserLeft: Observable<unknown>;
    readonly observeUserJoined: Observable<unknown>;
    readonly onLeaveSpace: Observable<void>;
    /** This person's own id in the space: the space lists them too, and they are not the bot. */
    readonly mySpaceUserId?: string;
}

export interface CallDeps {
    store: Pick<typeof botCallStore, "subscribe" | "start" | "send" | "clear">;
    /** The bot server's answer, for this person. */
    startCall(botId: string): Promise<CallResult>;
    /** Tells the bot server the call is over. Never throws. */
    endCall(botId: string): Promise<unknown>;
    joinSpace(spaceName: string, signal: AbortSignal): Promise<CallSpaceLike>;
    leaveSpace(space: CallSpaceLike): Promise<void>;
    setGate(gate: CallMicGate | undefined): void;
    /**
     * The person's microphone setting. A call needs it on to be heard: tapping Call turns it on if it was off, and the
     * call turns it off again when it ends, only if the call was the one that turned it on.
     */
    microphone?: { isOn(): boolean; turnOn(): void; turnOff(): void };
    now(): number;
    /** How long the bot has to come into the space before the call is given up on. */
    connectTimeoutMs?: number;
}

export type BeginResult =
    | { ok: true }
    | { ok: false; failure: "already_on_a_call" }
    /** The person hung up while it was still starting: nothing failed, so nothing is said. */
    | { ok: false; failure: "cancelled" }
    | { ok: false; failure: CallFailure; reason?: string };

export const CALL_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Runs a step that must never stop the ones after it, even when it throws at once (the game scene can be gone while a
 * call is being cleaned up, and then asking it for anything throws before a promise exists).
 */
function quietly(step: () => unknown): void {
    try {
        const result = step();
        if (result instanceof Promise) result.catch(() => undefined);
    } catch {
        // Cleanup carries on
    }
}

/**
 * Until the call's own space is joined the gate names a space nothing else has, so the microphone goes nowhere: tapping
 * Call must never let the person's voice reach a nearby bubble while the call is still being set up.
 */
export const PENDING_CALL_SPACE = "call__pending";

export function createCallConnection(deps: CallDeps) {
    let active: { botId: string; stop: () => void } | undefined;

    async function begin(botId: string, botName: string): Promise<BeginResult> {
        if (active || !deps.store.start(botId, botName)) return { ok: false, failure: "already_on_a_call" };

        const abort = new AbortController();
        const cleanups: Array<() => void> = [];
        let space: CallSpaceLike | undefined;
        let finished = false;
        let connected = false;
        let turnedMicrophoneOn = false;

        // However the call ends, once: leave the space, tell the bot server, give the microphone back
        const finish = (by: "you" | "bot" | "quiet" | "unavailable", silently = false): void => {
            if (finished) return;
            finished = true;
            // First of all, so that whatever fails below, the person can call again
            if (active?.botId === botId) active = undefined;
            abort.abort();
            // The state is ended first (so the one true line is shown), then the rest follows. A call that never
            // started has no line of its own: the failure is shown as the warning, and the person can try again at once.
            deps.store.send({ type: "end", by });
            if (silently) deps.store.clear();
            for (const stop of cleanups.splice(0)) quietly(stop);
            // The call's microphone goes off first, and only then does the gate open: no space is ever handed it on hang-up.
            // The stores that carry the microphone settle after this step when it runs inside a store's own update, so
            // when this call turned the microphone on, the gate opens one turn later, once they have; until then it keeps
            // the call's own space (and nothing else) carrying the microphone. A call started in between has its own gate.
            quietly(() => {
                if (turnedMicrophoneOn && deps.microphone?.isOn()) deps.microphone.turnOff();
            });
            if (turnedMicrophoneOn) {
                void Promise.resolve().then(() => {
                    if (!active) quietly(() => deps.setGate(undefined));
                });
            } else {
                quietly(() => deps.setGate(undefined));
            }
            const left = space;
            space = undefined;
            if (left) quietly(() => deps.leaveSpace(left));
            quietly(() => deps.endCall(botId));
        };
        active = { botId, stop: () => finish("you") };
        // Before anything else: no space carries the microphone until the call's own space is joined
        deps.setGate({ spaceName: PENDING_CALL_SPACE, owner: "bot" });
        // Tapping Call is the person's own action: turn the microphone on if it was off
        if (deps.microphone && !deps.microphone.isOn()) {
            deps.microphone.turnOn();
            turnedMicrophoneOn = true;
        }

        // The microphone follows the call's phase; any end of the call (the person pressing End, a quiet stretch) ends
        // everything through the same path
        const watch = deps.store.subscribe((call) => {
            if (finished) return;
            if (!call || call.botId !== botId || !isLive(call.state)) {
                finish(call?.state.endedBy ?? "you");
                return;
            }
            if (space) {
                // Only a call on hold gives the microphone back to the people: while it is still connecting it stays with the call
                deps.setGate({
                    spaceName: space.getName(),
                    owner: micOwner(call.state) === "people" ? "people" : "bot",
                });
            }
        });
        cleanups.push(watch);
        // One deadline for the whole connecting: asking the bot server, joining the space and the bot arriving. A bot
        // server or a join that never answers ends the call as unavailable instead of leaving it connecting for ever.
        const timer = setTimeout(() => {
            if (!connected) finish("unavailable");
        }, deps.connectTimeoutMs ?? CALL_CONNECT_TIMEOUT_MS);
        cleanups.push(() => clearTimeout(timer));

        const started = await deps.startCall(botId);
        if (finished) {
            // Ended while it was starting: the bot server must not keep a call nobody holds
            if (started.started) quietly(() => deps.endCall(botId));
            return { ok: false, failure: "cancelled" };
        }
        if (!started.started) {
            finish("unavailable", true);
            return { ok: false, failure: started.failure, reason: started.reason };
        }

        try {
            space = await deps.joinSpace(started.spaceName, abort.signal);
        } catch {
            // Hanging up while the space was being joined stops the join: that is no failure, so nothing is said
            const hungUp = finished;
            finish("unavailable", true);
            return { ok: false, failure: hungUp ? "cancelled" : "failed" };
        }
        if (finished) {
            const joinedAfterEnd = space;
            quietly(() => deps.leaveSpace(joinedAfterEnd));
            return { ok: false, failure: "cancelled" };
        }
        // Nothing but the call's own space carries the microphone from here on, connecting included
        deps.setGate({ spaceName: space.getName(), owner: "bot" });

        const live = space;
        const botIn = (): void => {
            if (connected || finished) return;
            connected = true;
            deps.store.send({ type: "connected", now: deps.now() });
        };
        // The space holds two members: this person and the bot
        const isMe = (user: unknown): boolean =>
            live.mySpaceUserId !== undefined &&
            (user as { spaceUserId?: string } | undefined)?.spaceUserId === live.mySpaceUserId;
        const joined = live.observeUserJoined.subscribe((user) => {
            if (!isMe(user)) botIn();
        });
        cleanups.push(() => joined.unsubscribe());
        const left = live.observeUserLeft.subscribe((user) => {
            if (connected && !isMe(user)) finish("bot");
        });
        cleanups.push(() => left.unsubscribe());
        const lost = live.onLeaveSpace.subscribe(() => finish("unavailable"));
        cleanups.push(() => lost.unsubscribe());
        // The space lists this person too: the bot is anyone else in it
        if ([...get(live.usersStore).keys()].some((id) => id !== live.mySpaceUserId)) botIn();

        return { ok: true };
    }

    return {
        begin,
        /** The person hangs up (the same path as every other end). */
        end(): void {
            active?.stop();
        },
        isActive: (): boolean => active !== undefined,
    };
}
