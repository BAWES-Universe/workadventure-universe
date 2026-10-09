import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerToClientMessage } from "@workadventure/messages";
import { JoinRoomMessage, PositionMessage_Direction } from "@workadventure/messages";
import { FOLLOW_REQUEST_TIMEOUT_MS } from "@workadventure/shared-utils";
import { GameRoom } from "../src/Model/GameRoom";
import type { User, UserSocket } from "../src/Model/User";
import { socketManager } from "../src/Services/SocketManager";

type Write = Mock<(message: ServerToClientMessage) => boolean>;

const writes = new Map<UserSocket, Write>();

function createMockUserSocket(): UserSocket {
    const write: Write = vi.fn();
    const socket = {
        writable: true,
        write,
    } as unknown as UserSocket;
    writes.set(socket, write);
    return socket;
}

function writesOf(user: User): Write {
    const write = writes.get(user.socket);
    if (write === undefined) {
        throw new Error("Not a mock socket");
    }
    return write;
}

function createJoinRoomMessage(uuid: string, x: number, y: number): JoinRoomMessage {
    return JoinRoomMessage.fromPartial({
        userUuid: uuid,
        IPAddress: "10.0.0.2",
        name: uuid,
        roomId: "https://play.workadventu.re/_/global/localhost/test.json",
        positionMessage: {
            x,
            y,
            direction: PositionMessage_Direction.DOWN,
            moving: false,
        },
    } as const);
}

async function createRoom(): Promise<GameRoom> {
    return GameRoom.create(
        "https://play.workadventu.re/_/global/localhost/test.json",
        () => {},
        () => {},
        160,
        160,
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {}
    );
}

/** Three people standing together: one bubble. */
async function createBubble(): Promise<{ room: GameRoom; leader: User; first: User; second: User }> {
    const room = await createRoom();
    const leader = await room.join(createMockUserSocket(), createJoinRoomMessage("leader", 100, 100));
    const first = await room.join(createMockUserSocket(), createJoinRoomMessage("first", 101, 100));
    const second = await room.join(createMockUserSocket(), createJoinRoomMessage("second", 100, 101));
    expect(leader.group).toBeDefined();
    expect(first.group).toBe(leader.group);
    expect(second.group).toBe(leader.group);
    return { room, leader, first, second };
}

function sent(user: User, $case: NonNullable<ServerToClientMessage["message"]>["$case"]): unknown[] {
    return writesOf(user)
        .mock.calls.map(([message]) => message.message)
        .filter((message) => message?.$case === $case);
}

function clearSent(...users: User[]): void {
    for (const user of users) {
        writesOf(user).mockClear();
    }
}

function ask(room: GameRoom, leader: User): void {
    socketManager.handleFollowRequestMessage(room, leader, { leader: leader.id, forceFollow: false });
}

function answerYes(room: GameRoom, follower: User, leader: User): void {
    socketManager.handleFollowConfirmationMessage(room, follower, { leader: leader.id, follower: follower.id });
}

function abort(room: GameRoom, sender: User, leader: User): void {
    socketManager.handleFollowAbortMessage(room, sender, {
        leader: leader.id,
        follower: sender === leader ? 0 : sender.id,
    });
}

describe("SocketManager follow requests", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("asks everyone else in the bubble", async () => {
        const { room, leader, first, second } = await createBubble();
        clearSent(leader, first, second);

        ask(room, leader);

        expect(sent(first, "followRequestMessage")).toEqual([
            { $case: "followRequestMessage", followRequestMessage: { leader: leader.id, forceFollow: false } },
        ]);
        expect(sent(second, "followRequestMessage")).toHaveLength(1);
        expect(sent(leader, "followRequestMessage")).toHaveLength(0);
    });

    it("takes the question away from everyone asked when the leader cancels before anyone answers", async () => {
        const { room, leader, first, second } = await createBubble();
        ask(room, leader);
        clearSent(leader, first, second);

        abort(room, leader, leader);

        const cancelled = { $case: "followAbortMessage", followAbortMessage: { leader: leader.id, follower: 0 } };
        expect(sent(first, "followAbortMessage")).toEqual([cancelled]);
        expect(sent(second, "followAbortMessage")).toEqual([cancelled]);
    });

    it("ignores a yes that arrives after the leader cancelled", async () => {
        const { room, leader, first } = await createBubble();
        ask(room, leader);
        abort(room, leader, leader);
        clearSent(leader, first);

        answerYes(room, first, leader);

        expect(leader.hasFollowers()).toBe(false);
        expect(first.following).toBeUndefined();
        expect(sent(leader, "followConfirmationMessage")).toHaveLength(0);
        // The late answerer is told the request is over, in case their screen already shows them following.
        expect(sent(first, "followAbortMessage")).toEqual([
            { $case: "followAbortMessage", followAbortMessage: { leader: leader.id, follower: 0 } },
        ]);
    });

    it("ignores a yes that arrives after the time is up", async () => {
        vi.useFakeTimers();
        const { room, leader, first } = await createBubble();
        ask(room, leader);

        vi.advanceTimersByTime(FOLLOW_REQUEST_TIMEOUT_MS + 5_000);
        answerYes(room, first, leader);

        expect(leader.hasFollowers()).toBe(false);
        expect(first.following).toBeUndefined();
    });

    it("keeps the request open for the others when one says no", async () => {
        const { room, leader, first, second } = await createBubble();
        ask(room, leader);
        clearSent(leader, first, second);

        abort(room, first, leader);
        expect(sent(leader, "followAbortMessage")).toEqual([
            { $case: "followAbortMessage", followAbortMessage: { leader: leader.id, follower: first.id } },
        ]);

        answerYes(room, second, leader);
        expect(second.following).toBe(leader);
        expect(sent(leader, "followConfirmationMessage")).toHaveLength(1);
    });

    it("lets everyone who said yes go, and tells only those still deciding that it was cancelled", async () => {
        const { room, leader, first, second } = await createBubble();
        ask(room, leader);
        answerYes(room, first, leader);
        clearSent(leader, first, second);

        abort(room, leader, leader);

        expect(first.following).toBeUndefined();
        expect(sent(first, "followAbortMessage")).toEqual([
            { $case: "followAbortMessage", followAbortMessage: { leader: leader.id, follower: first.id } },
        ]);
        expect(sent(second, "followAbortMessage")).toEqual([
            { $case: "followAbortMessage", followAbortMessage: { leader: leader.id, follower: 0 } },
        ]);

        // And a yes from the one still deciding comes too late.
        answerYes(room, second, leader);
        expect(second.following).toBeUndefined();
    });

    it("saying no to one leader does not stop following another", async () => {
        const { room, leader, first, second } = await createBubble();
        ask(room, second);
        answerYes(room, first, second);
        expect(first.following).toBe(second);

        ask(room, leader);
        abort(room, first, leader);

        expect(first.following).toBe(second);
    });
});
