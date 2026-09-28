import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ORBIT_REQUEST_TIMEOUT_MS,
    OrbitBridge,
    isOrbitBridgeAckMessage,
    isOrbitBridgeReadyMessage,
    isOrbitProfileChangedMessage,
    isOrbitQuestStateMessage,
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
            capabilities: ["navigate", "event", "view", "profile"],
            view: "compact",
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

    it("tells Orbit the view once ready, and carries a view set before that in the init", () => {
        const { bridge, posted } = makeBridge();
        bridge.setView("full");
        expect(posted).toEqual([]);
        bridge.onReady();
        expect(posted[0]).toMatchObject({ type: "orbit-bridge-init", view: "full" });
        bridge.setView("compact");
        expect(posted[1]).toEqual({ type: "orbit-view", version: 1, view: "compact" });
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

    it("accepts a profile rename only in its exact shape", () => {
        const good = {
            type: "orbit-profile-changed",
            version: 1,
            roomRevision: "rev-0123456789abcdef",
            name: "Khalid",
        };
        expect(isOrbitProfileChangedMessage(good)).toBe(true);
        expect(isOrbitProfileChangedMessage({ ...good, name: "" })).toBe(false);
        expect(isOrbitProfileChangedMessage({ ...good, name: 5 })).toBe(false);
        expect(isOrbitProfileChangedMessage({ ...good, version: 2 })).toBe(false);
        expect(isOrbitProfileChangedMessage({ ...good, roomRevision: "short" })).toBe(false);
    });
});

describe("Orbit bridge quest log", () => {
    const entry = { id: "welcome.explore", title: "Explore this place", status: "tracked" as const, room: "Lobby" };

    it("sends nothing about quests and lists no capability until the game has a quest log", () => {
        const { bridge, posted } = makeBridge();
        bridge.onReady();
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ capabilities: ["navigate", "event", "view", "profile"] });
    });

    it("sends the log right after init, then on each change while Orbit listens", () => {
        const { bridge, posted } = makeBridge();
        bridge.setQuestState([entry]);
        expect(posted).toHaveLength(0);

        bridge.onReady();
        expect(posted[0]).toMatchObject({
            type: "orbit-bridge-init",
            capabilities: expect.arrayContaining(["quests"]),
        });
        expect(posted[1]).toEqual({ type: "orbit-quest-state", version: 1, entries: [entry] });

        bridge.setQuestState([{ ...entry, status: "done", stamp: "explorer" }]);
        expect(posted[2]).toEqual({
            type: "orbit-quest-state",
            version: 1,
            entries: [{ ...entry, status: "done", stamp: "explorer" }],
        });

        // Closed: kept for the next init, not posted.
        bridge.onClosed();
        bridge.setQuestState([]);
        expect(posted).toHaveLength(3);
    });

    it("bounds the log: eight entries at most, long names cut", () => {
        const { bridge, posted } = makeBridge();
        bridge.onReady();
        const long = "x".repeat(200);
        bridge.setQuestState(Array.from({ length: 12 }, () => ({ ...entry, title: long, giver: long, room: long })));
        const message = posted[1];
        expect(isOrbitQuestStateMessage(message)).toBe(true);
        if (message.type !== "orbit-quest-state") throw new Error("expected the quest log");
        expect(message.entries).toHaveLength(8);
        expect(message.entries[0].title).toHaveLength(80);
        expect(message.entries[0].giver).toHaveLength(64);
        expect(message.entries[0].room).toHaveLength(80);
    });

    it("rejects malformed quest logs", () => {
        const good = { type: "orbit-quest-state", version: 1, entries: [entry] };
        expect(isOrbitQuestStateMessage(good)).toBe(true);
        expect(isOrbitQuestStateMessage({ ...good, version: 2 })).toBe(false);
        expect(isOrbitQuestStateMessage({ ...good, entries: [{ ...entry, status: "won" }] })).toBe(false);
        expect(isOrbitQuestStateMessage({ ...good, entries: [{ ...entry, stamp: "gold" }] })).toBe(false);
        expect(isOrbitQuestStateMessage({ ...good, entries: [{ ...entry, title: "" }] })).toBe(false);
        expect(isOrbitQuestStateMessage({ ...good, entries: Array.from({ length: 9 }, () => entry) })).toBe(false);
    });
});
