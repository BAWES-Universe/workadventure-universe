import { get } from "svelte/store";
import type { Readable } from "svelte/store";
import { LL } from "../../i18n/i18n-svelte";
import type { LocalStreamStoreValue } from "../Stores/MediaStore";
import { requestedCameraState } from "../Stores/MediaStore";
import { warningMessageStore } from "../Stores/ErrorStore";

/**
 * Reacts to a camera that stops delivering frames while it is on.
 *
 * A frozen camera (taken by another application, a laptop waking up, a USB hiccup) stays "live", and Chrome does not
 * even mark the track muted: neither LiveKit nor the peers know. The people already watching keep the last frame,
 * everyone arriving gets "No video stream received", and the user sees a black preview.
 *
 * The camera track counts the frames it delivers (MediaStreamTrack.stats, Chromium). None for 3 seconds means the
 * source delivers nothing. We first ask for the camera again, what the user would do by turning it off and on. If the
 * new one never delivers a frame, or the camera keeps freezing, it is turned off, so that the others get the avatar
 * instead of a frozen picture, and the user is told why. Switching to another camera is left to the user: the other
 * one may be the camera of a closed laptop, or point elsewhere.
 *
 * The raw camera is watched, before any background effect, so a frozen camera is caught under an effect too.
 * Browsers without track stats (Firefox, Safari) never get here.
 */

export type CameraStallAction = "restart" | "give_up";

export interface CameraFrameSample {
    // The frame counter belongs to one track: a new track (the camera asked for again) starts from 0
    trackId: string;
    totalFrames: number;
}

// No frame for 3 seconds: back before a tile mounted meanwhile shows "No video stream received" (5 seconds).
export const STALL_SAMPLES = 3;
// A camera starting delivers nothing for a moment
export const WARMUP_SAMPLES = 3;
// Room for getUserMedia to hand over the new camera
export const RESTART_GRACE_SAMPLES = 5;
// A camera that keeps freezing is not coming back for good
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 10 * 60_000;
const SAMPLE_INTERVAL_MS = 1000;

export class CameraStallDetector {
    private stalledSamples = 0;
    private warmup = WARMUP_SAMPLES;
    private lastSample: CameraFrameSample | undefined;
    private restartTimes: number[] = [];
    // Whether the camera delivered a frame since the last restart: a new camera that never does is not worth another
    private deliveredSinceRestart = true;

    /**
     * Feeds one reading of the camera's frame counter, once a second (undefined: the camera is off). Returns the
     * action to take when it is time.
     */
    public sample(sample: CameraFrameSample | undefined, now: number = Date.now()): CameraStallAction | undefined {
        if (!sample) {
            // Camera off: start over
            this.stalledSamples = 0;
            this.warmup = WARMUP_SAMPLES;
            this.lastSample = undefined;
            this.deliveredSinceRestart = true;
            return undefined;
        }
        const previous = this.lastSample;
        this.lastSample = sample;
        if (!previous || previous.trackId !== sample.trackId) {
            // A new track (turned on, or asked for again): nothing to compare with yet, and it may take a moment
            this.stalledSamples = 0;
            this.warmup = Math.max(this.warmup, WARMUP_SAMPLES);
            return undefined;
        }
        const delivered = sample.totalFrames > previous.totalFrames;
        if (this.warmup > 0) {
            this.warmup--;
            if (delivered) {
                this.deliveredSinceRestart = true;
            }
            return undefined;
        }
        if (delivered) {
            this.stalledSamples = 0;
            this.deliveredSinceRestart = true;
            return undefined;
        }
        this.stalledSamples++;
        if (this.stalledSamples < STALL_SAMPLES) {
            return undefined;
        }
        this.stalledSamples = 0;
        this.restartTimes = this.restartTimes.filter((time) => now - time < RESTART_WINDOW_MS);
        if (!this.deliveredSinceRestart || this.restartTimes.length >= MAX_RESTARTS) {
            this.restartTimes = [];
            this.deliveredSinceRestart = true;
            this.warmup = WARMUP_SAMPLES;
            return "give_up";
        }
        this.restartTimes.push(now);
        this.deliveredSinceRestart = false;
        this.warmup = RESTART_GRACE_SAMPLES;
        return "restart";
    }
}

// MediaStreamTrack.stats is not in TypeScript's DOM types yet
type TrackWithStats = MediaStreamTrack & { stats?: { totalFrames?: number } };

function readCameraFrames(value: LocalStreamStoreValue): CameraFrameSample | undefined {
    if (value.type !== "success" || !value.stream) {
        return undefined;
    }
    const track = value.stream.getVideoTracks()[0] as TrackWithStats | undefined;
    // A disabled track delivers nothing on purpose
    if (!track || track.readyState !== "live" || !track.enabled) {
        return undefined;
    }
    const totalFrames = track.stats?.totalFrames;
    if (typeof totalFrames !== "number") {
        return undefined;
    }
    return { trackId: track.id, totalFrames };
}

/**
 * Watches the raw camera once a second while it is on. Returns a function that stops watching.
 */
export function watchCameraForStalls(rawLocalStreamStore: Readable<LocalStreamStoreValue>): () => void {
    const detector = new CameraStallDetector();
    let interval: ReturnType<typeof setInterval> | undefined;
    // Between turning the frozen camera off and getting the new one: not the user turning it off
    let restarting = false;

    const tick = () => {
        const action = detector.sample(readCameraFrames(get(rawLocalStreamStore)));
        if (action === "restart") {
            console.warn("The camera has delivered no frame for 3 seconds: asking for it again");
            // Off and on, like the user would: the frozen track is stopped and a new one is asked for
            restarting = true;
            requestedCameraState.disableWebcam();
            requestedCameraState.enableWebcam();
        } else if (action === "give_up") {
            console.warn("The camera still delivers no frame after a restart: turning it off");
            requestedCameraState.disableWebcam();
            warningMessageStore.addWarningMessage(get(LL).warning.cameraStalled(), { closable: true });
        }
    };

    const unsubscribe = rawLocalStreamStore.subscribe((value) => {
        const cameraOn = readCameraFrames(value) !== undefined;
        if (cameraOn) {
            restarting = false;
            interval ??= setInterval(tick, SAMPLE_INTERVAL_MS);
        } else if (interval) {
            clearInterval(interval);
            interval = undefined;
            if (!restarting) {
                // Turned off: a camera turned on again starts afresh
                detector.sample(undefined);
            }
        }
    });

    return () => {
        unsubscribe();
        if (interval) {
            clearInterval(interval);
        }
    };
}
