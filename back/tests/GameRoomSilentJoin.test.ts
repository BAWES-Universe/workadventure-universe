import { describe, expect, it } from "vitest";
import {
    AvailabilityStatus,
    JoinRoomMessage,
    PositionMessage_Direction,
    SetPlayerDetailsMessage,
} from "@workadventure/messages";
import { GameRoom } from "../src/Model/GameRoom";
import type { User, UserSocket } from "../src/Model/User";

// What the server does with the availability status carried by a player's first join. The browser decides that
// status before the map has looked at the spawn tile; if the spawn is in a silent zone, the status must already
// say so, because grouping is decided on the join itself.

async function makeRoom() {
    let connected = 0;
    let disconnected = 0;
    const room = await GameRoom.create(
        "https://play.workadventu.re/_/global/localhost/test.json",
        () => {
            connected++;
        },
        () => {
            disconnected++;
        },
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
    return { room, counts: () => ({ connected, disconnected }) };
}

function join(room: GameRoom, availabilityStatus: AvailabilityStatus, x = 100, y = 100): Promise<User> {
    return room.join(
        {} as unknown as UserSocket,
        JoinRoomMessage.fromPartial({
            userUuid: "uuid",
            IPAddress: "10.0.0.2",
            name: "player",
            roomId: "_/global/test.json",
            availabilityStatus,
            positionMessage: { x, y, direction: PositionMessage_Direction.DOWN, moving: false },
        })
    );
}

describe("joining a room next to another player", () => {
    it("groups a player who joins as online, even if their spawn is in a silent zone", async () => {
        const { room, counts } = await makeRoom();
        await join(room, AvailabilityStatus.ONLINE, 100, 100);

        const spawnedInSilentZone = await join(room, AvailabilityStatus.ONLINE, 110, 100);

        expect(spawnedInSilentZone.group).toBeDefined();
        expect(counts().connected).toBe(2);
    });

    it("keeps a player who joins as silent out of any group", async () => {
        const { room, counts } = await makeRoom();
        await join(room, AvailabilityStatus.ONLINE, 100, 100);

        const spawnedInSilentZone = await join(room, AvailabilityStatus.SILENT, 110, 100);

        expect(spawnedInSilentZone.group).toBeUndefined();
        expect(counts().connected).toBe(0);
    });

    it("does not join an existing group either when the player joins as silent", async () => {
        const { room, counts } = await makeRoom();
        await join(room, AvailabilityStatus.ONLINE, 100, 100);
        await join(room, AvailabilityStatus.ONLINE, 120, 100);
        expect(counts().connected).toBe(2);

        const spawnedInSilentZone = await join(room, AvailabilityStatus.SILENT, 110, 100);

        expect(spawnedInSilentZone.group).toBeUndefined();
        expect(counts().connected).toBe(2);
    });

    it("only drops the group when the silent status arrives after the join", async () => {
        const { room, counts } = await makeRoom();
        await join(room, AvailabilityStatus.ONLINE, 100, 100);
        const late = await join(room, AvailabilityStatus.ONLINE, 110, 100);
        expect(late.group).toBeDefined();

        room.updatePlayerDetails(
            late,
            SetPlayerDetailsMessage.fromPartial({ availabilityStatus: AvailabilityStatus.SILENT })
        );

        expect(late.group).toBeUndefined();
        expect(counts().disconnected).toBeGreaterThan(0);
    });
});
