import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: undefined, ADMIN_API_TOKEN: undefined }));
vi.mock("../../src/pusher/services/SocketManager", () => ({ socketManager: { isUserInSpace: vi.fn(() => false) } }));

import { viewerOf } from "../../src/pusher/controllers/ArtifactController";

describe("who is looking at an artifact", () => {
    it("is in the chat only when the pusher sees the person in that bubble", () => {
        const inSpace = vi.fn((user: string, space: string) => user === "uuid-alice" && space === "#bubble-1");
        expect(viewerOf("uuid-alice", true, { kind: "nearby", ref: "#bubble-1" }, inSpace)).toEqual({
            person: { signedIn: true, identifier: "uuid-alice" },
            inChat: true,
            chat: { kind: "nearby", ref: "#bubble-1" },
        });
        expect(viewerOf("uuid-alice", true, { kind: "nearby", ref: "#bubble-2" }, inSpace).inChat).toBe(false);
        expect(viewerOf("uuid-bob", true, { kind: "nearby", ref: "#bubble-1" }, inSpace).inChat).toBe(false);
    });

    it("is never in the chat for a direct chat or when no chat is named, whatever the browser says", () => {
        const inSpace = vi.fn(() => true);
        expect(viewerOf("uuid-alice", true, { kind: "dm", ref: "!room:chat.test" }, inSpace).inChat).toBe(false);
        expect(viewerOf("uuid-alice", true, undefined, inSpace).inChat).toBe(false);
        expect(inSpace).not.toHaveBeenCalled();
        expect(viewerOf("uuid-alice", true, undefined, inSpace)).not.toHaveProperty("chat");
    });

    it("names the chat it is asked about, so Orbit can compare it with the one the artifact was made in", () => {
        expect(viewerOf("uuid-alice", true, { kind: "dm", ref: "!room:chat.test" }, () => true).chat).toEqual({
            kind: "dm",
            ref: "!room:chat.test",
        });
    });

    it("names a guest as signed out", () => {
        expect(viewerOf("guest-uuid", false, undefined).person).toEqual({ signedIn: false, identifier: "guest-uuid" });
    });
});
