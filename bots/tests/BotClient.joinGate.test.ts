/**
 * Tests for BotClient holding its messages until the server confirms the join.
 *
 * The socket opens before the back has finished joining the room. Anything the back receives meanwhile makes
 * it drop the connection ("The first message sent MUST be of type JoinRoomMessage"), and the bot disappears
 * until someone enters the room again. So the bot:
 *  - sends nothing but pings before roomJoinedMessage;
 *  - sends what it held once joined, in order, with only its latest position;
 *  - starts holding again after a reconnect.
 */
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ClientToServerMessage, PositionMessage_Direction } from '@workadventure/messages';
import { BotClient } from '../client/BotClient';

function botWithFakeSocket() {
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
    const socket = {
        readyState: WebSocket.OPEN,
        send: (data: Uint8Array) => sent.push(ClientToServerMessage.decode(data)),
    };
    (bot as unknown as { ws: unknown }).ws = socket;
    const internals = bot as unknown as {
        send(message: ClientToServerMessage): void;
        markJoined(): void;
    };
    return { bot, internals, sent };
}

const cases = (sent: ClientToServerMessage[]) => sent.map((m) => m.message?.$case);

describe('BotClient join gate', () => {
    it('sends nothing but pings until the join is confirmed', () => {
        const { bot, internals, sent } = botWithFakeSocket();

        bot.sendPosition({ x: 120, y: 100 }, PositionMessage_Direction.RIGHT, true);
        internals.send({ message: { $case: 'followAbortMessage', followAbortMessage: { leader: 1, follower: 0 } } });
        internals.send({ message: { $case: 'pingMessage', pingMessage: {} } });

        expect(cases(sent)).toEqual(['pingMessage']);
    });

    it('sends what it held once joined, keeping only the latest position', () => {
        const { bot, internals, sent } = botWithFakeSocket();

        bot.sendPosition({ x: 120, y: 100 }, PositionMessage_Direction.RIGHT, true);
        internals.send({ message: { $case: 'followAbortMessage', followAbortMessage: { leader: 1, follower: 0 } } });
        bot.sendPosition({ x: 140, y: 100 }, PositionMessage_Direction.RIGHT, false);
        internals.markJoined();

        expect(cases(sent)).toEqual(['followAbortMessage', 'userMovesMessage']);
        const move = sent[1].message;
        expect(move?.$case === 'userMovesMessage' && move.userMovesMessage.position?.x).toBe(140);
    });

    it('sends straight away once joined', () => {
        const { bot, internals, sent } = botWithFakeSocket();
        internals.markJoined();

        bot.sendPosition({ x: 160, y: 100 }, PositionMessage_Direction.DOWN, false);

        expect(cases(sent)).toEqual(['userMovesMessage']);
    });
});
