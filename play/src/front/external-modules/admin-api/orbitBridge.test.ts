import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ORBIT_REQUEST_TIMEOUT_MS,
    OrbitBridge,
    isOrbitBridgeAckMessage,
    isOrbitBridgeReadyMessage,
    isOrbitCheckLinksMessage,
    isOrbitOpenArtifactMessage,
    isOrbitOpenLinkMessage,
    isOrbitInvitePersonMessage,
    isOrbitMessagePersonMessage,
    isOrbitProfileChangedMessage,
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

describe("Orbit's invite and message requests", () => {
    const base = { version: 1, roomRevision: revision, uuid: "uuid-ali", name: "Ali" };

    it("accepts a well-formed invite request", () => {
        expect(isOrbitInvitePersonMessage({ ...base, type: "orbit-invite-person" })).toBe(true);
    });

    it("refuses an invite request with the wrong version, type, id or name", () => {
        const invite = { ...base, type: "orbit-invite-person" };
        expect(isOrbitInvitePersonMessage({ ...invite, version: 2 })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, type: "orbit-navigate" })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, uuid: "" })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, uuid: "u".repeat(65) })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, name: 42 })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, name: "" })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, name: "   " })).toBe(false);
        expect(isOrbitInvitePersonMessage({ ...invite, roomRevision: "short" })).toBe(false);
        expect(isOrbitInvitePersonMessage(null)).toBe(false);
    });

    it("accepts a message request with a Matrix id, and refuses anything else as the address", () => {
        const message = { ...base, type: "orbit-message-person", chatId: "@ali:chat.example.com" };
        expect(isOrbitMessagePersonMessage(message)).toBe(true);
        expect(isOrbitMessagePersonMessage({ ...message, name: " \t " })).toBe(false);
        expect(isOrbitMessagePersonMessage({ ...message, chatId: "ali" })).toBe(false);
        expect(isOrbitMessagePersonMessage({ ...message, chatId: "@ali" })).toBe(false);
        expect(isOrbitMessagePersonMessage({ ...message, chatId: "@a li:server" })).toBe(false);
        expect(isOrbitMessagePersonMessage({ ...message, chatId: undefined })).toBe(false);
        expect(isOrbitMessagePersonMessage({ ...message, type: "orbit-invite-person" })).toBe(false);
    });
});

describe("Orbit's profile link requests", () => {
    const check = {
        type: "orbit-check-links",
        version: 1,
        requestId: "links-1",
        roomRevision: revision,
        urls: ["https://mishari.example/about"],
    };

    it("accepts a well-formed check of 1 to 10 links", () => {
        expect(isOrbitCheckLinksMessage(check)).toBe(true);
        expect(isOrbitCheckLinksMessage({ ...check, urls: [] })).toBe(false);
        expect(isOrbitCheckLinksMessage({ ...check, urls: Array(11).fill("https://a.example") })).toBe(false);
        expect(isOrbitCheckLinksMessage({ ...check, urls: [42] })).toBe(false);
        expect(isOrbitCheckLinksMessage({ ...check, urls: ["https://a.example/" + "x".repeat(2048)] })).toBe(false);
        expect(isOrbitCheckLinksMessage({ ...check, requestId: undefined })).toBe(false);
        expect(isOrbitCheckLinksMessage({ ...check, version: 2 })).toBe(false);
    });

    it("accepts a well-formed request to open one link", () => {
        const open = {
            type: "orbit-open-link",
            version: 1,
            roomRevision: revision,
            url: "https://mishari.example/about",
        };
        expect(isOrbitOpenLinkMessage(open)).toBe(true);
        expect(isOrbitOpenLinkMessage({ ...open, url: "" })).toBe(false);
        expect(isOrbitOpenLinkMessage({ ...open, roomRevision: "short" })).toBe(false);
    });

    it("accepts a well-formed request to open one of your artifacts", () => {
        const open = {
            type: "orbit-open-artifact",
            version: 1,
            roomRevision: revision,
            id: "11111111-1111-4111-8111-111111111111",
            title: "Tip calculator",
            kind: "app",
            artifactVersion: 3,
            maker: "Scout",
        };
        expect(isOrbitOpenArtifactMessage(open)).toBe(true);
        expect(isOrbitOpenArtifactMessage({ ...open, maker: "" })).toBe(true);
        expect(isOrbitOpenArtifactMessage({ ...open, id: "../etc" })).toBe(false);
        expect(isOrbitOpenArtifactMessage({ ...open, title: "" })).toBe(false);
        expect(isOrbitOpenArtifactMessage({ ...open, artifactVersion: 0 })).toBe(false);
        expect(isOrbitOpenArtifactMessage({ ...open, artifactVersion: 1.5 })).toBe(false);
        expect(isOrbitOpenArtifactMessage({ ...open, roomRevision: "short" })).toBe(false);
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
            capabilities: ["navigate", "event", "view", "profile", "invite", "message", "open-link", "open-artifact"],
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
        expect(isOrbitProfileChangedMessage({ ...good, name: "   " })).toBe(false);
        expect(isOrbitProfileChangedMessage({ ...good, name: 5 })).toBe(false);
        expect(isOrbitProfileChangedMessage({ ...good, version: 2 })).toBe(false);
        expect(isOrbitProfileChangedMessage({ ...good, roomRevision: "short" })).toBe(false);
    });

    it("answers a check of links with this visit's revision, and only while Orbit is ready", () => {
        const { bridge, posted } = makeBridge();
        bridge.answerLinks("links-1", ["https://mishari.example/about"]);
        expect(posted).toEqual([]);

        bridge.onReady();
        bridge.answerLinks("links-1", ["https://mishari.example/about"]);
        expect(posted[1]).toEqual({
            type: "orbit-links",
            version: 1,
            requestId: "links-1",
            roomRevision: revision,
            openHere: ["https://mishari.example/about"],
        });

        bridge.onClosed();
        bridge.answerLinks("links-2", []);
        expect(posted).toHaveLength(2);
    });
});
