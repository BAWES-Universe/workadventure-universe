import { describe, expect, it, vi } from "vitest";
import { JoinRoomMessage, PositionMessage_Direction } from "@workadventure/messages";
import type { ConnectCallback, DisconnectCallback } from "../src/Model/GameRoom";
import { GameRoom } from "../src/Model/GameRoom";
import type { Group } from "../src/Model/Group";
import type { User, UserSocket } from "../src/Model/User";
import type { EmoteCallback } from "../src/Model/Zone";
import { socketManager } from "../src/Services/SocketManager";

// map-storage cannot be reached, for instance while it is being redeployed.
vi.mock("../src/Services/MapStorageClient", () => ({
    getMapStorageClient: () => ({
        handleUpdateMapToNewestMessage: (_message: unknown, callback: (err: Error | null) => void) => {
            callback(new Error("14 UNAVAILABLE: No connection established"));
        },
    }),
}));

function createMockUserSocket(): UserSocket {
    return {
        writable: true,
        write: vi.fn(),
    } as unknown as UserSocket;
}

function createJoinRoomMessage(uuid: string, x: number, y: number): JoinRoomMessage {
    return JoinRoomMessage.fromPartial({
        userUuid: uuid,
        IPAddress: "10.0.0.2",
        name: "foo",
        roomId: "https://play.workadventu.re/_/global/localhost/test.json",
        positionMessage: {
            x,
            y,
            direction: PositionMessage_Direction.DOWN,
            moving: false,
        },
    } as const);
}

const emote: EmoteCallback = (emoteEventMessage, listener): void => {};

async function createRoomWithWam(): Promise<GameRoom> {
    const connect: ConnectCallback = (user: User, group: Group): void => {};
    const disconnect: DisconnectCallback = (user: User, group: Group): void => {};
    const room = await GameRoom.create(
        "https://play.workadventu.re/_/global/localhost/test.json",
        connect,
        disconnect,
        160,
        160,
        () => {},
        () => {},
        () => {},
        emote,
        () => {},
        () => {},
        () => {}
    );
    // The room's map is stored in map-storage, so joining asks map-storage for the latest edits.
    (room as unknown as { _wamUrl: string })._wamUrl = "http://map-storage/test.wam";
    return room;
}

describe("SocketManager.handleJoinRoom", () => {
    it("removes the user from the room when map-storage cannot be reached", async () => {
        const room = await createRoomWithWam();
        vi.spyOn(socketManager, "getOrCreateRoom").mockResolvedValue(room);

        // Someone is already standing there.
        const present = await room.join(createMockUserSocket(), createJoinRoomMessage("present", 100, 100));

        // A bot joins right next to them while map-storage is down.
        await expect(
            socketManager.handleJoinRoom(createMockUserSocket(), createJoinRoomMessage("bot", 101, 100))
        ).rejects.toThrow("UNAVAILABLE");

        // The failed join leaves no ghost behind, and no bubble with it.
        expect(room.getUsersByUuid("bot").size).toBe(0);
        expect([...room.getUsers().values()]).toEqual([present]);
        expect(present.group).toBeUndefined();
    });
});
