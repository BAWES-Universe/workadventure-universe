/**
 * Whether people (not our own bots) are in a room right now, according to the game's room list.
 *
 * A player's "I walked in" call can arrive a moment before the game lists them in the room, so the list is asked for
 * again a few times before saying no. When the game cannot be asked (the list comes back undefined) it is asked again
 * the same way, and if it still cannot be asked the answer is no: a call from any player must not wake a room's bots
 * without proof that people are in it. Bots already running, and the bots the manager starts itself, are not
 * affected; the next real "I walked in" call tries again.
 */
export async function hasPlayersInRoom(
    fetchRooms: () => Promise<Map<string, number> | undefined>,
    roomId: string,
    ourBotCount: () => number,
    attempts: number,
    delayMs: number
): Promise<boolean> {
    let couldAsk = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const rooms = await fetchRooms();
        if (rooms) {
            couldAsk = true;
            if ((rooms.get(roomId) ?? 0) > ourBotCount()) {
                return true;
            }
        }
        if (attempt < attempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    if (!couldAsk) {
        console.warn(`[BotManager] Could not ask the game who is in room ${roomId}: not waking its bots`);
    }
    return false;
}
