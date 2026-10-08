/**
 * Summoning a bot goes to where the bot itself sees the player, so a caller can neither name a spot nor call a bot
 * to somebody it cannot see.
 */
import { describe, expect, it } from 'vitest';
import { BotClient } from '../client/BotClient';
import type { BaseBehavior } from '../behaviors/BaseBehavior';

function botThatSees(players: { userId: number; uuid: string; x: number; y: number }[]) {
    const bot = new BotClient({
        botId: 'bot-test',
        name: 'Receptionist',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const uuids = new Map(players.map((player) => [player.userId, player.uuid]));
    bot.setBehavior({
        setBot() {},
        update() {},
        getUserIdForUuid: (uuid: string) => [...uuids].find(([, value]) => value === uuid)?.[0],
    } as unknown as BaseBehavior);
    const known = (bot as unknown as { players: Map<number, unknown> }).players;
    players.forEach((player) =>
        known.set(player.userId, {
            userId: player.userId,
            name: player.uuid,
            position: { x: player.x, y: player.y },
            availabilityStatus: 0,
        })
    );
    return bot;
}

describe('BotClient.getPlayerPositionByUuid', () => {
    it('gives the position the bot sees for that player', () => {
        const bot = botThatSees([{ userId: 7, uuid: 'uuid-7', x: 320, y: 240 }]);
        expect(bot.getPlayerPositionByUuid('uuid-7')).toEqual({ x: 320, y: 240 });
    });

    it('gives nothing for a player the bot has not seen join', () => {
        const bot = botThatSees([{ userId: 7, uuid: 'uuid-7', x: 320, y: 240 }]);
        expect(bot.getPlayerPositionByUuid('uuid-8')).toBeUndefined();
    });

    it('gives nothing while the bot has no real position for the player yet', () => {
        const bot = botThatSees([{ userId: 7, uuid: 'uuid-7', x: 0, y: 0 }]);
        expect(bot.getPlayerPositionByUuid('uuid-7')).toBeUndefined();
    });
});
