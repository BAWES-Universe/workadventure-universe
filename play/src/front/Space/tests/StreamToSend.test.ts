import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { LocalStreamStoreValue } from "../../Stores/MediaStore";
import { streamToSend } from "../StreamToSend";
import { cameraOnStore, showCameraToSpeakers } from "../AttendeeCamera";
import type { SpaceInterface } from "../SpaceInterface";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

class FakeStream {
    constructor(private readonly tracks: { kind: string; readyState: string }[]) {}
    getVideoTracks() {
        return this.tracks.filter((track) => track.kind === "video");
    }
    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === "audio");
    }
}
vi.stubGlobal("MediaStream", FakeStream);

const camera = { kind: "video", readyState: "live" };
const microphone = { kind: "audio", readyState: "live" };
const local = (tracks: { kind: string; readyState: string }[]) =>
    writable<LocalStreamStoreValue>({ type: "success", stream: new FakeStream(tracks) as unknown as MediaStream });

describe("what we send in a Stage's space (#1623)", () => {
    it("sends everything while we stream", () => {
        const localStream = local([camera, microphone]);
        const sent = get(
            streamToSend(localStream, {
                isStreamingStore: writable(true),
                showsCameraToStreamersStore: writable(false),
            })
        );
        expect(sent).toBe(get(localStream));
    });

    it("sends our camera alone, never our microphone, while we show it to the speakers", () => {
        const sent = get(
            streamToSend(local([camera, microphone]), {
                isStreamingStore: writable(false),
                showsCameraToStreamersStore: writable(true),
            })
        );
        expect(sent?.type === "success" && sent.stream?.getVideoTracks()).toEqual([camera]);
        expect(sent?.type === "success" && sent.stream?.getAudioTracks()).toEqual([]);
    });

    it("sends nothing while we only listen, or show a camera that is off", () => {
        const listening = streamToSend(local([camera, microphone]), {
            isStreamingStore: writable(false),
            showsCameraToStreamersStore: writable(false),
        });
        expect(get(listening)).toBeUndefined();

        const cameraOff = streamToSend(local([microphone]), {
            isStreamingStore: writable(false),
            showsCameraToStreamersStore: writable(true),
        });
        expect(get(cameraOff)).toBeUndefined();
    });
});

describe("showing our camera to the speakers (#1623)", () => {
    it("shows it while it is on, tells us each time it starts being shown, and stops when we leave", () => {
        const shows: boolean[] = [];
        const space = { showCameraToStreamers: (show: boolean) => shows.push(show) } as unknown as SpaceInterface;
        const cameraOn = writable(true);
        const told = vi.fn();

        const stop = showCameraToSpeakers(space, cameraOn, told);
        cameraOn.set(false);
        cameraOn.set(true);
        stop();

        expect(shows).toEqual([true, false, true, false]);
        expect(told).toHaveBeenCalledTimes(2);
    });

    it("counts the camera as on only with a live camera track", () => {
        expect(get(cameraOnStore(local([camera])))).toBe(true);
        expect(get(cameraOnStore(local([{ kind: "video", readyState: "ended" }])))).toBe(false);
        expect(get(cameraOnStore(local([microphone])))).toBe(false);
    });
});
