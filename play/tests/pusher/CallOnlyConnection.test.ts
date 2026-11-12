import { FilterType } from "@workadventure/messages";
import type { ClientToServerMessage } from "@workadventure/messages";
import { callSpaceName } from "@workadventure/shared-utils/src/Space/callSpaceName";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import {
    callOnlySpaceUserId,
    isAllowedForCallOnly,
    mayOpenCallOnly,
} from "../../src/pusher/services/CallOnlyConnection";
import type { Socket } from "../../src/pusher/services/SocketManager";
import { SocketManager } from "../../src/pusher/services/SocketManager";
import { SpaceJoinRefusedError } from "../../src/pusher/services/SpaceJoinPolicy";
import type { SpaceConnection } from "../../src/pusher/models/SpaceConnection";
import { Space } from "../../src/pusher/models/Space";

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

describe("the events of a call (the sound is set up with them)", () => {
    function socketWith(data: Record<string, unknown>): Socket {
        const full = {
            disconnecting: false,
            spaceUserId: "call_1",
            spaces: new Set<string>(["w.call__x"]),
            joinSpacesPromise: new Map<string, Promise<void>>(),
            ...data,
        };
        return { getUserData: () => full } as unknown as Socket;
    }

    function managerWithSpace() {
        const socketManager = new SocketManager(mock<SpaceConnection>());
        const forwardMessageToSpaceBack = vi.fn();
        const space = {
            localName: "call__x",
            forwarder: { forwardMessageToSpaceBack },
        };
        (socketManager as unknown as { spaces: Map<string, unknown> }).spaces.set("w.call__x", space);
        return { socketManager, forwardMessageToSpaceBack };
    }

    it("lets a call-only connection send public and private events with its space id as the sender", async () => {
        const { socketManager, forwardMessageToSpaceBack } = managerWithSpace();
        const socket = socketWith({ callOnly: true, userId: undefined });

        await socketManager.handlePublicEvent(socket, {
            spaceName: "w.call__x",
            spaceEvent: {},
        } as never);
        await socketManager.handlePrivateEvent(socket, {
            spaceName: "w.call__x",
            receiverUserId: "u_9",
            spaceEvent: {},
        } as never);

        expect(forwardMessageToSpaceBack).toHaveBeenCalledTimes(2);
        expect(forwardMessageToSpaceBack.mock.calls[0][0].publicEvent.senderUserId).toBe("call_1");
        expect(forwardMessageToSpaceBack.mock.calls[1][0].privateEvent.senderUserId).toBe("call_1");
    });

    it("still refuses an ordinary connection that has no user id yet", async () => {
        const { socketManager, forwardMessageToSpaceBack } = managerWithSpace();
        const socket = socketWith({ userId: undefined });
        await expect(
            socketManager.handlePublicEvent(socket, { spaceName: "w.call__x", spaceEvent: {} } as never)
        ).rejects.toThrow("User id not found");
        await expect(
            socketManager.handlePrivateEvent(socket, {
                spaceName: "w.call__x",
                receiverUserId: "u_9",
                spaceEvent: {},
            } as never)
        ).rejects.toThrow("User id not found");
        expect(forwardMessageToSpaceBack).not.toHaveBeenCalled();
    });
});

describe("a call holds its two members through the server, and no third", () => {
    it("refuses a join to a call space that already has its person and its bot", async () => {
        const name = callSpaceName({ botId: "b1", callerUuid: "user-7", callId: "c1" });
        const socketManager = new SocketManager(mock<SpaceConnection>());
        (socketManager as unknown as { spaces: Map<string, unknown> }).spaces.set(`w.${name}`, {
            localName: name,
            filterType: FilterType.ALL_USERS,
            users: new Map([
                ["u_1", {}],
                ["call_1", {}],
            ]),
        });
        // The caller's second tab: allowed by name, but the call is full
        const data = {
            world: "w",
            disconnecting: false,
            userUuid: "user-7",
            userIdentifier: "user-7",
            tags: [] as string[],
            spaceUserId: "u_2",
            spaces: new Set<string>(),
            joinSpacesPromise: new Map<string, Promise<void>>(),
            grantedBubbleSpaces: new Set<string>(),
            megaphoneChannels: new Map<string, boolean>(),
        };
        const socket = { getUserData: () => data } as unknown as Socket;
        await expect(
            socketManager.handleJoinSpace(socket, `w.${name}`, name, FilterType.ALL_USERS, [], {
                signal: new AbortController().signal,
            })
        ).rejects.toBeInstanceOf(SpaceJoinRefusedError);
        expect(data.spaces.size).toBe(0);
    });

    it("counts the sockets it has just taken in, before the back's list of users catches up", async () => {
        const name = callSpaceName({ botId: "b1", callerUuid: "user-7", callId: "c2" });
        const socketManager = new SocketManager(mock<SpaceConnection>());
        // The back has not listed anyone yet, but this pusher already holds the two members
        const space = Object.create(Space.prototype, {
            users: { value: new Map() },
            _localConnectedUser: {
                value: new Map([
                    ["u_1", {}],
                    ["call_1", {}],
                ]),
            },
        });
        (socketManager as unknown as { spaces: Map<string, unknown> }).spaces.set(`w.${name}`, space);
        const data = {
            world: "w",
            disconnecting: false,
            userUuid: "user-7",
            userIdentifier: "user-7",
            tags: [] as string[],
            spaceUserId: "u_2",
            spaces: new Set<string>(),
            joinSpacesPromise: new Map<string, Promise<void>>(),
            grantedBubbleSpaces: new Set<string>(),
            megaphoneChannels: new Map<string, boolean>(),
        };
        const socket = { getUserData: () => data } as unknown as Socket;
        await expect(
            socketManager.handleJoinSpace(socket, `w.${name}`, name, FilterType.ALL_USERS, [], {
                signal: new AbortController().signal,
            })
        ).rejects.toBeInstanceOf(SpaceJoinRefusedError);
    });
});
