import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { SpaceInterface } from "../SpaceInterface";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

describe("showing our camera to a Stage's speakers (#1623)", () => {
    async function load() {
        const { showCameraToSpeakers, stopShowingCameraToSpeakers } = await import("../AttendeeCamera");
        const { stageSeesOurCameraStore } = await import("../../Stores/MediaStore");
        return { showCameraToSpeakers, stopShowingCameraToSpeakers, stageSeesOurCameraStore };
    }

    function fakeSpace() {
        const showCameraToStreamers = vi.fn();
        return { space: { showCameraToStreamers } as unknown as SpaceInterface, showCameraToStreamers };
    }

    it("stops when the scene closes without leaving the Audience", async () => {
        const { showCameraToSpeakers, stopShowingCameraToSpeakers, stageSeesOurCameraStore } = await load();
        const { space, showCameraToStreamers } = fakeSpace();
        const cameraOn = writable(true);
        const stop = showCameraToSpeakers(space, cameraOn, writable(true), vi.fn());
        expect(showCameraToStreamers).toHaveBeenLastCalledWith(true);
        expect(get(stageSeesOurCameraStore)).toBe(true);

        stopShowingCameraToSpeakers();
        expect(showCameraToStreamers).toHaveBeenLastCalledWith(false);
        expect(get(stageSeesOurCameraStore)).toBe(false);

        // Turning the camera on again later shows it to nobody, and leaving the Audience afterwards changes nothing
        showCameraToStreamers.mockClear();
        cameraOn.set(false);
        cameraOn.set(true);
        stop();
        expect(showCameraToStreamers).not.toHaveBeenCalled();
    });

    it("stops showing it in the Audience we left when we start showing it in the next one", async () => {
        const { showCameraToSpeakers, stopShowingCameraToSpeakers, stageSeesOurCameraStore } = await load();
        const first = fakeSpace();
        const second = fakeSpace();
        const cameraOn = writable(true);
        const stopFirst = showCameraToSpeakers(first.space, cameraOn, writable(true), vi.fn());
        showCameraToSpeakers(second.space, cameraOn, writable(true), vi.fn());
        expect(first.showCameraToStreamers).toHaveBeenLastCalledWith(false);
        expect(get(stageSeesOurCameraStore)).toBe(true);

        // Leaving the first one late does not hide our camera from the second
        stopFirst();
        expect(get(stageSeesOurCameraStore)).toBe(true);
        second.showCameraToStreamers.mockClear();
        stopShowingCameraToSpeakers();
        expect(second.showCameraToStreamers).toHaveBeenCalledWith(false);
        expect(get(stageSeesOurCameraStore)).toBe(false);
    });

    it("follows the Stage turning the setting off and on again while we stay in the Audience", async () => {
        const { showCameraToSpeakers, stageSeesOurCameraStore, attendeeCameraAreaSpacesStore, stageSeesCamerasStore } =
            await loadWithSpaces();
        const shows: boolean[] = [];
        const space = { showCameraToStreamers: (show: boolean) => shows.push(show) } as unknown as SpaceInterface;
        const told = vi.fn();
        attendeeCameraAreaSpacesStore.set(new Set(["stage"]));

        const stop = showCameraToSpeakers(space, writable(true), stageSeesCamerasStore("stage"), told);
        expect(shows).toEqual([true]);
        expect(told).toHaveBeenCalledTimes(1);

        // The Stage turns it off: our camera stops being shown, and may go to sleep again
        attendeeCameraAreaSpacesStore.set(new Set(["another-stage"]));
        expect(shows).toEqual([true, false]);
        expect(get(stageSeesOurCameraStore)).toBe(false);

        // The Stage turns it back on: our camera, still on, is shown again and we are told
        attendeeCameraAreaSpacesStore.set(new Set(["stage", "another-stage"]));
        expect(shows).toEqual([true, false, true]);
        expect(get(stageSeesOurCameraStore)).toBe(true);
        expect(told).toHaveBeenCalledTimes(2);

        stop();
        expect(shows).toEqual([true, false, true, false]);
    });

    it("does not show it on a Stage that does not see the audience's cameras", async () => {
        const { showCameraToSpeakers, stageSeesOurCameraStore, attendeeCameraAreaSpacesStore, stageSeesCamerasStore } =
            await loadWithSpaces();
        const showCameraToStreamers = vi.fn();
        const told = vi.fn();
        attendeeCameraAreaSpacesStore.set(new Set());

        const stop = showCameraToSpeakers(
            { showCameraToStreamers } as unknown as SpaceInterface,
            writable(true),
            stageSeesCamerasStore("stage"),
            told
        );

        expect(showCameraToStreamers).not.toHaveBeenCalledWith(true);
        expect(get(stageSeesOurCameraStore)).toBe(false);
        expect(told).not.toHaveBeenCalled();
        stop();
    });

    async function loadWithSpaces() {
        const module = await import("../AttendeeCamera");
        const { stageSeesOurCameraStore } = await import("../../Stores/MediaStore");
        return {
            showCameraToSpeakers: module.showCameraToSpeakers,
            attendeeCameraAreaSpacesStore: module.attendeeCameraAreaSpacesStore,
            stageSeesCamerasStore: module.stageSeesCamerasStore,
            stageSeesOurCameraStore,
        };
    }
});
