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
    const name = callSpaceName({ botId: "b1", callerUuid: "user-7", callId: "c1" });

    function joiner(userUuid = "user-7") {
        const data = {
            world: "w",
            disconnecting: false,
            userUuid,
            userIdentifier: userUuid,
            tags: (userUuid.startsWith("bot-") ? ["bot"] : []) as string[],
            spaceUserId: "u_2",
            spaces: new Set<string>(),
            joinSpacesPromise: new Map<string, Promise<void>>(),
            grantedBubbleSpaces: new Set<string>(),
            megaphoneChannels: new Map<string, boolean>(),
        };
        return { data, socket: { getUserData: () => data } as unknown as Socket };
    }

    function heldSocket(userUuid: string) {
        return { getUserData: () => ({ userUuid }) } as unknown as Socket;
    }

    /** A space as this pusher holds it: what the back has listed (it lags), and the sockets taken in here. */
    function spaceWith(listed: string[], local: [string, Socket][]) {
        const registerUser = vi.fn().mockResolvedValue(undefined);
        const space = Object.create(Space.prototype, {
            users: { value: new Map(listed.map((uuid, i) => [`l_${i}`, { uuid }])) },
            _localConnectedUser: { value: new Map(local) },
            filterType: { value: FilterType.ALL_USERS },
            forwarder: { value: { registerUser } },
        });
        return { space, registerUser };
    }

    function manager(space: unknown) {
        const socketManager = new SocketManager(mock<SpaceConnection>());
        (socketManager as unknown as { spaces: Map<string, unknown> }).spaces.set(`w.${name}`, space);
        const leave = vi.spyOn(socketManager, "handleLeaveSpace").mockResolvedValue(undefined);
        const join = (socket: Socket) =>
            socketManager.handleJoinSpace(socket, `w.${name}`, name, FilterType.ALL_USERS, [], {
                signal: new AbortController().signal,
            });
        return { join, leave, socketManager };
    }

    it("refuses a third account, from the back's list of users", async () => {
        // Two other accounts are in: nothing a person can name gets in as a third
        const { space, registerUser } = spaceWith(["account-a", "account-b"], []);
        const { join } = manager(space);
        const { socket, data } = joiner();
        await expect(join(socket)).rejects.toBeInstanceOf(SpaceJoinRefusedError);
        expect(data.spaces.size).toBe(0);
        expect(registerUser).not.toHaveBeenCalled();
    });

    it("counts the sockets it has just taken in, before the back's list of users catches up", async () => {
        const { space, registerUser } = spaceWith(
            [],
            [
                ["a_1", heldSocket("account-a")],
                ["b_1", heldSocket("account-b")],
            ]
        );
        const { join } = manager(space);
        await expect(join(joiner().socket)).rejects.toBeInstanceOf(SpaceJoinRefusedError);
        expect(registerUser).not.toHaveBeenCalled();
    });

    it("lets a person back into their call when the socket they lost is still registered, replacing it", async () => {
        const lost = heldSocket("user-7");
        const { space, registerUser } = spaceWith(
            [],
            [
                ["u_1", lost],
                ["call_1", heldSocket("bot-b1")],
            ]
        );
        const { join, leave } = manager(space);
        const { socket } = joiner("user-7");
        await join(socket);
        expect(leave).toHaveBeenCalledTimes(1);
        expect(leave).toHaveBeenCalledWith(lost, `w.${name}`);
        expect(registerUser).toHaveBeenCalledTimes(1);
    });

    it("does the same for the bot's lost connection, and never replaces another account's socket", async () => {
        const person = heldSocket("user-7");
        const lostBot = heldSocket("bot-b1");
        const { space, registerUser } = spaceWith(
            [],
            [
                ["u_1", person],
                ["call_1", lostBot],
            ]
        );
        const { join, leave } = manager(space);
        const bot = joiner("bot-b1");
        await join(bot.socket);
        expect(leave).toHaveBeenCalledTimes(1);
        expect(leave).toHaveBeenCalledWith(lostBot, `w.${name}`);
        expect(leave).not.toHaveBeenCalledWith(person, expect.anything());
        expect(registerUser).toHaveBeenCalledTimes(1);
    });

    it("joins the space there is after replacing the last socket, never the one that closed with it", async () => {
        const lost = heldSocket("user-7");
        const closing = spaceWith([], [["u_1", lost]]);
        const fresh = spaceWith([], []);
        const { join, leave, socketManager } = manager(closing.space);
        // Leaving the only member closes the space and forgets it; someone has opened it again by the time we go on
        leave.mockImplementation(() => {
            (socketManager as unknown as { spaces: Map<string, unknown> }).spaces.set(`w.${name}`, fresh.space);
            return Promise.resolve();
        });
        await join(joiner("user-7").socket);
        expect(closing.registerUser).not.toHaveBeenCalled();
        expect(fresh.registerUser).toHaveBeenCalledTimes(1);
    });
});
