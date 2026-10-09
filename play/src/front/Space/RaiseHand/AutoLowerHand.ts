import type { Readable, Unsubscriber } from "svelte/store";
import { derived, writable } from "svelte/store";
import { localVoiceIndicatorStore, requestedMicrophoneState } from "../../Stores/MediaStore";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { lowerHand, myHandRaisedStore } from "./RaiseHandStore";

/** The "Keep it raised" offer, shown beside the hand button. */
export const keepHandOfferStore = writable<{ keep: () => void; durationMs: number } | undefined>(undefined);

/** Talking this long, in total, with the hand up counts as having had your turn. */
export const SPOKEN_MS = 2000;
/** How long "Keep it raised" stays on screen before the hand goes down. */
export const KEEP_IT_RAISED_MS = 6000;

let holders = 0;
let stop: Unsubscriber | undefined;

/**
 * Lowers our hand once we have spoken, like Teams and Meet, with a "Keep it raised" to undo.
 * Several conversations can hold it at once; it runs while at least one does.
 */
export function holdAutoLowerHand(): Unsubscriber {
    holders++;
    if (holders === 1) {
        stop = watchSpokenWhileHandRaised();
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders === 0) {
            stop?.();
            stop = undefined;
        }
    };
}

export function watchSpokenWhileHandRaised(
    handRaisedStore: Readable<boolean> = myHandRaisedStore,
    talkingStore: Readable<boolean> = derived(
        [localVoiceIndicatorStore, requestedMicrophoneState],
        ([talking, microphoneOn]) => talking && microphoneOn
    ),
    onSpoke: (keep: () => void) => void = showKeepItRaised,
    onDone: () => void = hideKeepItRaised
): Unsubscriber {
    let unsubscribeTalking: Unsubscriber | undefined;
    let spokenTimer: ReturnType<typeof setTimeout> | undefined;
    let lowerTimer: ReturnType<typeof setTimeout> | undefined;

    const reset = () => {
        unsubscribeTalking?.();
        unsubscribeTalking = undefined;
        clearTimeout(spokenTimer);
        clearTimeout(lowerTimer);
        spokenTimer = undefined;
        lowerTimer = undefined;
        onDone();
    };

    const unsubscribeRaised = handRaisedStore.subscribe((raised) => {
        reset();
        if (!raised) return;

        let spokenMs = 0;
        let talkingSince: number | undefined;
        let kept = false;

        const spoke = () => {
            unsubscribeTalking?.();
            unsubscribeTalking = undefined;
            if (kept) return;
            onSpoke(() => {
                kept = true;
                analyticsClient.keepHandRaised();
                clearTimeout(lowerTimer);
                lowerTimer = undefined;
                onDone();
            });
            lowerTimer = setTimeout(() => {
                lowerTimer = undefined;
                onDone();
                lowerHand();
                analyticsClient.lowerHand("spoke");
            }, KEEP_IT_RAISED_MS);
        };

        unsubscribeTalking = talkingStore.subscribe((talking) => {
            const now = Date.now();
            if (talking && talkingSince === undefined) {
                talkingSince = now;
                spokenTimer = setTimeout(spoke, Math.max(0, SPOKEN_MS - spokenMs));
            } else if (!talking && talkingSince !== undefined) {
                spokenMs += now - talkingSince;
                talkingSince = undefined;
                clearTimeout(spokenTimer);
                spokenTimer = undefined;
            }
        });
    });

    return () => {
        unsubscribeRaised();
        reset();
    };
}

function showKeepItRaised(keep: () => void): void {
    keepHandOfferStore.set({ keep, durationMs: KEEP_IT_RAISED_MS });
}

function hideKeepItRaised(): void {
    keepHandOfferStore.set(undefined);
}
