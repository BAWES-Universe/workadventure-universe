import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: undefined, ADMIN_API_TOKEN: undefined }));
vi.mock("../../src/pusher/services/SocketManager", () => ({ socketManager: { isUserInSpace: vi.fn(() => false) } }));

import { parsePayBody, viewerOf } from "../../src/pusher/controllers/ArtifactController";

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

    it("is not in the chat for a space that is not a bubble, however many players are in it", () => {
        const inSpace = vi.fn(() => true);
        expect(viewerOf("uuid-alice", true, { kind: "nearby", ref: "allWorldUser" }, inSpace).inChat).toBe(false);
        expect(inSpace).not.toHaveBeenCalled();
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

describe("what the payment side of a page accepts", () => {
    const wish = "w1234567890abcdef";
    const code = "R".repeat(43);

    it("takes one thing at a time, and a wish only with a start or a check", () => {
        expect(parsePayBody({ start: true, intentId: wish, recoveryCode: code })).toEqual({
            chat: undefined,
            request: { start: true, intentId: wish, recoveryCode: code },
        });
        expect(
            parsePayBody({
                check: true,
                intentId: wish,
                recoveryCode: code,
                receiptCode: code,
                chat: { kind: "dm", ref: "!r:x" },
            })
        ).toEqual({
            chat: { kind: "dm", ref: "!r:x" },
            request: { check: true, intentId: wish, recoveryCode: code, receiptCode: code },
        });
        expect(parsePayBody({ restore: true, recoveryCode: code })).toEqual({
            chat: undefined,
            request: { restore: true, recoveryCode: code },
        });
        expect(parsePayBody({ order: "o1" })).toEqual({ chat: undefined, request: { order: "o1" } });
        expect(parsePayBody({})).toEqual({ chat: undefined, request: {} });
        for (const bad of [
            { start: true, order: "o1" },
            { start: true, restore: true },
            { check: true, restore: true, intentId: wish },
            { check: true },
            { intentId: wish },
            { restore: true, intentId: wish },
            { order: "o1", intentId: wish },
            { start: true, intentId: "short" },
            { start: true, intentId: "has spaces in it!" },
            { start: true, intentId: "x".repeat(65) },
            { restore: true, recoveryCode: "x".repeat(201) },
            { start: true, amount: "1.000" },
            { start: true, extra: 1 },
        ]) {
            expect(parsePayBody(bad), JSON.stringify(bad)).toBeNull();
        }
    });
});
