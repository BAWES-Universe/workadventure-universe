import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for simple-peer: the real one builds an RTCPeerConnection, which only exists in a browser.
const { fakePeerConnections, FakePeerConnection } = vi.hoisted(() => {
    class FakePeerConnection {
        iceConnectionState: RTCIceConnectionState = "new";
        connectionState: RTCPeerConnectionState = "new";
        restartIce = vi.fn();
        addEventListener = vi.fn();
        removeEventListener = vi.fn();
    }
    return { fakePeerConnections: [] as FakePeerConnection[], FakePeerConnection };
});
type FakePeerConnection = InstanceType<typeof FakePeerConnection>;

vi.mock("@workadventure/simple-peer", async () => {
    const { EventEmitter } = await import("events");
    class FakeSimplePeer extends EventEmitter {
        public _pc: FakePeerConnection | null = new FakePeerConnection();
        public destroyed = false;
        public connected = false;
        public initiator: boolean;
        public negotiate = vi.fn();
        public write = vi.fn();
        public addStream = vi.fn();
        public removeStream = vi.fn();
        constructor(options: { initiator: boolean }) {
            super();
            this.initiator = options.initiator;
            fakePeerConnections.push(this._pc as FakePeerConnection);
        }
        destroy() {
            this.destroyed = true;
        }
    }
    return { default: FakeSimplePeer };
});
vi.mock("../../../src/front/Stores/MediaStore", () => ({ videoBandwidthStore: readable("unlimited") }));
vi.mock("../../../src/front/Stores/PeerStore", () => ({ volumeProximityDiscussionStore: readable(1) }));
vi.mock("../../../src/front/Phaser/Components/SoundMeter", () => ({ SoundMeter: class {} }));
vi.mock("../../../src/front/Components/Video/utils", () => ({ getSdpTransform: () => (sdp: string) => sdp }));
vi.mock("../../../src/front/Utils/E2EHooks", () => ({
    incrementWebRtcConnectionsCount: vi.fn(),
    decrementWebRtcConnectionsCount: vi.fn(),
}));

import { RemotePeer } from "../../../src/front/WebRtc/RemotePeer";
import type { SpaceInterface } from "../../../src/front/Space/SpaceInterface";

function createPeer(initiator: boolean) {
    const space = {
        getSpaceUserBySpaceUserId: () => ({ name: "Bob", reactiveUser: {} }),
        isStreamingStore: writable(false),
        emitPrivateMessage: vi.fn(),
    } as unknown as SpaceInterface;
    const peer = new RemotePeer(
        { userId: "bob", initiator },
        initiator,
        space,
        [],
        false,
        readable({ type: "success", stream: undefined }),
        "video",
        "bob",
        readable(new Set<string>()),
        vi.fn(),
        readable({ audio: true, video: true })
    );
    const pc = fakePeerConnections[fakePeerConnections.length - 1];
    // The peer connected once: from now on, the call is running
    peer.emit("connect");
    return { peer, pc };
}

function iceState(peer: RemotePeer, pc: FakePeerConnection, state: RTCIceConnectionState) {
    pc.iceConnectionState = state;
    peer.emit("iceStateChange", state, "complete");
}

describe("RemotePeer ICE recovery", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fakePeerConnections.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("restarts ICE when the connection drops (Wi-Fi change, network blip), from the side that makes the offers", () => {
        const { peer, pc } = createPeer(true);

        iceState(peer, pc, "disconnected");
        // The tile says "reconnecting" instead of a frozen picture
        expect(get(peer.statusStore)).toBe("connecting");

        // Browsers often recover on their own: give them a moment first
        vi.advanceTimersByTime(2_000);
        expect(pc.restartIce).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1_000);
        expect(pc.restartIce).toHaveBeenCalledOnce();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(peer.negotiate).toHaveBeenCalledOnce();
    });

    it("leaves the restart to the other side when it does not make the offers", () => {
        const { peer, pc } = createPeer(false);

        iceState(peer, pc, "disconnected");
        vi.advanceTimersByTime(5_000);

        expect(pc.restartIce).not.toHaveBeenCalled();
        expect(get(peer.statusStore)).toBe("connecting");
    });

    it("is back to connected once ICE recovers, without restarting", () => {
        const { peer, pc } = createPeer(true);

        iceState(peer, pc, "disconnected");
        vi.advanceTimersByTime(1_000);
        iceState(peer, pc, "connected");
        vi.advanceTimersByTime(30_000);

        expect(get(peer.statusStore)).toBe("connected");
        expect(pc.restartIce).not.toHaveBeenCalled();
    });

    it("does not turn a recovered connection into an error because of the candidates of the ICE restart", () => {
        const { peer, pc } = createPeer(true);

        iceState(peer, pc, "disconnected");
        vi.advanceTimersByTime(3_000);
        // The ICE restart gathers and sends new candidates
        peer.emit("signal", { type: "candidate", candidate: {} });
        iceState(peer, pc, "connected");
        vi.advanceTimersByTime(30_000);

        expect(get(peer.statusStore)).toBe("connected");
    });

    it("shows an error when the connection does not come back", () => {
        const { peer, pc } = createPeer(true);

        iceState(peer, pc, "disconnected");
        vi.advanceTimersByTime(15_000);

        expect(get(peer.statusStore)).toBe("error");
    });

    it("does not show an error on a working call when ICE gathering is merely slow", () => {
        const { peer } = createPeer(true);

        // simple-peer emits iceTimeout when gathering candidates takes long, not when the connection fails
        peer.emit("iceTimeout");

        expect(get(peer.statusStore)).toBe("connected");
    });
});
