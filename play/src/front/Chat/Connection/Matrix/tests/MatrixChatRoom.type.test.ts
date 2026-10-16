import { describe, expect, it, vi } from "vitest";
import { RoomEvent, RoomStateEvent } from "matrix-js-sdk";
import { writable } from "svelte/store";

vi.mock("../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => ({ CharacterLayerManager: {} }));
vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        MATRIX_ADMIN_USER: "admin",
        MATRIX_DOMAIN: "domain",
    };
});
vi.mock("../../../Stores/ChatStore.ts", async () => {
    const { writable } = await import("svelte/store");
    return { selectedRoomStore: writable(undefined) };
});

import { MatrixChatRoom } from "../MatrixChatRoom";

describe("the type of a Matrix chat", () => {
    const roomId = "!dm:chat.example.com";
    const bob = "@bob:chat.example.com";

    /** A chat between two people: it is direct only once the account's m.direct list names it. */
    function matrixRoomWith(directRooms: Record<string, string[]> | undefined, membersLoaded = true) {
        return {
            getDMInviter: () => undefined,
            getMembers: () =>
                membersLoaded
                    ? [
                          { userId: "@me:chat.example.com", getDMInviter: () => undefined },
                          { userId: bob, getDMInviter: () => undefined },
                      ]
                    : [],
            client: {
                getAccountData: () => (directRooms ? { getContent: () => directRooms } : undefined),
            },
        };
    }

    /** What the chat decides from the room as it is now, given the type it was created with. */
    function typeOf(matrixRoom: unknown, created: "direct" | "multiple") {
        // Only what the two methods read, so no Matrix client is needed.
        const room = {
            matrixRoom,
            id: roomId,
            type: created,
            getMatrixRoomType: MatrixChatRoom.prototype["getMatrixRoomType"],
        } as unknown as MatrixChatRoom;
        return {
            decided: room["getMatrixRoomType"](),
            outdated: MatrixChatRoom.prototype.hasOutdatedType.call(room),
        };
    }

    it("is a group chat until the m.direct list names it", () => {
        expect(typeOf(matrixRoomWith(undefined), "multiple")).toEqual({ decided: "multiple", outdated: false });
    });

    it("is out of date when it was created before the m.direct list arrived", () => {
        expect(typeOf(matrixRoomWith({ [bob]: [roomId] }), "multiple")).toEqual({ decided: "direct", outdated: true });
    });

    it("is direct when the m.direct list names it, even before the other person's membership has loaded", () => {
        expect(typeOf(matrixRoomWith({ [bob]: [roomId] }, false), "multiple")).toEqual({
            decided: "direct",
            outdated: true,
        });
    });

    it("is not direct when the m.direct list names other chats only", () => {
        expect(typeOf(matrixRoomWith({ [bob]: ["!other:chat.example.com"] }), "multiple")).toEqual({
            decided: "multiple",
            outdated: false,
        });
    });

    it("is up to date when it was created with the m.direct list", () => {
        expect(typeOf(matrixRoomWith({ [bob]: [roomId] }), "direct")).toEqual({ decided: "direct", outdated: false });
    });
});

describe("destroying a Matrix chat", () => {
    it("stops listening to everything it listened to, so a chat made again does not leave the old one behind", () => {
        const off = vi.fn();
        const room = {
            matrixRoom: { off },
            members: writable([]),
            messages: [],
            handleRoomTimeline: "timeline",
            handleRoomName: "name",
            handleRoomRedaction: "redaction",
            handleStateEvent: "state",
            handleMyMembership: "membership",
            handleNewMember: "member",
        } as unknown as MatrixChatRoom;

        MatrixChatRoom.prototype.destroy.call(room);

        expect(off.mock.calls).toEqual(
            expect.arrayContaining([
                [RoomEvent.Timeline, "timeline"],
                [RoomEvent.Name, "name"],
                [RoomEvent.Redaction, "redaction"],
                [RoomStateEvent.Events, "state"],
                [RoomEvent.MyMembership, "membership"],
                [RoomStateEvent.NewMember, "member"],
            ])
        );
    });
});
