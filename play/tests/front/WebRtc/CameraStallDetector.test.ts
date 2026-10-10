import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalStreamStoreValue } from "../../../src/front/Stores/MediaStore";

const { requestedCameraState, warnings } = vi.hoisted(() => ({
    requestedCameraState: { enableWebcam: vi.fn(), disableWebcam: vi.fn() },
    warnings: [] as string[],
}));

vi.mock("../../../src/front/Stores/MediaStore", () => ({ requestedCameraState }));
vi.mock("../../../src/front/Stores/ErrorStore", () => ({
    warningMessageStore: { addWarningMessage: (message: string) => warnings.push(message) },
}));
vi.mock("../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { LL: readable({ warning: { cameraStalled: () => "Your camera stopped sending images" } }) };
});

import { CameraStallDetector, MAX_RESTARTS, watchCameraForStalls } from "../../../src/front/WebRtc/CameraStallDetector";

/** A camera track whose frame counter (MediaStreamTrack.stats, Chromium) the test moves by hand. */
function fakeCameraTrack(id = "camera-1") {
    const track = {
        id,
        kind: "video",
        enabled: true,
        readyState: "live",
        stats: { totalFrames: 0 },
    };
    return track;
}

function streamWith(track: ReturnType<typeof fakeCameraTrack> | undefined): LocalStreamStoreValue {
    return {
        type: "success",
        stream: {
            getVideoTracks: () => (track ? [track] : []),
        } as unknown as MediaStream,
    };
}

describe("CameraStallDetector", () => {
    it("asks for the camera again after 3 seconds without a frame", () => {
        const detector = new CameraStallDetector();
        let frames = 0;
        let now = 0;
        const tick = (delivered: number) => {
            frames += delivered;
            now += 1000;
            return detector.sample({ trackId: "camera-1", totalFrames: frames }, now);
        };

        // Starting: nothing is expected yet
        expect([tick(0), tick(0), tick(0)]).toEqual([undefined, undefined, undefined]);
        expect(tick(30)).toBeUndefined();
        expect(tick(0)).toBeUndefined();
        expect(tick(0)).toBeUndefined();
        expect(tick(0)).toBe("restart");
    });

    it("turns the camera off when the camera asked for again never delivers a frame", () => {
        const detector = new CameraStallDetector();
        let now = 0;
        const tick = (trackId: string, totalFrames: number) => {
            now += 1000;
            return detector.sample({ trackId, totalFrames }, now);
        };
        for (let i = 0; i < 5; i++) tick("camera-1", 30 * i);
        expect([tick("camera-1", 120), tick("camera-1", 120), tick("camera-1", 120)]).toContain("restart");

        // The new camera track never delivers anything
        const actions = Array.from({ length: 12 }, () => tick("camera-2", 0));
        expect(actions).toContain("give_up");
        expect(actions).not.toContain("restart");
    });

    it(`turns off a camera that keeps freezing (${MAX_RESTARTS} restarts in 10 minutes)`, () => {
        const detector = new CameraStallDetector();
        let now = 0;
        let frames = 0;
        const actions: (string | undefined)[] = [];
        for (let cycle = 0; cycle < MAX_RESTARTS + 1; cycle++) {
            // Delivers for a while, then freezes
            for (let i = 0; i < 10; i++) {
                now += 1000;
                frames += 30;
                actions.push(detector.sample({ trackId: `camera-${cycle}`, totalFrames: frames }, now));
            }
            for (let i = 0; i < 3; i++) {
                now += 1000;
                actions.push(detector.sample({ trackId: `camera-${cycle}`, totalFrames: frames }, now));
            }
            frames = 0;
        }
        expect(actions.filter((action) => action === "restart")).toHaveLength(MAX_RESTARTS);
        expect(actions[actions.length - 1]).toBe("give_up");
    });

    it("never acts on a camera that is off", () => {
        const detector = new CameraStallDetector();
        for (let now = 1000; now < 60_000; now += 1000) {
            expect(detector.sample(undefined, now)).toBeUndefined();
        }
    });
});

describe("watchCameraForStalls", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        warnings.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("asks for a frozen camera again, then turns it off and says why if it stays frozen", () => {
        const camera = fakeCameraTrack("camera-1");
        const rawLocalStreamStore = writable(streamWith(camera));
        const stop = watchCameraForStalls(rawLocalStreamStore);

        // Delivers, then freezes (another application took it, the laptop woke up...)
        for (let i = 0; i < 5; i++) {
            camera.stats.totalFrames += 30;
            vi.advanceTimersByTime(1000);
        }
        vi.advanceTimersByTime(3000);
        // Asked for again, the way the user would: off and on
        expect(requestedCameraState.disableWebcam).toHaveBeenCalledOnce();
        expect(requestedCameraState.enableWebcam).toHaveBeenCalledOnce();
        expect(warnings).toHaveLength(0);

        // The new track never delivers a frame either
        rawLocalStreamStore.set(streamWith(fakeCameraTrack("camera-2")));
        vi.advanceTimersByTime(12_000);

        expect(requestedCameraState.disableWebcam).toHaveBeenCalledTimes(2);
        expect(requestedCameraState.enableWebcam).toHaveBeenCalledOnce();
        expect(warnings).toEqual(["Your camera stopped sending images"]);
        stop();
    });

    it("leaves a camera that delivers alone", () => {
        const camera = fakeCameraTrack();
        const stop = watchCameraForStalls(writable(streamWith(camera)));

        for (let i = 0; i < 60; i++) {
            camera.stats.totalFrames += 30;
            vi.advanceTimersByTime(1000);
        }

        expect(requestedCameraState.disableWebcam).not.toHaveBeenCalled();
        stop();
    });

    it("does nothing where the browser does not count the camera frames", () => {
        const camera = fakeCameraTrack() as Partial<ReturnType<typeof fakeCameraTrack>>;
        delete camera.stats;
        const stop = watchCameraForStalls(writable(streamWith(camera as ReturnType<typeof fakeCameraTrack>)));

        vi.advanceTimersByTime(60_000);

        expect(requestedCameraState.disableWebcam).not.toHaveBeenCalled();
        stop();
    });

    it("does nothing while the camera is off", () => {
        const stop = watchCameraForStalls(writable(streamWith(undefined)));

        vi.advanceTimersByTime(60_000);

        expect(requestedCameraState.disableWebcam).not.toHaveBeenCalled();
        stop();
    });
});
