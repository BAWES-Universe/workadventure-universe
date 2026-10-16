import type { EventEmitter } from "events";
import { Subject } from "rxjs";
import { writable } from "svelte/store";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionState, DisconnectReason, RoomEvent } from "livekit-client";
import type * as LivekitClient from "livekit-client";
import type { LocalStreamStoreValue } from "../../../src/front/Stores/MediaStore";
import type { SpaceInterface } from "../../../src/front/Space/SpaceInterface";
import type { StreamableSubjects } from "../../../src/front/Space/SpacePeerManager/SpacePeerManager";

// A stand-in for livekit-client's Room and local tracks: the real ones need a browser and a media server.
const { fakeRooms } = vi.hoisted(() => ({ fakeRooms: [] as unknown[] }));

vi.mock("livekit-client", async (importOriginal) => {
    const actual: typeof LivekitClient = await importOriginal();
    const { EventEmitter } = await import("events");
    class FakeLocalTrack {
        public isUpstreamPaused = false;
        public resumeUpstream = vi.fn().mockResolvedValue(undefined);
        public pauseUpstream = vi.fn().mockResolvedValue(undefined);
        public replaceTrack = vi.fn().mockResolvedValue(undefined);
        constructor(public mediaStreamTrack: MediaStreamTrack) {}
    }
    class FakeRoom extends EventEmitter {
        public state = actual.ConnectionState.Disconnected;
        public remoteParticipants = new Map();
        public localParticipant = {
            permissions: { canPublish: true },
            publishTrack: vi.fn().mockResolvedValue(undefined),
            trackPublications: new Map(),
        };
        public prepareConnection = vi.fn().mockResolvedValue(undefined);
        public connect = vi.fn().mockImplementation(() => {
            this.state = actual.ConnectionState.Connected;
            return Promise.resolve();
        });
        public disconnect = vi.fn().mockResolvedValue(undefined);
        public switchActiveDevice = vi.fn().mockResolvedValue(true);
        constructor() {
            super();
            fakeRooms.push(this);
        }
    }
    return { ...actual, Room: FakeRoom, LocalVideoTrack: FakeLocalTrack, LocalAudioTrack: FakeLocalTrack };
});
vi.mock("../../../src/front/Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        localStreamStore: writable({ type: "success", stream: undefined }),
        speakerSelectedStore: writable(undefined),
    };
});
vi.mock("../../../src/front/Stores/ScreenSharingStore", async () => {
    const { writable } = await import("svelte/store");
    return { screenSharingLocalStreamStore: writable({ type: "success", stream: undefined }) };
});
vi.mock("../../../src/front/Stores/StreamableCollectionStore", () => ({
    SCREEN_SHARE_STARTING_PRIORITY: 0,
    VIDEO_STARTING_PRIORITY: 0,
}));
vi.mock("../../../src/front/Stores/OrderedStreamableCollectionStore", async () => {
    const { writable } = await import("svelte/store");
    return { triggerReorderStore: writable(0) };
});
vi.mock("../../../src/front/Utils/E2EHooks", () => ({
    incrementLivekitRoomCount: vi.fn(),
    decrementLivekitRoomCount: vi.fn(),
}));
vi.mock("../../../src/front/Livekit/LivekitParticipant", () => ({
    LiveKitParticipant: class {
        destroy = vi.fn();
    },
}));

import { LiveKitRoom } from "../../../src/front/Livekit/LiveKitRoom";

type FakeRoom = EventEmitter & {
    state: ConnectionState;
    localParticipant: { publishTrack: ReturnType<typeof vi.fn>; permissions: { canPublish: boolean } };
    disconnect: ReturnType<typeof vi.fn>;
};

function cameraStream(trackId: string): LocalStreamStoreValue {
    const track = { id: trackId, kind: "video" } as unknown as MediaStreamTrack;
    return {
        type: "success",
        stream: { getVideoTracks: () => [track], getAudioTracks: () => [] } as unknown as MediaStream,
    };
}

async function joinedRoom() {
    const localStreamStore: Writable<LocalStreamStoreValue> = writable({ type: "success", stream: undefined });
    const counter = { increment: vi.fn(), decrement: vi.fn() };
    const space = {
        isStreamingStore: writable(true),
        getSpaceUserBySpaceUserId: vi.fn(),
        mySpaceUserId: "me",
    } as unknown as SpaceInterface;
    const streamableSubjects: StreamableSubjects = {
        videoPeerAdded: new Subject(),
        videoPeerRemoved: new Subject(),
        screenSharingPeerAdded: new Subject(),
        screenSharingPeerRemoved: new Subject(),
    };
    const liveKitRoom = new LiveKitRoom(
        "wss://livekit.example.com",
        "token",
        space,
        streamableSubjects,
        writable(new Set<string>()),
        new AbortController().signal,
        writable({ type: "success", stream: undefined }),
        writable(undefined),
        counter,
        localStreamStore
    );
    await liveKitRoom.joinRoom();
    const room = fakeRooms[fakeRooms.length - 1] as FakeRoom;
    return { liveKitRoom, room, localStreamStore, counter };
}

async function flush() {
    // Lets the publications (promise chains a few steps long) settle
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe("LiveKitRoom", () => {
    beforeEach(() => {
        fakeRooms.length = 0;
    });

    it("publishes the camera again after a failed publication, instead of replacing a track never published", async () => {
        const { room, localStreamStore } = await joinedRoom();
        room.localParticipant.publishTrack
            .mockRejectedValueOnce(new Error("publishing rejected as engine not connected within timeout"))
            .mockResolvedValue(undefined);

        localStreamStore.set(cameraStream("camera-1"));
        await flush();
        // The camera is turned off and on again: a new track
        localStreamStore.set(cameraStream("camera-2"));
        await flush();

        expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
    });

    it("does not publish while the room is reconnecting, and publishes once it is back", async () => {
        const { room, localStreamStore } = await joinedRoom();
        room.state = ConnectionState.Reconnecting;

        // A publication now would wait 15 seconds for the signal, then fail
        localStreamStore.set(cameraStream("camera-1"));
        await flush();
        expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();

        room.state = ConnectionState.Connected;
        room.emit(RoomEvent.Reconnected);
        await flush();

        expect(room.localParticipant.publishTrack).toHaveBeenCalledOnce();
    });

    it("tears the room down and asks for a new one when livekit-client gives up reconnecting", async () => {
        const { liveKitRoom, room, localStreamStore, counter } = await joinedRoom();
        const onConnectionLost = vi.fn();
        liveKitRoom.onConnectionLost = onConnectionLost;

        // livekit-client emits Disconnected without a reason after its last reconnection attempt
        room.state = ConnectionState.Disconnected;
        room.emit(RoomEvent.Disconnected, undefined);

        expect(counter.decrement).toHaveBeenCalledOnce();
        expect(onConnectionLost).toHaveBeenCalledOnce();

        // The dead room no longer gets the camera
        localStreamStore.set(cameraStream("camera-1"));
        await flush();
        expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    });

    it("does not ask for a new room when another connection took our place", async () => {
        const { liveKitRoom, room, counter } = await joinedRoom();
        const onConnectionLost = vi.fn();
        liveKitRoom.onConnectionLost = onConnectionLost;

        room.emit(RoomEvent.Disconnected, DisconnectReason.DUPLICATE_IDENTITY);

        expect(counter.decrement).toHaveBeenCalledOnce();
        expect(onConnectionLost).not.toHaveBeenCalled();
    });

    it("does nothing more when we left the room ourselves", async () => {
        const { liveKitRoom, room, counter } = await joinedRoom();
        const onConnectionLost = vi.fn();
        liveKitRoom.onConnectionLost = onConnectionLost;

        liveKitRoom.destroy();
        room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
        liveKitRoom.destroy();

        expect(counter.decrement).toHaveBeenCalledOnce();
        expect(onConnectionLost).not.toHaveBeenCalled();
        expect(room.listenerCount(RoomEvent.Disconnected)).toBe(0);
    });
});
