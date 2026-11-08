import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import type { LocalStreamStoreValue } from "../../Stores/MediaStore";
import {
    MAX_REOPENS,
    MICROPHONE_BACK_GRACE_MS,
    microphoneIsLost,
    REOPEN_WINDOW_MS,
    watchMicrophoneForRecovery,
} from "../MicrophoneRecovery";

class FakeTrack extends EventTarget {
    public readyState: "live" | "ended" = "live";
    public muted = false;
    public setMuted(muted: boolean) {
        this.muted = muted;
        this.dispatchEvent(new Event(muted ? "mute" : "unmute"));
    }
    public end() {
        this.readyState = "ended";
        this.dispatchEvent(new Event("ended"));
    }
}

class FakeDocument extends EventTarget {
    public visibilityState: "visible" | "hidden" = "visible";
    public setVisibility(state: "visible" | "hidden") {
        this.visibilityState = state;
        this.dispatchEvent(new Event("visibilitychange"));
    }
}

function streamOf(track: FakeTrack | undefined): LocalStreamStoreValue {
    return {
        type: "success",
        stream: { getAudioTracks: () => (track ? [track] : []) } as unknown as MediaStream,
    };
}

describe("microphoneIsLost", () => {
    it("is true for a muted or an ended track only", () => {
        expect(microphoneIsLost({ readyState: "live", muted: false })).toBe(false);
        expect(microphoneIsLost({ readyState: "live", muted: true })).toBe(true);
        expect(microphoneIsLost({ readyState: "ended", muted: false })).toBe(true);
    });
});

describe("watchMicrophoneForRecovery", () => {
    let track: FakeTrack;
    let doc: FakeDocument;
    let store: ReturnType<typeof writable<LocalStreamStoreValue>>;
    let reopen: ReturnType<typeof vi.fn>;
    let stop: () => void;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        track = new FakeTrack();
        doc = new FakeDocument();
        store = writable(streamOf(track));
        reopen = vi.fn();
        stop = watchMicrophoneForRecovery(store, {
            document: doc as unknown as Document,
            reopen: reopen as () => void,
        });
    });

    afterEach(() => {
        stop();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("does nothing when the phone hands the microphone back by itself", () => {
        doc.setVisibility("hidden");
        track.setMuted(true);
        vi.advanceTimersByTime(60_000);
        doc.setVisibility("visible");
        vi.advanceTimersByTime(500);
        track.setMuted(false);
        vi.advanceTimersByTime(10_000);
        expect(reopen).not.toHaveBeenCalled();
    });

    it("asks for the microphone again when it is still muted after coming back", () => {
        doc.setVisibility("hidden");
        track.setMuted(true);
        vi.advanceTimersByTime(60_000);
        expect(reopen).not.toHaveBeenCalled();
        doc.setVisibility("visible");
        vi.advanceTimersByTime(MICROPHONE_BACK_GRACE_MS - 1);
        expect(reopen).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(reopen).toHaveBeenCalledTimes(1);
    });

    it("asks for the microphone again when it ended in the background", () => {
        doc.setVisibility("hidden");
        track.end();
        vi.advanceTimersByTime(60_000);
        expect(reopen).not.toHaveBeenCalled();
        doc.setVisibility("visible");
        vi.advanceTimersByTime(MICROPHONE_BACK_GRACE_MS);
        expect(reopen).toHaveBeenCalledTimes(1);
    });

    it("waits for the page to be back when the microphone ends while it is hidden", () => {
        doc.setVisibility("hidden");
        track.end();
        vi.advanceTimersByTime(10_000);
        expect(reopen).not.toHaveBeenCalled();
    });

    it("leaves a mute alone while the page stays on screen", () => {
        track.setMuted(true);
        vi.advanceTimersByTime(60_000);
        expect(reopen).not.toHaveBeenCalled();
    });

    it("does nothing when the microphone is off", () => {
        store.set(streamOf(undefined));
        doc.setVisibility("hidden");
        doc.setVisibility("visible");
        vi.advanceTimersByTime(10_000);
        expect(reopen).not.toHaveBeenCalled();
    });

    it("watches the new track after the microphone was asked for again", () => {
        const next = new FakeTrack();
        store.set(streamOf(next));
        doc.setVisibility("hidden");
        track.setMuted(true);
        next.setMuted(true);
        doc.setVisibility("visible");
        vi.advanceTimersByTime(MICROPHONE_BACK_GRACE_MS);
        expect(reopen).toHaveBeenCalledTimes(1);
        // The old track is not watched any more.
        track.end();
        vi.advanceTimersByTime(10_000);
        expect(reopen).toHaveBeenCalledTimes(1);
    });

    it("gives up on a microphone that keeps going away, and tries again later", () => {
        track.setMuted(true);
        for (let i = 0; i < MAX_REOPENS + 2; i++) {
            doc.setVisibility("hidden");
            doc.setVisibility("visible");
            vi.advanceTimersByTime(MICROPHONE_BACK_GRACE_MS);
        }
        expect(reopen).toHaveBeenCalledTimes(MAX_REOPENS);

        vi.advanceTimersByTime(REOPEN_WINDOW_MS);
        doc.setVisibility("hidden");
        doc.setVisibility("visible");
        vi.advanceTimersByTime(MICROPHONE_BACK_GRACE_MS);
        expect(reopen).toHaveBeenCalledTimes(MAX_REOPENS + 1);
    });

    it("stops watching", () => {
        stop();
        doc.setVisibility("hidden");
        track.setMuted(true);
        doc.setVisibility("visible");
        vi.advanceTimersByTime(10_000);
        expect(reopen).not.toHaveBeenCalled();
    });
});
