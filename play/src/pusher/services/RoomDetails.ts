import type { RoomDescription } from "@workadventure/messages";

/** Who is in one open room, for the Discord report (#1389). */
export interface RoomDetails {
    /** People, bots left out (one per open tab or device, as the game's own counts). */
    people: number;
    bots: number;
    /** The people's names as shown in game, one per account, A to Z. */
    names: string[];
}

/** The backs' room descriptions as { [roomUrl]: { people, bots, names } }. */
export function toRoomDetails(rooms: RoomDescription[]): Record<string, RoomDetails> {
    const details: Record<string, RoomDetails> = {};
    for (const room of rooms) {
        const bots = Math.min(room.nbBots, room.nbUsers);
        details[room.roomId] = { people: room.nbUsers - bots, bots, names: room.peopleNames };
    }
    return details;
}
