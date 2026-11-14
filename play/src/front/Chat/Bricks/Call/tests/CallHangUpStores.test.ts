import { beforeEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { derived, get, writable } from "svelte/store";
import { createCallStore } from "../CallStore";
import { createCallConnection, type CallSpaceLike } from "../CallConnection";
import { setCallMicGate } from "../../../../Space/CallMicGate";
import { streamToSend } from "../../../../Space/StreamToSend";
import type { LocalStreamStoreValue } from "../../../../Stores/MediaStore";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
});

class FakeStream {
    constructor(private readonly tracks: { kind: string }[]) {}
    getVideoTracks() {
        return this.tracks.filter((track) => track.kind === "video");
    }
    getAudioTracks() {
        return this.tracks.filter((track) => track.kind === "audio");
    }
}
vi.stubGlobal("MediaStream", FakeStream);

const SPACE = "call__abc";
const microphoneTrack = { kind: "audio" };

describe("hanging up with the stores that carry the microphone (game #2004)", () => {
    beforeEach(() => {
        setCallMicGate(undefined);
    });

    it("never hands the call's microphone to a nearby space, even when the call ends inside a store's own update", async () => {
        // The microphone setting, then two stores that follow it, the last one being the stream the game sends
        const requested = writable(false);
        const processed = derived(requested, ($requested) => $requested);
        const localStream = derived(
            processed,
            ($processed): LocalStreamStoreValue => ({
                type: "success",
                stream: new FakeStream($processed ? [microphoneTrack] : []) as unknown as MediaStream,
            })
        );
        const nearby = streamToSend(localStream, {
            isStreamingStore: writable(true),
            showsCameraToStreamersStore: writable(false),
            getName: () => "nearby-bubble",
        });
        const seenWithMicrophone: boolean[] = [];
        const stopWatching = nearby.subscribe((value) => {
            const stream = value?.type === "success" ? value.stream : undefined;
            seenWithMicrophone.push((stream?.getAudioTracks().length ?? 0) > 0);
        });

        const users = writable(new Map<string, unknown>());
        const joined = new Subject<unknown>();
        const space: CallSpaceLike = {
            getName: () => SPACE,
            usersStore: users,
            observeUserJoined: joined,
            observeUserLeft: new Subject<unknown>(),
            onLeaveSpace: new Subject<void>(),
        };
        const store = createCallStore(() => 1000);
        const connection = createCallConnection({
            store,
            startCall: vi.fn().mockResolvedValue({ started: true, spaceName: SPACE }),
            endCall: vi.fn().mockResolvedValue(true),
            joinSpace: vi.fn().mockResolvedValue(space),
            leaveSpace: vi.fn().mockResolvedValue(undefined),
            setGate: setCallMicGate,
            microphone: {
                isOn: () => get(requested),
                turnOn: () => requested.set(true),
                turnOff: () => requested.set(false),
            },
            now: () => 2000,
        });

        await connection.begin("b1", "Nora");
        joined.next({});
        // On the call: the microphone is on, and the nearby space carries none of it
        expect(get(requested)).toBe(true);
        expect(seenWithMicrophone.every((seen) => !seen)).toBe(true);

        // A quiet stretch ends the call from inside the call store's own update
        store.send({ type: "tick", now: 1_000_000, quietMs: 1000 });
        await Promise.resolve();

        expect(get(requested)).toBe(false);
        // Not one moment in which the nearby space was handed the call's microphone
        expect(seenWithMicrophone.some(Boolean)).toBe(false);
        stopWatching();
    });
});
