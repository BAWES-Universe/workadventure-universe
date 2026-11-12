import type { ClientToServerMessage } from "@workadventure/messages";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import {
    callOnlySpaceUserId,
    isAllowedForCallOnly,
    mayOpenCallOnly,
} from "../../src/pusher/services/CallOnlyConnection";
import type { Socket } from "../../src/pusher/services/SocketManager";
import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { SpaceConnection } from "../../src/pusher/models/SpaceConnection";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));

const message = (m: unknown) => m as ClientToServerMessage["message"];

describe("what a call-only connection may send", () => {
    it("allows what is about its space", () => {
        for (const $case of [
            "addSpaceFilterMessage",
            "removeSpaceFilterMessage",
            "updateSpaceUserMessage",
            "abortQueryMessage",
            "publicEvent",
            "privateEvent",
        ]) {
            expect(isAllowedForCallOnly(message({ $case })), $case).toBe(true);
        }
        for (const $case of ["joinSpaceQuery", "leaveSpaceQuery"]) {
            expect(
                isAllowedForCallOnly(message({ $case: "queryMessage", queryMessage: { id: 1, query: { $case } } }))
            ).toBe(true);
        }
    });

    it("drops everything about the room: moving, the viewport, areas, variables, edits, bans, reports, chat ids", () => {
        for (const $case of [
            "viewportMessage",
            "userMovesMessage",
            "playGlobalMessage",
            "reportPlayerMessage",
            "setPlayerDetailsMessage",
            "updateSpaceMetadataMessage",
            "updateChatIdMessage",
            "leaveChatRoomAreaMessage",
            "itemEventMessage",
            "variableMessage",
            "followRequestMessage",
            "pingMessage",
            "askPositionMessage",
            "editMapCommandMessage",
            "banPlayerMessage",
        ]) {
            expect(isAllowedForCallOnly(message({ $case })), $case).toBe(false);
        }
    });

    it("drops every question but joining and leaving a space", () => {
        for (const $case of ["jitsiJwtQuery", "joinBBBMeetingQuery", "roomTagsQuery", "searchMemberQuery"]) {
            expect(
                isAllowedForCallOnly(message({ $case: "queryMessage", queryMessage: { id: 1, query: { $case } } })),
                $case
            ).toBe(false);
        }
        expect(isAllowedForCallOnly(message({ $case: "queryMessage", queryMessage: { id: 1 } }))).toBe(false);
        expect(isAllowedForCallOnly(undefined)).toBe(false);
    });
});

describe("who may open a call-only connection", () => {
    it("is a bot, by the tags its signed token carries", () => {
        expect(mayOpenCallOnly(["bot", "voice-bot"])).toBe(true);
        expect(mayOpenCallOnly(["admin"])).toBe(false);
        expect(mayOpenCallOnly([])).toBe(false);
        expect(mayOpenCallOnly(undefined)).toBe(false);
    });

    it("gives each connection a space id of its own, with no room number in it", () => {
        const a = callOnlySpaceUserId();
        expect(a).toMatch(/^call_[0-9a-f-]{36}$/);
        expect(callOnlySpaceUserId()).not.toBe(a);
    });
});

describe("closing a call-only connection", () => {
    function callOnlySocket(callOnly: boolean): Socket {
        const data = {
            callOnly,
            disconnecting: false,
            roomId: "http://play.example.com/@/t/w/r",
            userUuid: "bot-b1",
            userIdentifier: "bot-b1",
            name: "Bot",
            spaces: new Set<string>(),
            joinSpacesPromise: new Map<string, Promise<void>>(),
            currentChatRoomArea: [],
            keepAliveInterval: undefined,
            backConnection: undefined,
        };
        return { getUserData: () => data } as unknown as Socket;
    }

    it("never leaves a room it never joined, so nothing in the room hears of it", () => {
        const socketManager = new SocketManager(mock<SpaceConnection>());
        const leaveRoom = vi.spyOn(socketManager, "leaveRoom").mockImplementation(() => {});
        socketManager.cleanupSocket(callOnlySocket(true));
        expect(leaveRoom).not.toHaveBeenCalled();
    });

    it("still leaves the room for any other connection", () => {
        const socketManager = new SocketManager(mock<SpaceConnection>());
        const leaveRoom = vi.spyOn(socketManager, "leaveRoom").mockImplementation(() => {});
        socketManager.cleanupSocket(callOnlySocket(false));
        expect(leaveRoom).toHaveBeenCalledTimes(1);
    });
});
