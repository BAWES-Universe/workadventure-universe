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
    const game = { signals: [] as [string, string][], disconnects: [] as string[], starts: [] as string[] };
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
        sendStart: (_space, to) => game.starts.push(to),
    };
    const calls = new VoiceCalls('bot-1', gameSide, (h) => ((handlers = h), link));
    const livekit = (kind: 'invite' | 'leave', extra: { sender?: string; receiver?: string; token?: string; serverUrl?: string; space?: string } = {}): PrivateEventPusherToFront => {
        const inner =
            kind === 'invite'
                ? { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: extra.token ?? 'jwt', serverUrl: extra.serverUrl ?? 'wss://livekit.example' } }
                : { $case: 'livekitDisconnectMessage', livekitDisconnectMessage: {} };
        return {
            spaceName: extra.space ?? SPACE,
            receiverUserId: extra.receiver ?? BOT,
            sender: { spaceUserId: extra.sender ?? BOT, uuid: 'bot-1', tags: ['bot'], name: 'bot' },
            spaceEvent: { event: inner },
        } as unknown as PrivateEventPusherToFront;
    };
    const person = (id: string, extra: object = {}) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id, ...extra } as never);
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
        calls, sent, game, event, livekit, person,
        fromWorker: (m: object) => handlers.onMessage(m as FromWorker),
        workerDown: () => { up = false; handlers.onDown(); },
        workerUp: () => { up = true; handlers.onUp(); },
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

describe('VoiceCalls: errors about a whole bubble', () => {
    it.each(['at_capacity', 'no_session'])('forgets a bubble the worker answered with %s and tells whoever waited to disconnect', (code) => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.calls.handlePrivateEvent(t.event('start', 'room_8'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        t.fromWorker({ type: 'error', sessionId, code, message: 'no' });
        expect(t.game.disconnects.sort()).toEqual(['room_7', 'room_8']);
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(false);
        expect(t.calls.hasCall(SPACE, 'room_8')).toBe(false);
        // A later start opens a new session instead of reusing the dead one
        t.calls.handlePrivateEvent(t.event('start', 'room_6'));
        const opens = t.sent.filter((m) => m.type === 'session.open') as { sessionId: string }[];
        expect(opens).toHaveLength(2);
        expect(opens[1].sessionId).not.toBe(sessionId);
        expect(lanes(t.sent).at(-1)).toMatchObject({ participantId: 'room_6', sessionId: opens[1].sessionId });
    });

    it('leaves the bubble alone for an error that is only about a message', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        t.fromWorker({ type: 'error', sessionId, code: 'invalid_message', message: 'bad' });
        expect(t.game.disconnects).toEqual([]);
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(true);
    });
});

describe('VoiceCalls: a bubble on LiveKit', () => {
    const rooms = (sent: ToWorker[]) => sent.filter((m) => m.type === 'room.join') as Extract<ToWorker, { type: 'room.join' }>[];

    it('joins the room with the bot\'s own token and names the people whose microphone it may take, never a bot', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8'), t.person(BOT, { tags: ['bot'] }), t.person('room_5', { tags: ['bot'] }), t.person('bot-user', { uuid: 'bot-x' })]);
        t.calls.handlePrivateEvent(t.livekit('invite', { token: 'tok-1' }));
        expect(rooms(t.sent)).toHaveLength(1);
        expect(rooms(t.sent)[0]).toMatchObject({ epoch: 1, serverUrl: 'wss://livekit.example', token: 'tok-1' });
        const people = t.sent.find((m) => m.type === 'room.people') as Extract<ToWorker, { type: 'room.people' }>;
        expect(people.epoch).toBe(1);
        expect(people.people.map((p) => p.participantId).sort()).toEqual(['room_7', 'room_8']);
    });

    it('follows people joining and leaving, and ignores a bot that joins', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite'));
        t.calls.spaceUserJoined(SPACE, t.person('room_7'));
        t.calls.spaceUserJoined(SPACE, t.person('room_6', { tags: ['bot'] }));
        t.calls.spaceUserLeft(SPACE, 'room_7');
        const lists = t.sent.filter((m) => m.type === 'room.people') as Extract<ToWorker, { type: 'room.people' }>[];
        expect(lists.map((l) => l.people.map((p) => p.participantId))).toEqual([[], ['room_7'], []]);
    });

    it('only believes an invitation or a disconnect the bot sent to itself', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite', { sender: 'room_7' }));
        t.calls.handlePrivateEvent(t.livekit('invite', { receiver: 'room_8' }));
        t.calls.handlePrivateEvent(t.livekit('invite', { space: 'elsewhere' }));
        expect(rooms(t.sent)).toHaveLength(0);
        expect(t.calls.stats.rejectedFromGame).toBe(3);
        t.calls.handlePrivateEvent(t.livekit('invite'));
        t.calls.handlePrivateEvent(t.livekit('leave', { sender: 'room_7' }));
        expect(t.sent.some((m) => m.type === 'room.leave')).toBe(false);
    });

    it('refuses an invitation that is not a LiveKit address and token', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite', { serverUrl: 'http://evil.example' }));
        t.calls.handlePrivateEvent(t.livekit('invite', { token: '' }));
        t.calls.handlePrivateEvent(t.livekit('invite', { token: 'x'.repeat(9000) }));
        expect(rooms(t.sent)).toHaveLength(0);
    });

    it('moves from peer-to-peer to LiveKit and back with one path at a time, each with a newer epoch', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        expect(lanes(t.sent)[0].epoch).toBe(1);
        t.calls.handlePrivateEvent(t.livekit('invite'));
        const room = rooms(t.sent)[0];
        expect(room.epoch).toBe(2);
        // The call is gone on this side too: a late signal for it is not passed on
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(false);
        const before = t.sent.length;
        t.calls.handlePrivateEvent(t.event('signal', 'room_7', { signal: CANDIDATE }));
        expect(t.sent).toHaveLength(before);
        // Back on peer-to-peer: a newer lane, and the room is forgotten
        t.calls.handlePrivateEvent(t.livekit('leave'));
        expect(t.sent.at(-1)).toMatchObject({ type: 'room.leave', epoch: 2 });
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        expect(lanes(t.sent).at(-1)?.epoch).toBe(3);
        // The worker's late word about the old room is stale
        t.fromWorker({ type: 'room.state', sessionId: room.sessionId, epoch: 2, state: 'closed' });
        expect(t.calls.stats.staleFromWorker).toBe(1);
    });

    it('drops the room when a person starts a peer-to-peer connection instead (the newer path wins)', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite'));
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        const room = rooms(t.sent)[0];
        t.fromWorker({ type: 'room.state', sessionId: room.sessionId, epoch: room.epoch, state: 'closed' });
        expect(t.calls.stats.staleFromWorker).toBe(1);
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(true);
        // No room is re-joined for the next person list
        t.calls.spaceUserJoined(SPACE, t.person('room_8'));
        expect(t.sent.filter((m) => m.type === 'room.people')).toHaveLength(1);
    });

    it('counts a connected room and gives up on one that failed, staying text-only', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite'));
        const room = rooms(t.sent)[0];
        t.fromWorker({ type: 'room.state', sessionId: room.sessionId, epoch: room.epoch, state: 'connected' });
        expect(t.calls.stats.roomsConnected).toBe(1);
        t.fromWorker({ type: 'room.state', sessionId: room.sessionId, epoch: room.epoch, state: 'failed' });
        t.calls.spaceUserJoined(SPACE, t.person('room_8'));
        expect(t.sent.filter((m) => m.type === 'room.people')).toHaveLength(1);
        expect(t.game.disconnects).toEqual([]);
    });

    it('gives up on a room the worker has no room for', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite'));
        const room = rooms(t.sent)[0];
        t.fromWorker({ type: 'error', sessionId: room.sessionId, code: 'at_capacity', message: 'full', epoch: room.epoch });
        t.calls.spaceUserJoined(SPACE, t.person('room_8'));
        expect(t.sent.filter((m) => m.type === 'room.people')).toHaveLength(1);
    });
});

describe('VoiceCalls: the worker comes back', () => {
    it('asks the people who were connected for a new offer, and only those still in the bubble', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.calls.handlePrivateEvent(t.event('start', 'room_8'));
        t.workerDown();
        t.calls.spaceUserLeft(SPACE, 'room_8');
        t.sent.length = 0;
        t.workerUp();
        expect(t.game.starts).toEqual(['room_7']);
        expect(t.sent.map((m) => m.type)).toEqual(['session.open', 'lane.open']);
        expect(lanes(t.sent)[0]).toMatchObject({ participantId: 'room_7' });
        expect(t.calls.hasCall(SPACE, 'room_7')).toBe(true);
        // Its offer is accepted like any other
        t.calls.handlePrivateEvent(t.event('signal', 'room_7'));
        expect(t.sent.at(-1)).toMatchObject({ type: 'lane.signal', participantId: 'room_7' });
    });

    it('does nothing the first time the worker is reached, and nothing for a person who has since left the bot', () => {
        const t = setup({ up: false });
        t.calls.spaceUsers(SPACE, [t.person('room_7')]);
        t.workerUp();
        expect(t.sent).toEqual([]);
        expect(t.game.starts).toEqual([]);
    });

    it('puts the bot back in the room of a bubble that is on LiveKit', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7')]);
        t.calls.handlePrivateEvent(t.livekit('invite', { token: 'tok-1' }));
        t.workerDown();
        expect(t.game.disconnects).toEqual([]);
        t.sent.length = 0;
        t.workerUp();
        expect(t.sent.map((m) => m.type)).toEqual(['session.open', 'room.join', 'room.people']);
        expect(t.sent[1]).toMatchObject({ token: 'tok-1', epoch: 2 });
        expect(t.game.starts).toEqual([]);
    });

    it('does not put the bot back in a room the game has since closed', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.livekit('invite'));
        t.workerDown();
        t.calls.handlePrivateEvent(t.livekit('leave'));
        t.sent.length = 0;
        t.workerUp();
        expect(t.sent).toEqual([]);
    });
});
