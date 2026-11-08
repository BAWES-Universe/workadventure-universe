import type { Readable } from "svelte/store";
import type { LocalStreamStoreValue } from "../Stores/MediaStore";

/**
 * Gets the microphone back after the phone took it away.
 *
 * On an iPhone, the installed app (and any app that is not Safari itself) has its microphone capture muted by iOS as
 * soon as the player switches to another app. The game keeps running and the other people keep being heard, but
 * nothing goes out until the player comes back. Nothing in a web page can change that.
 *
 * What a page can do is not stay stuck afterwards. When iOS does not hand the microphone back by itself (the track
 * stays muted, or ends, which Safari does after the app has been away for a while), the player came back to a
 * microphone that looked on and carried nothing, until they turned it off and on. Here, once the page is on screen
 * again and the microphone is still muted or ended after a short wait, it is asked for again, as the player would
 * by turning it off and on.
 */

/** iOS usually hands the microphone back within a second of the app coming back: wait before asking again. */
export const MICROPHONE_BACK_GRACE_MS = 1500;
/** A microphone that keeps going away is not coming back by asking again and again. */
export const MAX_REOPENS = 3;
export const REOPEN_WINDOW_MS = 60_000;
/** The phone can refuse the microphone for a moment right after the app comes back: asked again after this wait. */
export const REOPEN_RETRY_MS = 3000;

/** The player (or the system settings) said no: asking again would only ask the player again. */
const PERMANENT_REFUSALS = ["NotAllowedError", "SecurityError"];

export function isPermanentMicrophoneRefusal(error: Pick<Error, "name">): boolean {
    return PERMANENT_REFUSALS.includes(error.name);
}

export interface MicrophoneRecoveryEnv {
    document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
    /** Asks the browser for the microphone again. */
    reopen: () => void;
    /**
     * Counts the times the phone refused a microphone asked for again (not the player or the settings: those come
     * as an error of the stream). Such a refusal does not touch the stream, so the camera keeps going.
     */
    reopenFailures?: Readable<number>;
    now?: () => number;
}

/** Whether a microphone track is not delivering: muted by the system, or ended while the player wants it. */
export function microphoneIsLost(track: Pick<MediaStreamTrack, "readyState" | "muted">): boolean {
    return track.readyState === "ended" || track.muted;
}

/**
 * Whether a request to open the microphone again (a new number) is carried out. The wanted constraints are the ones
 * that already took the player's mute, privacy, the phone's rest, the availability status and the rest into account:
 * when they say the microphone must be closed (false), nothing is opened.
 */
export function mustReopenMicrophone(
    wantedAudio: false | MediaTrackConstraints,
    seenRequest: number,
    request: number
): boolean {
    return request !== seenRequest && wantedAudio !== false;
}

/**
 * Watches the raw microphone track. Returns a function that stops watching.
 */
export function watchMicrophoneForRecovery(
    rawLocalStreamStore: Readable<LocalStreamStoreValue>,
    env: MicrophoneRecoveryEnv
): () => void {
    const now = env.now ?? (() => Date.now());
    let track: MediaStreamTrack | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reopens: number[] = [];
    // We asked for the microphone again and the answer has not come yet.
    let reopenPending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const cancelRetry = () => {
        if (retryTimer === undefined) return;
        clearTimeout(retryTimer);
        retryTimer = undefined;
    };

    const reopenNow = () => {
        const time = now();
        reopens = reopens.filter((at) => time - at < REOPEN_WINDOW_MS);
        if (reopens.length >= MAX_REOPENS) {
            reopenPending = false;
            return;
        }
        reopens.push(time);
        reopenPending = true;
        console.warn("The microphone is muted or ended while the page is on screen: asking for it again");
        env.reopen();
    };

    const cancel = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
    };

    const check = () => {
        timer = undefined;
        // A page in the background cannot get the microphone: it is asked for on return.
        if (env.document.visibilityState !== "visible" || track === undefined || !microphoneIsLost(track)) return;
        reopenNow();
    };

    // A mute while the page is on screen (a phone call, a hardware switch) is left alone: asking again would not help.
    // A track that ended, or one still muted when the page comes back, is asked for again.
    // Waits a moment before asking again, so that the phone has the time to hand the microphone back by itself.
    const scheduleCheck = () => {
        cancel();
        if (track === undefined || env.document.visibilityState !== "visible") return;
        if (!microphoneIsLost(track)) return;
        timer = setTimeout(check, MICROPHONE_BACK_GRACE_MS);
    };

    const onTrackChange = () => scheduleCheck();
    const onUnmute = () => cancel();

    const watch = (next: MediaStreamTrack | undefined) => {
        if (next === track) return;
        if (track) {
            track.removeEventListener("unmute", onUnmute);
            track.removeEventListener("ended", onTrackChange);
        }
        cancel();
        track = next;
        if (track) {
            track.addEventListener("unmute", onUnmute);
            track.addEventListener("ended", onTrackChange);
        }
    };

    // The phone refused the microphone we asked for again: it may only be too soon after the app came back.
    const retryLater = () => {
        if (!reopenPending || env.document.visibilityState !== "visible") return;
        cancelRetry();
        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (env.document.visibilityState === "visible" && reopenPending) reopenNow();
        }, REOPEN_RETRY_MS);
    };

    const unsubscribe = rawLocalStreamStore.subscribe((value) => {
        const audioTrack = value.type === "success" ? value.stream?.getAudioTracks()[0] : undefined;
        watch(audioTrack);
        if (audioTrack) {
            reopenPending = false;
            cancelRetry();
        } else if (value.type === "error" && !isPermanentMicrophoneRefusal(value.error)) {
            retryLater();
        }
    });

    let seenFailures: number | undefined;
    const unsubscribeFailures = env.reopenFailures?.subscribe((failures) => {
        const first = seenFailures === undefined;
        seenFailures = failures;
        if (!first) retryLater();
    });

    // Back on screen: the check runs, whether or not the track said anything while the page was away.
    const onVisibilityChange = () => {
        if (env.document.visibilityState === "visible") {
            scheduleCheck();
        } else {
            cancel();
            cancelRetry();
        }
    };
    env.document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
        unsubscribe();
        unsubscribeFailures?.();
        cancelRetry();
        env.document.removeEventListener("visibilitychange", onVisibilityChange);
        watch(undefined);
    };
}
