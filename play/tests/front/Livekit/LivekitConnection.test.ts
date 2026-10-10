import { Subject } from "rxjs";
import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceInterface } from "../../../src/front/Space/SpaceInterface";
import type { StreamableSubjects } from "../../../src/front/Space/SpacePeerManager/SpacePeerManager";
import { CommunicationMessageType } from "../../../src/front/Space/SpacePeerManager/CommunicationMessageType";

// A stand-in for LiveKitRoom: the real one needs livekit-client and a media server.
const { fakeRooms, failingJoins } = vi.hoisted(() => ({
    // How many of the next rooms fail to connect (the network is still down)
    failingJoins: { count: 0 },
    fakeRooms: [] as {
        serverUrl: string;
        token: string;
        abortSignal: AbortSignal;
        onConnectionLost: (() => void) | undefined;
        destroy: ReturnType<typeof vi.fn>;
        joinRoom: ReturnType<typeof vi.fn>;
        dispatchStream: ReturnType<typeof vi.fn>;
    }[],
}));

vi.mock("../../../src/front/Livekit/LiveKitRoom", () => ({
    LiveKitRoom: class {
        public onConnectionLost: (() => void) | undefined;
        public prepareConnection = vi.fn().mockResolvedValue(undefined);
        public joinRoom = vi.fn(() =>
            failingJoins.count-- > 0
                ? Promise.reject(new Error("could not establish signal connection"))
                : Promise.resolve(undefined)
        );
        public destroy = vi.fn();
        public dispatchStream = vi.fn().mockResolvedValue(undefined);
        constructor(
            public serverUrl: string,
            public token: string,
            _space: unknown,
            _subjects: unknown,
            _blocked: unknown,
            public abortSignal: AbortSignal
        ) {
            fakeRooms.push(this);
        }
    },
}));
vi.mock("../../../src/front/Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { streamingMegaphoneStore: writable(false) };
});

import { LivekitConnection } from "../../../src/front/Livekit/LivekitConnection";

function audioStream(readyState: MediaStreamTrackState): MediaStream {
    return { getAudioTracks: () => [{ readyState }] } as unknown as MediaStream;
}

function createConnection(currentMediaStream?: MediaStream) {
    const invitations = new Subject<unknown>();
    const disconnections = new Subject<unknown>();
    const space = {
        observePrivateEvent: (type: string) =>
            type === CommunicationMessageType.LIVEKIT_INVITATION_MESSAGE ? invitations : disconnections,
    } as unknown as SpaceInterface;
    const subjects = {} as StreamableSubjects;
    const connection = new LivekitConnection(
        space,
        subjects,
        writable(new Set<string>()),
        writable(false),
        () => currentMediaStream
    );
    const invite = (token: string) =>
        invitations.next({ livekitInvitationMessage: { serverUrl: "wss://livekit.example.com", token } });
    const disconnect = () => disconnections.next({ livekitDisconnectMessage: {} });
    return { connection, invite, disconnect };
}

describe("LivekitConnection", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fakeRooms.length = 0;
        failingJoins.count = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("builds a new room when the media server connection is lost for good", async () => {
        const { invite } = createConnection();
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);
        expect(fakeRooms).toHaveLength(1);

        fakeRooms[0].onConnectionLost?.();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(fakeRooms).toHaveLength(2);
        expect(fakeRooms[1].token).toBe("token-1");
        expect(fakeRooms[1].joinRoom).toHaveBeenCalledOnce();
        // The dead room's participants stop reacting
        expect(fakeRooms[0].abortSignal.aborted).toBe(true);
    });

    it("keeps trying while the network is still down", async () => {
        const { invite } = createConnection();
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        fakeRooms[0].onConnectionLost?.();
        await vi.advanceTimersByTimeAsync(10_000);
        // Still offline: the new room cannot connect, and is lost too
        fakeRooms[1].onConnectionLost?.();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(fakeRooms.length).toBeGreaterThanOrEqual(3);
    });

    it("publishes the stream of the scripting API again in the rebuilt room", async () => {
        const scriptingStream = audioStream("live");
        const { invite } = createConnection(scriptingStream);
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        fakeRooms[0].onConnectionLost?.();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(fakeRooms[1].dispatchStream).toHaveBeenCalledWith(scriptingStream);
    });

    it("does not publish a stream of the scripting API that has ended", async () => {
        const { invite } = createConnection(audioStream("ended"));
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        fakeRooms[0].onConnectionLost?.();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(fakeRooms[1].dispatchStream).not.toHaveBeenCalled();
    });

    it("tries again when the new room cannot connect yet", async () => {
        const { invite } = createConnection();
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        // Still offline: the first new room cannot connect
        failingJoins.count = 1;
        fakeRooms[0].onConnectionLost?.();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fakeRooms).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(5_000);
        expect(fakeRooms).toHaveLength(3);
    });

    it("replaces the room with the new invitation of the back, and destroys the old one", async () => {
        const { invite } = createConnection();
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        invite("token-2");
        await vi.advanceTimersByTimeAsync(0);

        expect(fakeRooms[0].destroy).toHaveBeenCalled();
        expect(fakeRooms).toHaveLength(2);
        expect(fakeRooms[1].token).toBe("token-2");
    });

    it("does not build a new room once the back told us to leave", async () => {
        const { invite, disconnect } = createConnection();
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        fakeRooms[0].onConnectionLost?.();
        disconnect();
        await vi.advanceTimersByTimeAsync(120_000);

        expect(fakeRooms).toHaveLength(1);
    });

    it("does not build a new room once the space is left", async () => {
        const { connection, invite } = createConnection();
        invite("token-1");
        await vi.advanceTimersByTimeAsync(0);

        fakeRooms[0].onConnectionLost?.();
        connection.destroy();
        await vi.advanceTimersByTimeAsync(120_000);

        expect(fakeRooms).toHaveLength(1);
    });
});
