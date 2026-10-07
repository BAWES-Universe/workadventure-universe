/**
 * Whether people (not our own bots) are in a room right now, according to the game's room list.
 *
 * A player's "I walked in" call can arrive a moment before the game lists them in the room, so the list is asked for
 * again a few times before saying no. When the game cannot be asked at all (the list comes back undefined) the answer
 * is yes, so a hiccup of the game server never stops bots.
 */
export async function hasPlayersInRoom(
    fetchRooms: () => Promise<Map<string, number> | undefined>,
    roomId: string,
    ourBotCount: () => number,
    attempts: number,
    delayMs: number
): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const rooms = await fetchRooms();
        if (!rooms) {
            return true;
        }
        if ((rooms.get(roomId) ?? 0) > ourBotCount()) {
            return true;
        }
        if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    return false;
}
