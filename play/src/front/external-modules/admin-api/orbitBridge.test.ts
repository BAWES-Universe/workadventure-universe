import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ORBIT_REQUEST_TIMEOUT_MS,
    OrbitBridge,
    isOrbitBridgeAckMessage,
    isOrbitBridgeReadyMessage,
    newRoomRevision,
    type OrbitBridgeOutgoing,
} from "./orbitBridge";

const revision = "rev-aaaaaaaaaaaaaaaa";

function makeBridge() {
    const posted: OrbitBridgeOutgoing[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const bridge = new OrbitBridge(
        {
            post: (message) => posted.push(message),
            setTimeout: (callback) => {
                nextTimer += 1;
                timers.set(nextTimer, callback);
                return nextTimer;
            },
            clearTimeout: (timer) => timers.delete(timer as number),
        },
        revision
    );
    return { bridge, posted, timers };
}

describe("Orbit bridge messages", () => {
    it("accepts only a versioned, well-formed ready message", () => {
        expect(isOrbitBridgeReadyMessage({ type: "orbit-bridge-ready", version: 1, capabilities: ["navigate"] })).toBe(
            true
        );
        expect(isOrbitBridgeReadyMessage({ type: "orbit-bridge-ready", version: 2, capabilities: [] })).toBe(false);
        expect(isOrbitBridgeReadyMessage({ type: "orbit-bridge-ready", version: 1 })).toBe(false);
        expect(isOrbitBridgeReadyMessage({ type: "orbit-bridge-ready", version: 1, capabilities: [42] })).toBe(false);
        expect(isOrbitBridgeReadyMessage("orbit-bridge-ready")).toBe(false);
    });

    it("accepts only a versioned, well-formed acknowledgement", () => {
        const ack = { type: "orbit-bridge-ack", version: 1, requestId: "1", roomRevision: revision, ok: true };
        expect(isOrbitBridgeAckMessage(ack)).toBe(true);
        expect(isOrbitBridgeAckMessage({ ...ack, version: 2 })).toBe(false);
        expect(isOrbitBridgeAckMessage({ ...ack, roomRevision: "short" })).toBe(false);
        expect(isOrbitBridgeAckMessage({ ...ack, ok: "yes" })).toBe(false);
        expect(isOrbitBridgeAckMessage({ ...ack, requestId: "" })).toBe(false);
    });

    it("gives every visit a new room revision Orbit accepts", () => {
        const first = newRoomRevision();
        expect(first.length).toBeGreaterThanOrEqual(16);
        expect(first.length).toBeLessThanOrEqual(128);
        expect(newRoomRevision()).not.toBe(first);
    });
});

describe("OrbitBridge", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("holds a page request until Orbit has signed in and is ready, then sends it", () => {
        const { bridge, posted } = makeBridge();
        bridge.navigate("new-universe");
        expect(posted).toEqual([]);

        bridge.onReady();
        expect(posted[0]).toEqual({
            type: "orbit-bridge-init",
            version: 1,
            roomRevision: revision,
            capabilities: ["navigate", "event"],
        });
        expect(posted[1]).toEqual({
            type: "orbit-navigate",
            version: 1,
            requestId: "1",
            roomRevision: revision,
            intent: "new-universe",
        });
    });

    it("sends straight away once ready, with the parameters given", () => {
        const { bridge, posted } = makeBridge();
        bridge.onReady();
        bridge.navigate("world-members", { worldId: "w1" });
        bridge.notifyChanged("universes");
        expect(posted[1]).toMatchObject({ type: "orbit-navigate", intent: "world-members", params: { worldId: "w1" } });
        expect(posted[2]).toMatchObject({ type: "orbit-event", topic: "universes", roomRevision: revision });
    });

    it("stops waiting for an answer once Orbit acknowledges, and ignores answers for another visit", () => {
        const { bridge, timers } = makeBridge();
        bridge.onReady();
        bridge.navigate("new-universe");
        expect(timers.size).toBe(1);

        const ack = { type: "orbit-bridge-ack" as const, version: 1 as const, requestId: "1", ok: true };
        bridge.onAck({ ...ack, roomRevision: "rev-bbbbbbbbbbbbbbbb" });
        expect(timers.size).toBe(1);

        bridge.onAck({ ...ack, roomRevision: revision });
        expect(timers.size).toBe(0);
    });

    it("gives up on a request Orbit never answers", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { bridge, timers } = makeBridge();
        bridge.onReady();
        bridge.navigate("new-universe");
        const [giveUp] = timers.values();
        giveUp();
        expect(warn).toHaveBeenCalled();
        expect(ORBIT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it("drops waiting requests when Orbit closes, and needs Orbit to be ready again", () => {
        const { bridge, posted, timers } = makeBridge();
        bridge.navigate("new-universe");
        bridge.onClosed();
        bridge.onReady();
        expect(posted.map((message) => message.type)).toEqual(["orbit-bridge-init"]);

        bridge.navigate("new-universe");
        bridge.onClosed();
        expect(bridge.isReady).toBe(false);
        expect(timers.size).toBe(0);
        bridge.navigate("world-members", { worldId: "w1" });
        expect(posted).toHaveLength(2);
    });
});
