/**
 * Tests for BotClient standing still after the bot editor switches its behavior or moves it.
 *
 * Players' clients extrapolate a remote player that is marked as moving, and play its walk animation.
 * A bot left "moving" by its previous behavior (idle never calls stop()) walked in place forever, and
 * overshot every spot the editor dropped it on.
 */
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ClientToServerMessage, PositionMessage_Direction } from '@workadventure/messages';
import { BotClient } from '../client/BotClient';
import type { BaseBehavior } from '../behaviors/BaseBehavior';
import { IdleBehavior } from '../behaviors/IdleBehavior';

function joinedBotWithFakeSocket() {
    const bot = new BotClient({
        botId: 'bot-test',
        name: 'Receptionist',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const sent: ClientToServerMessage[] = [];
    (bot as unknown as { ws: unknown }).ws = {
        readyState: WebSocket.OPEN,
        send: (data: Uint8Array) => sent.push(ClientToServerMessage.decode(data)),
    };
    (bot as unknown as { markJoined(): void }).markJoined();
    (bot as unknown as { connected: boolean }).connected = true;
    return { bot, sent };
}

class FakeWalking {
    userIdToUuid = new Map();
    userIdToIsLogged = new Map();
    setBot() {}
    update() {}
    lookAtPassersBy() {}
    carryLookFrom() {}
    carryPeopleFrom() {}
    getConfiguredFacing() {
        return null;
    }
}
class FakeIdle {
    userIdToUuid = new Map();
    userIdToIsLogged = new Map();
    setBot() {}
    update() {}
    lookAtPassersBy() {}
    carryLookFrom() {}
    carryPeopleFrom() {}
    getConfiguredFacing() {
        return null;
    }
}

function fakeBehavior(kind: typeof FakeWalking | typeof FakeIdle = FakeWalking): BaseBehavior {
    return new kind() as unknown as BaseBehavior;
}

function moves(sent: ClientToServerMessage[]) {
    return sent.flatMap((m) => (m.message?.$case === 'userMovesMessage' ? [m.message.userMovesMessage.position] : []));
}

describe('BotClient stops when the editor changes it', () => {
    it('stands still facing down when its behavior is replaced mid-walk', () => {
        const { bot, sent } = joinedBotWithFakeSocket();
        bot.setBehavior(fakeBehavior());
        bot.getState().setMoving(true);
        bot.getState().setDirection(PositionMessage_Direction.UP);

        bot.setBehavior(fakeBehavior(FakeIdle));
        bot.update(16);

        expect(bot.getState().isMoving()).toBe(false);
        expect(moves(sent)).toEqual([
            expect.objectContaining({ x: 100, y: 100, moving: false, direction: PositionMessage_Direction.DOWN }),
        ]);
    });

    it('keeps walking when a config change rebuilds the same kind of behavior', () => {
        const { bot, sent } = joinedBotWithFakeSocket();
        bot.setBehavior(fakeBehavior());
        bot.getState().setMoving(true);

        bot.setBehavior(fakeBehavior());

        expect(bot.getState().isMoving()).toBe(true);
        expect(moves(sent)).toEqual([]);
    });

    it('teleports without a follow-up "moving" update at the new spot', () => {
        const { bot, sent } = joinedBotWithFakeSocket();
        bot.setBehavior(fakeBehavior());
        bot.getState().setMoving(true);

        bot.teleportTo(300, 200);
        bot.update(16);

        expect(bot.getIsFollowingPath()).toBe(false);
        expect(moves(sent)).toEqual([expect.objectContaining({ x: 300, y: 200, moving: false })]);
    });
});

describe('BotClient faces its default direction', () => {
    const stayBehavior = (facing?: string) =>
        new IdleBehavior({ type: 'idle', moves: 'stay', facing, responseRadius: 100, greetingMessages: [] } as any);

    it('turns to face the configured direction when a walking bot is switched to stay', () => {
        const { bot, sent } = joinedBotWithFakeSocket();
        bot.setBehavior(fakeBehavior());
        bot.getState().setMoving(true);

        bot.setBehavior(stayBehavior('up'));

        expect(bot.getState().getDirection()).toBe(PositionMessage_Direction.UP);
        expect(moves(sent)).toEqual([
            expect.objectContaining({ x: 100, y: 100, moving: false, direction: PositionMessage_Direction.UP }),
        ]);
    });

    it('turns right away when a config change rebuilds the stay behavior with a new facing', () => {
        const { bot, sent } = joinedBotWithFakeSocket();
        bot.setBehavior(stayBehavior('down'));

        bot.setBehavior(stayBehavior('left'));

        expect(bot.getState().getDirection()).toBe(PositionMessage_Direction.LEFT);
        expect(moves(sent)).toEqual([expect.objectContaining({ moving: false, direction: PositionMessage_Direction.LEFT })]);
    });

    it('faces the configured direction from the first update after it spawns', () => {
        const { bot, sent } = joinedBotWithFakeSocket();

        bot.setBehavior(stayBehavior('right'));
        bot.update(16);

        expect(moves(sent)).toEqual([expect.objectContaining({ direction: PositionMessage_Direction.RIGHT })]);
    });

    it('faces down when a stay bot has no facing saved, as the editor shows', () => {
        const { bot } = joinedBotWithFakeSocket();
        bot.setBehavior(stayBehavior());
        bot.getState().setDirection(PositionMessage_Direction.UP);
        bot.setBehavior(stayBehavior());
        expect(bot.getState().getDirection()).toBe(PositionMessage_Direction.DOWN);
    });

    it('leaves a bot that is still walking, or has someone in sight, as it was', () => {
        const { bot, sent } = joinedBotWithFakeSocket();
        bot.setBehavior(stayBehavior('up'));
        bot.getState().setDirection(PositionMessage_Direction.UP);

        bot.getState().setMoving(true);
        bot.setBehavior(stayBehavior('left'));
        expect(bot.getState().getDirection()).toBe(PositionMessage_Direction.UP);

        // Someone 4.5 tiles away, who it may be looking at
        bot.getState().setMoving(false);
        (bot as unknown as { players: Map<number, unknown> }).players.set(2, { userId: 2, position: { x: 244, y: 100 } });
        bot.setBehavior(stayBehavior('left'));
        expect(bot.getState().getDirection()).toBe(PositionMessage_Direction.UP);
        expect(moves(sent)).toEqual([]);
    });

    it('keeps watching the person the old behavior watched when a config change rebuilds it', () => {
        const { bot } = joinedBotWithFakeSocket();
        const before = stayBehavior('up');
        bot.setBehavior(before);
        (before as unknown as { lookingAtPlayerId: number }).lookingAtPlayerId = 2;

        const after = stayBehavior('left');
        bot.setBehavior(after);
        expect((after as unknown as { lookingAtPlayerId: number }).lookingAtPlayerId).toBe(2);
    });
});
