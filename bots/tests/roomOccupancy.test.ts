import { describe, expect, it, vi } from 'vitest';
import { hasPlayersInRoom } from '../server/roomOccupancy';

function ask(rooms: (Map<string, number> | undefined)[], botsInRoom = 0) {
    const fetchRooms = vi.fn();
    rooms.forEach((answer) => fetchRooms.mockResolvedValueOnce(answer));
    return {
        fetchRooms,
        run: () => hasPlayersInRoom(fetchRooms, 'room-1', () => botsInRoom, 3, 1),
    };
}

describe('hasPlayersInRoom', () => {
    it('is true when the game lists more people in the room than our own bots', async () => {
        expect(await ask([new Map([['room-1', 3]])], 2).run()).toBe(true);
    });

    it('is false for a room nobody is in, or only our bots, after asking again', async () => {
        const { run, fetchRooms } = ask([new Map(), new Map([['room-1', 2]]), new Map()], 2);
        expect(await run()).toBe(false);
        expect(fetchRooms).toHaveBeenCalledTimes(3);
    });

    it('waits for a player the game has not listed yet', async () => {
        const { run, fetchRooms } = ask([new Map(), new Map([['room-1', 1]])]);
        expect(await run()).toBe(true);
        expect(fetchRooms).toHaveBeenCalledTimes(2);
    });

    it('says no when the game cannot be asked at all, so nobody wakes a room\'s bots without proof', async () => {
        const { run, fetchRooms } = ask([undefined, undefined, undefined]);
        expect(await run()).toBe(false);
        expect(fetchRooms).toHaveBeenCalledTimes(3);
    });

    it('asks again after a hiccup and then says yes when the game lists the player', async () => {
        const { run, fetchRooms } = ask([undefined, new Map([['room-1', 1]])]);
        expect(await run()).toBe(true);
        expect(fetchRooms).toHaveBeenCalledTimes(2);
    });
});
