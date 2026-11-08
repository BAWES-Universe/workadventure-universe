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

export interface MicrophoneRecoveryEnv {
    document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
    /** Asks the browser for the microphone again. */
    reopen: () => void;
    now?: () => number;
}

/** Whether a microphone track is not delivering: muted by the system, or ended while the player wants it. */
export function microphoneIsLost(track: Pick<MediaStreamTrack, "readyState" | "muted">): boolean {
    return track.readyState === "ended" || track.muted;
}

/**
 * Watches the raw microphone track. Returns a function that stops watching.
 */
export function watchMicrophoneForRecovery(
    rawLocalStreamStore: Readable<LocalStreamStoreValue>,
    env: MicrophoneRecoveryEnv,
): () => void {
    const now = env.now ?? (() => Date.now());
    let track: MediaStreamTrack | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reopens: number[] = [];

    const cancel = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
    };

    const check = () => {
        timer = undefined;
        // A page in the background cannot get the microphone: it is asked for on return.
        if (env.document.visibilityState !== "visible" || track === undefined || !microphoneIsLost(track)) return;
        const time = now();
        reopens = reopens.filter((at) => time - at < REOPEN_WINDOW_MS);
        if (reopens.length >= MAX_REOPENS) return;
        reopens.push(time);
        console.warn("The microphone is muted or ended while the page is on screen: asking for it again");
        env.reopen();
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

    const unsubscribe = rawLocalStreamStore.subscribe((value) => {
        watch(value.type === "success" ? value.stream?.getAudioTracks()[0] : undefined);
    });

    // Back on screen: the check runs, whether or not the track said anything while the page was away.
    const onVisibilityChange = () => {
        if (env.document.visibilityState === "visible") {
            scheduleCheck();
        } else {
            cancel();
        }
    };
    env.document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
        unsubscribe();
        env.document.removeEventListener("visibilitychange", onVisibilityChange);
        watch(undefined);
    };
}
