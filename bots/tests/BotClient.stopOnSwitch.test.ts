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
    setBot() {}
    update() {}
}
class FakeIdle {
    setBot() {}
    update() {}
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
