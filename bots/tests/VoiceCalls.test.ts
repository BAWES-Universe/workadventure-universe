/**
 * The relay between the game and the voice worker: who may open an audio connection with a voice bot, how late
 * messages are told apart from current ones, and what happens when the worker is not there.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrivateEventPusherToFront } from '@workadventure/messages';
import { VoiceCalls, parseSignal, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ToWorker } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';

const SPACE = 'proximity-1';
const BOT = 'room_9';
const OFFER = JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' });
const CANDIDATE = JSON.stringify({ type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host', sdpMLineIndex: 0, sdpMid: '0' } });

function setup(options: { up?: boolean } = {}) {
    const sent: ToWorker[] = [];
    const game = { signals: [] as [string, string][], disconnects: [] as string[] };
    let up = options.up ?? true;
    let handlers!: LinkHandlers;
    const link: VoiceLink = {
        isUp: () => up,
        send: (message) => {
            if (!up) return false;
            sent.push(message);
            return true;
        },
        close: vi.fn(),
    };
    const gameSide: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT : undefined),
        sendSignal: (_space, to, signal) => game.signals.push([to, signal]),
        sendDisconnect: (_space, to) => game.disconnects.push(to),
    };
    const calls = new VoiceCalls('bot-1', gameSide, (h) => ((handlers = h), link));
    const event = (kind: 'start' | 'signal' | 'disconnect', sender = 'room_7', extra: { signal?: string; sender?: object; receiver?: string; space?: string; startUserId?: string } = {}): PrivateEventPusherToFront => {
        const inner =
            kind === 'start'
                ? { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: extra.startUserId ?? sender, initiator: false } }
                : kind === 'signal'
                ? { $case: 'webRtcSignal', webRtcSignal: { signal: extra.signal ?? OFFER } }
                : { $case: 'webRtcDisconnectMessage', webRtcDisconnectMessage: { userId: sender } };
        return {
            spaceName: extra.space ?? SPACE,
            receiverUserId: extra.receiver ?? BOT,
            sender: { spaceUserId: sender, uuid: `uuid-${sender}`, tags: [], name: 'p', ...extra.sender },
            spaceEvent: { event: inner },
        } as unknown as PrivateEventPusherToFront;
    };
    return {
        calls, sent, game, event,
        fromWorker: (m: object) => handlers.onMessage(m as FromWorker),
        workerDown: () => { up = false; handlers.onDown(); },
        setUp: (v: boolean) => { up = v; },
    };
}

const lanes = (sent: ToWorker[]) => sent.filter((m) => m.type === 'lane.open') as Extract<ToWorker, { type: 'lane.open' }>[];

describe('VoiceCalls: who may open a connection', () => {
    it('opens a bubble and a connection for a person who starts one', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        expect(t.sent[0]).toMatchObject({ type: 'session.open', botId: 'bot-1', bubbleId: SPACE });
        expect(t.sent[1]).toMatchObject({ type: 'lane.open', participantId: 'room_7', epoch: 1, mode: 'talk' });
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(true);
    });

    it('never opens one for a bot, whatever its tag or uuid says', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_3', { sender: { tags: ['bot'] } }));
        t.calls.handlePrivateEvent(t.event('start', 'room_4', { sender: { uuid: 'bot-abc' } }));
        t.calls.handlePrivateEvent(t.event('start', 'room_5', { sender: { tags: ['bot', 'voice-bot'], uuid: 'bot-xyz' } }));
        expect(t.sent).toEqual([]);
        expect(t.calls.stats.rejectedFromGame).toBe(3);
    });

    it('ignores events addressed to someone else, from the bot itself, or in a space the bot is not in', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7', { receiver: 'room_8' }));
        t.calls.handlePrivateEvent(t.event('start', BOT));
        t.calls.handlePrivateEvent(t.event('start', 'room_7', { space: 'somewhere-else' }));
        expect(t.sent).toEqual([]);
    });

    it('ignores a start whose user is not the person it came from', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7', { startUserId: 'room_8' }));
        expect(t.sent).toEqual([]);
    });

    it('ignores screen-sharing signals and events with no content', () => {
        const t = setup();
        t.calls.handlePrivateEvent({ ...t.event('start'), spaceEvent: { event: { $case: 'webRtcScreenSharingSignal', webRtcScreenSharingSignal: { signal: OFFER } } } } as never);
        t.calls.handlePrivateEvent({ ...t.event('start'), spaceEvent: undefined } as never);
        expect(t.sent).toEqual([]);
    });
});

describe('VoiceCalls: signals and epochs', () => {
    it('passes a person\'s offer and candidates to the worker with the epoch of their connection', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.handlePrivateEvent(t.event('signal', 'room_7', { signal: OFFER }));
        t.calls.handlePrivateEvent(t.event('signal', 'room_7', { signal: CANDIDATE }));
        const signals = t.sent.filter((m) => m.type === 'lane.signal') as Extract<ToWorker, { type: 'lane.signal' }>[];
        expect(signals.map((s) => [s.signal.type, s.epoch])).toEqual([['offer', 1], ['candidate', 1]]);
    });

    it('rejects a signal that comes before any start, or after the connection ended', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('signal'));
        expect(t.sent).toEqual([]);
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.handlePrivateEvent(t.event('disconnect'));
        const before = t.sent.length;
        t.calls.handlePrivateEvent(t.event('signal'));
        expect(t.sent.length).toBe(before);
        expect(t.calls.stats.rejectedFromGame).toBe(2);
    });

    it('numbers a new connection with the same person higher, and uses it from then on', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.handlePrivateEvent(t.event('start'));
        expect(lanes(t.sent).map((l) => l.epoch)).toEqual([1, 2]);
        t.calls.handlePrivateEvent(t.event('signal'));
        expect((t.sent.at(-1) as { epoch: number }).epoch).toBe(2);
    });

    it('drops what the worker says about an older epoch, and about a person it does not know', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.handlePrivateEvent(t.event('start'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        const answer = { type: 'answer', sdp: 'x' };
        t.fromWorker({ type: 'lane.signal', sessionId, participantId: 'room_7', epoch: 1, signal: answer });
        t.fromWorker({ type: 'lane.signal', sessionId, participantId: 'room_99', epoch: 1, signal: answer });
        t.fromWorker({ type: 'lane.signal', sessionId: 'other', participantId: 'room_7', epoch: 2, signal: answer });
        expect(t.game.signals).toEqual([]);
        expect(t.calls.stats.staleFromWorker).toBe(3);
        t.fromWorker({ type: 'lane.signal', sessionId, participantId: 'room_7', epoch: 2, signal: answer });
        expect(t.game.signals).toEqual([['room_7', JSON.stringify(answer)]]);
    });

    it('does not pass on anything but an offer or an ICE candidate', () => {
        expect(parseSignal(OFFER)).toMatchObject({ type: 'offer' });
        expect(parseSignal(CANDIDATE)).toMatchObject({ type: 'candidate' });
        expect(parseSignal(JSON.stringify({ type: 'answer', sdp: 'x' }))).toBeNull();
        expect(parseSignal(JSON.stringify({ type: 'renegotiate', renegotiate: true }))).toBeNull();
        expect(parseSignal(JSON.stringify({ type: 'offer', sdp: '' }))).toBeNull();
        expect(parseSignal(JSON.stringify({ type: 'offer', sdp: 'x'.repeat(70000) }))).toBeNull();
        expect(parseSignal('not json')).toBeNull();
        expect(parseSignal('null')).toBeNull();
    });
});

describe('VoiceCalls: ending and failing closed', () => {
    it('closes the worker\'s connection when the person disconnects, and the bubble when the bot leaves the space', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.handlePrivateEvent(t.event('disconnect'));
        expect(t.sent.at(-1)).toMatchObject({ type: 'lane.close', participantId: 'room_7', epoch: 1 });
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(false);
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.spaceLeft(SPACE);
        expect(t.sent.slice(-2).map((m) => m.type)).toEqual(['lane.close', 'session.end']);
    });

    it('tells the person to disconnect and stays text-only when the worker is not there', () => {
        const t = setup({ up: false });
        t.calls.handlePrivateEvent(t.event('start'));
        expect(t.sent).toEqual([]);
        expect(t.game.disconnects).toEqual(['room_7']);
        expect(t.calls.stats.refusedStart).toBe(1);
    });

    it('tells everyone to disconnect when the worker goes away mid-call, and starts again when it is back', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.calls.handlePrivateEvent(t.event('start', 'room_8'));
        t.workerDown();
        expect(t.game.disconnects.sort()).toEqual(['room_7', 'room_8']);
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(false);
        t.setUp(true);
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        // The worker forgot the bubble: it is opened again
        expect(t.sent.filter((m) => m.type === 'session.open')).toHaveLength(2);
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(true);
    });

    it('lets go of a connection the worker has no room for', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        t.fromWorker({ type: 'error', sessionId, code: 'at_capacity', message: 'full', participantId: 'room_7', epoch: 1 });
        expect(t.game.disconnects).toEqual(['room_7']);
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(false);
    });

    it('shuts everything down when the bot goes', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        t.calls.shutdown();
        expect(t.game.disconnects).toEqual(['room_7']);
        expect(t.sent.at(-1)).toMatchObject({ type: 'session.end' });
    });
});
