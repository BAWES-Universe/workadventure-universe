/**
 * The relay between the game and the voice worker: who may open an audio connection with a voice bot, how late
 * messages are told apart from current ones, and what happens when the worker is not there.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrivateEventPusherToFront } from '@workadventure/messages';
import { VoiceCalls, parseSignal, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ToWorker, VoiceDraft, VoiceStatus } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';

const SPACE = 'proximity-1';
const BOT = 'room_9';
const OFFER = JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' });
const CANDIDATE = JSON.stringify({ type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host', sdpMLineIndex: 0, sdpMid: '0' } });

function setup(options: { up?: boolean } = {}) {
    const sent: ToWorker[] = [];
    const game = { signals: [] as [string, string][], disconnects: [] as string[], starts: [] as string[], drafts: [] as [string, VoiceDraft][], statuses: [] as [string, VoiceStatus][] };
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
        sendDraft: (_space, to, draft) => game.drafts.push([to, draft]),
        sendStatus: (_space, to, status) => game.statuses.push([to, status]),
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
    const mode = (mode: string, sender = 'room_7', extra: { sender?: object; receiver?: string; space?: string } = {}): PrivateEventPusherToFront =>
        ({
            spaceName: extra.space ?? SPACE,
            receiverUserId: extra.receiver ?? BOT,
            sender: { spaceUserId: sender, uuid: `uuid-${sender}`, tags: [], name: 'p', ...extra.sender },
            spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode } } },
        } as unknown as PrivateEventPusherToFront);
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
        calls, sent, game, event, livekit, person, mode,
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

    it('passes the worker\'s request for an audio line on to the person as it is', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        const request = { type: 'transceiverRequest', transceiverRequest: { kind: 'audio', init: { direction: 'recvonly' } } };
        t.fromWorker({ type: 'lane.signal', sessionId, participantId: 'room_7', epoch: 1, signal: request });
        expect(t.game.signals).toEqual([['room_7', JSON.stringify(request)]]);
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

describe('VoiceCalls: what a person says to the bot', () => {
    /** A person in a bubble with a connection: the session id and the epoch the worker will name them by. */
    function talking(options: { room?: boolean } = {}) {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        if (options.room) t.calls.handlePrivateEvent(t.livekit('invite'));
        else t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        const epoch = options.room ? 1 : 1;
        const say = (m: object) => t.fromWorker({ sessionId, participantId: 'room_7', epoch, turnId: '1-1', ...m });
        return { ...t, sessionId, epoch, say };
    }

    it('shows each person their own words as they come, to them only', () => {
        const t = talking();
        t.say({ type: 'user.speech_started' });
        t.say({ type: 'user.partial', text: 'Actually which' });
        t.say({ type: 'user.partial', text: 'Actually which of them' });
        expect(t.game.drafts).toEqual([
            ['room_7', { turnId: '1-1', state: 'live', text: 'Actually which' }],
            ['room_7', { turnId: '1-1', state: 'live', text: 'Actually which of them' }],
        ]);
    });

    it('hands a finished stretch of speech back to the person to send as their own line, and takes it once', () => {
        const t = talking();
        t.say({ type: 'user.turn', outcome: 'final', text: 'Actually which of them replied this week', audioMs: 1800 });
        expect(t.game.drafts).toEqual([['room_7', { turnId: '1-1', state: 'final', text: 'Actually which of them replied this week' }]]);
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', 'Actually which of them replied this week')).toBe('new');
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', 'Actually which of them replied this week')).toBe('duplicate');
    });

    it('takes a line as spoken only when the bot heard those words from that person', () => {
        const t = talking();
        t.say({ type: 'user.turn', outcome: 'final', text: 'hello there', audioMs: 900 });
        // Another person, another turn, other words: an ordinary line
        expect(t.calls.acceptSpoken(SPACE, 'room_8', '1-1', 'hello there')).toBe('unknown');
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-2', 'hello there')).toBe('unknown');
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', 'something else')).toBe('unknown');
        expect(t.calls.acceptSpoken('elsewhere', 'room_7', '1-1', 'hello there')).toBe('unknown');
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', ' hello there ')).toBe('new');
    });

    it('offers back words that did not all come through, and never as a line to send by itself', () => {
        const t = talking();
        t.say({ type: 'user.turn', outcome: 'lost', reason: 'cap', text: 'one two three', audioMs: 180000 });
        expect(t.game.drafts).toEqual([['room_7', { turnId: '1-1', state: 'lost', text: 'one two three', reason: 'cap' }]]);
        // Their own Send of these words is still their line, and still taken once
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', 'one two three')).toBe('new');
    });

    it('clears what was on screen when there is nothing to keep', () => {
        const t = talking();
        t.say({ type: 'user.turn', outcome: 'cleared', audioMs: 300 });
        expect(t.game.drafts).toEqual([['room_7', { turnId: '1-1', state: 'cleared', text: '' }]]);
    });

    it('does not send a finished stretch from a path the bot has since replaced: its words are only offered back', () => {
        const t = talking();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.say({ type: 'user.turn', outcome: 'final', text: 'late words', audioMs: 900 });
        expect(t.game.drafts).toEqual([['room_7', { turnId: '1-1', state: 'lost', text: 'late words', reason: 'path' }]]);
        // Late partials of the old path are dropped
        t.say({ type: 'user.partial', text: 'late' });
        expect(t.game.drafts).toHaveLength(1);
    });

    it('drops what it is told about a person who is not in the bubble, or about a session it does not know', () => {
        const t = talking();
        t.fromWorker({ type: 'user.partial', sessionId: t.sessionId, participantId: 'room_99', epoch: 1, turnId: '1-1', text: 'hi' });
        t.fromWorker({ type: 'user.partial', sessionId: 'other', participantId: 'room_7', epoch: 1, turnId: '1-1', text: 'hi' });
        t.calls.spaceUserLeft(SPACE, 'room_7');
        t.say({ type: 'user.partial', text: 'hi' });
        expect(t.game.drafts).toEqual([]);
    });

    it('shows words heard through the LiveKit room the same way', () => {
        const t = talking({ room: true });
        t.say({ type: 'user.partial', text: 'in the meeting' });
        t.say({ type: 'user.turn', outcome: 'final', text: 'in the meeting room', audioMs: 900 });
        expect(t.game.drafts.map(([to, d]) => [to, d.state])).toEqual([['room_7', 'live'], ['room_7', 'final']]);
    });

    it('gives words back to whoever was mid-sentence when the worker goes away', () => {
        const t = talking();
        t.say({ type: 'user.partial', text: 'Actually which of them' });
        t.workerDown();
        expect(t.game.drafts.at(-1)).toEqual(['room_7', { turnId: '1-1', state: 'lost', text: 'Actually which of them', reason: 'path' }]);
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', 'Actually which of them')).toBe('new');
    });

    it('does not offer back a finished sentence when the worker goes away afterwards', () => {
        const t = talking();
        t.say({ type: 'user.partial', text: 'Actually' });
        t.say({ type: 'user.turn', outcome: 'final', text: 'Actually', audioMs: 400 });
        const shown = t.game.drafts.length;
        t.workerDown();
        expect(t.game.drafts).toHaveLength(shown);
    });

    it('forgets what it heard when the bot leaves the space', () => {
        const t = talking();
        t.say({ type: 'user.turn', outcome: 'final', text: 'hello', audioMs: 400 });
        t.calls.spaceLeft(SPACE);
        expect(t.calls.acceptSpoken(SPACE, 'room_7', '1-1', 'hello')).toBe('unknown');
    });
});

describe('VoiceCalls: how a person chooses to talk with bots (#1666)', () => {
    const modes = (sent: ToWorker[]) => sent.filter((m) => m.type === 'mode.set') as Extract<ToWorker, { type: 'mode.set' }>[];

    it('sets the mode of that person alone, for each of the four modes', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        for (const choice of ['speak_and_read', 'type_and_listen', 'off', 'talk']) t.calls.handlePrivateEvent(t.mode(choice));
        expect(modes(t.sent)).toEqual(
            ['speak_and_read', 'type_and_listen', 'off', 'talk'].map((mode) => ({ type: 'mode.set', sessionId, mode, participantId: 'room_7' }))
        );
    });

    it('takes a choice only from a person talking to this bot in a space it is in', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.calls.handlePrivateEvent(t.mode('off', 'room_3', { sender: { tags: ['bot'] } }));
        t.calls.handlePrivateEvent(t.mode('off', 'room_4', { sender: { uuid: 'bot-abc' } }));
        t.calls.handlePrivateEvent(t.mode('off', BOT));
        t.calls.handlePrivateEvent(t.mode('off', 'room_7', { receiver: 'room_8' }));
        t.calls.handlePrivateEvent(t.mode('off', 'room_7', { space: 'somewhere-else' }));
        expect(modes(t.sent)).toEqual([]);
        expect(t.calls.stats.rejectedFromGame).toBe(5);
    });

    it('refuses a mode that is not one of the four, such as one that only the bot may use', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        for (const choice of ['listen_only', 'loud', '', 'TALK']) t.calls.handlePrivateEvent(t.mode(choice));
        expect(modes(t.sent)).toEqual([]);
        expect(t.calls.stats.rejectedFromGame).toBe(4);
    });

    it('keeps a choice made before the connection opens, and uses it for the connection', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.mode('type_and_listen'));
        expect(modes(t.sent)).toEqual([]);
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        expect(lanes(t.sent)[0]).toMatchObject({ participantId: 'room_7', mode: 'type_and_listen' });
    });

    it('gives each person their own mode, and the default to someone who chose none', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.mode('off', 'room_7'));
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.calls.handlePrivateEvent(t.event('start', 'room_8'));
        expect(lanes(t.sent).map((l) => [l.participantId, l.mode])).toEqual([['room_7', 'off'], ['room_8', 'talk']]);
    });

    it('names each person\'s mode to the worker in a LiveKit room, and keeps it as people come and go', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        t.calls.handlePrivateEvent(t.livekit('invite'));
        t.calls.handlePrivateEvent(t.mode('type_and_listen', 'room_7'));
        t.calls.spaceUserJoined(SPACE, t.person('room_6'));
        const last = t.sent.filter((m) => m.type === 'room.people').at(-1) as Extract<ToWorker, { type: 'room.people' }>;
        expect(Object.fromEntries(last.people.map((p) => [p.participantId, p.mode]))).toEqual({ room_7: 'type_and_listen', room_8: 'talk', room_6: 'talk' });
    });

    it('forgets a person\'s choice when they leave', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7')]);
        t.calls.handlePrivateEvent(t.mode('off', 'room_7'));
        t.calls.spaceUserLeft(SPACE, 'room_7');
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        expect(lanes(t.sent)[0].mode).toBe('talk');
    });
});

describe('VoiceCalls: telling a person where their audio stands (#1666)', () => {
    it('says connecting when a connection starts, on when it is up, and nothing twice', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        t.fromWorker({ type: 'participant.join', sessionId, participantId: 'room_7', epoch: 1 });
        t.fromWorker({ type: 'participant.join', sessionId, participantId: 'room_7', epoch: 1 });
        expect(t.game.statuses).toEqual([['room_7', 'connecting'], ['room_7', 'on']]);
    });

    it('says paused when the worker is not there, or lets go of the connection', () => {
        const t = setup({ up: false });
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        expect(t.game.statuses).toEqual([['room_7', 'paused']]);
        t.setUp(true);
        t.calls.handlePrivateEvent(t.event('start', 'room_8'));
        const sessionId = (t.sent[0] as { sessionId: string }).sessionId;
        t.fromWorker({ type: 'participant.leave', sessionId, participantId: 'room_8', epoch: 1, reason: 'failed' });
        expect(t.game.statuses.slice(1)).toEqual([['room_8', 'connecting'], ['room_8', 'paused']]);
    });

    it('says paused to everyone when the worker goes away, and connecting again when it is back', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7')]);
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.workerDown();
        t.workerUp();
        expect(t.game.statuses.map(([, s]) => s)).toEqual(['connecting', 'paused', 'connecting']);
    });

    it('does not tell a person who ended the connection themselves', () => {
        const t = setup();
        t.calls.handlePrivateEvent(t.event('start', 'room_7'));
        t.calls.handlePrivateEvent(t.event('disconnect', 'room_7'));
        expect(t.game.statuses).toEqual([['room_7', 'connecting']]);
    });

    it('tells everyone about a LiveKit room: connecting, on when joined, paused when it ends, and a late arrival where it stands', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        t.calls.handlePrivateEvent(t.livekit('invite'));
        const room = t.sent.find((m) => m.type === 'room.join') as Extract<ToWorker, { type: 'room.join' }>;
        expect(t.game.statuses).toEqual([['room_7', 'connecting'], ['room_8', 'connecting']]);
        t.fromWorker({ type: 'room.state', sessionId: room.sessionId, epoch: room.epoch, state: 'connected' });
        t.calls.spaceUserJoined(SPACE, t.person('room_6'));
        t.fromWorker({ type: 'room.state', sessionId: room.sessionId, epoch: room.epoch, state: 'failed' });
        expect(t.game.statuses.slice(2)).toEqual([
            ['room_7', 'on'], ['room_8', 'on'],
            ['room_6', 'on'],
            ['room_7', 'paused'], ['room_8', 'paused'], ['room_6', 'paused'],
        ]);
    });

    it('does not tell a bot', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('room_5', { tags: ['bot'] })]);
        t.calls.handlePrivateEvent(t.livekit('invite'));
        expect(t.game.statuses).toEqual([]);
    });
});
