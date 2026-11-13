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

        const stop = showCameraToSpeakers(space, cameraOn, writable(true), told);
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

describe("what each space carries while a call with a Brick is live (#2004, check 64)", () => {
    const CALL = "call__abc";
    const bubble = (name = "a-bubble") => ({
        isStreamingStore: writable(true),
        showsCameraToStreamersStore: writable(false),
        getName: () => name,
    });
    const audioOf = (value: LocalStreamStoreValue | undefined) =>
        value?.type === "success" ? value.stream?.getAudioTracks() : undefined;
    const videoOf = (value: LocalStreamStoreValue | undefined) =>
        value?.type === "success" ? value.stream?.getVideoTracks() : undefined;

    it("carries everything, as before, while no call is live", () => {
        const localStream = local([camera, microphone]);
        expect(get(streamToSend(localStream, bubble(), writable(undefined)))).toBe(get(localStream));
        expect(get(streamToSend(localStream, bubble(CALL), writable(undefined)))).toBe(get(localStream));
    });

    it("gives the microphone to the call alone while it is on: the bubble keeps the camera, never the microphone", () => {
        const gate = writable<{ spaceName: string; owner: "bot" | "people" }>({ spaceName: CALL, owner: "bot" });
        const localStream = local([camera, microphone]);
        const inBubble = get(streamToSend(localStream, bubble(), gate));
        expect(audioOf(inBubble)).toEqual([]);
        expect(videoOf(inBubble)).toEqual([camera]);
        const inCall = get(streamToSend(localStream, bubble(CALL), gate));
        expect(audioOf(inCall)).toEqual([microphone]);
        // A call is audio only: the camera is never sent to it
        expect(videoOf(inCall)).toEqual([]);
    });

    it("gives the microphone back to the people, and takes it from the call, the moment it goes on hold", () => {
        const gate = writable<{ spaceName: string; owner: "bot" | "people" }>({ spaceName: CALL, owner: "people" });
        const localStream = local([camera, microphone]);
        const inBubble = get(streamToSend(localStream, bubble(), gate));
        expect(audioOf(inBubble)).toEqual([microphone]);
        expect(get(streamToSend(localStream, bubble(CALL), gate))).toBeUndefined();
    });

    it("never carries the microphone in both places, whoever holds it", () => {
        const localStream = local([microphone]);
        for (const owner of ["bot", "people"] as const) {
            const gate = writable({ spaceName: CALL, owner });
            const a = audioOf(get(streamToSend(localStream, bubble(), gate))) ?? [];
            const b = audioOf(get(streamToSend(localStream, bubble(CALL), gate))) ?? [];
            expect(a.length + b.length).toBe(1);
        }
    });

    it("keeps the same stream while the tracks do not change", () => {
        const gate = writable<{ spaceName: string; owner: "bot" | "people" }>({ spaceName: CALL, owner: "bot" });
        const sent = streamToSend(local([camera, microphone]), bubble(), gate);
        const seen: unknown[] = [];
        const stop = sent.subscribe((value) => seen.push(value?.type === "success" ? value.stream : undefined));
        gate.set({ spaceName: CALL, owner: "bot" });
        stop();
        expect(seen[0]).toBeDefined();
        expect(seen.every((stream) => stream === seen[0])).toBe(true);
    });
});
