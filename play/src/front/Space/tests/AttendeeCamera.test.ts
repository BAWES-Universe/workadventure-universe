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
        const stop = showCameraToSpeakers(space, cameraOn, vi.fn());
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
        const stopFirst = showCameraToSpeakers(first.space, cameraOn, vi.fn());
        showCameraToSpeakers(second.space, cameraOn, vi.fn());
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
});
