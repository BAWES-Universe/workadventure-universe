import type { Readable } from "svelte/store";
import { derived, writable } from "svelte/store";

/**
 * Who has the person's microphone while they are on a call with a Brick (game #2004, check 64). The microphone goes to
 * the call or to the people around, never to both:
 *   "bot":    the call is on. Only the call's space carries the microphone; every other space, a nearby bubble included,
 *             carries nothing of it.
 *   "people": the call is on hold, or over. The call's space carries nothing; the others carry it as they always did.
 * While no call is live there is no gate, and every space behaves exactly as shipped.
 *
 * The call's space is audio only: the person's camera is never sent to a call, whoever holds the microphone.
 */
export interface CallMicGate {
    spaceName: string;
    owner: "bot" | "people";
}

const gate = writable<CallMicGate | undefined>(undefined);

export const callMicGate: Readable<CallMicGate | undefined> = { subscribe: gate.subscribe };

export function setCallMicGate(value: CallMicGate | undefined): void {
    gate.set(value);
}

/** Whether this space may carry the person's microphone right now. */
export function microphoneAllowedIn(spaceName: string, value: CallMicGate | undefined): boolean {
    if (!value) return true;
    return spaceName === value.spaceName ? value.owner === "bot" : value.owner === "people";
}

/** Whether this space may carry the person's camera right now: never a call's. */
export function cameraAllowedIn(spaceName: string, value: CallMicGate | undefined): boolean {
    return !value || spaceName !== value.spaceName;
}

/** The microphone state shown to a space's other members: off whenever the gate keeps the microphone out of it. */
export function gatedMicrophoneState(
    spaceName: string,
    requested: Readable<boolean>,
    from: Readable<CallMicGate | undefined> = callMicGate
): Readable<boolean> {
    return derived([requested, from], ([$requested, $gate]) => $requested && microphoneAllowedIn(spaceName, $gate));
}
