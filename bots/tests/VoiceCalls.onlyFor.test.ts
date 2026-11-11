/**
 * A reply for one person alone, as the relay hands it to the voice worker (game #1993). A worker that says it can keep
 * a reply to one person is given that person with it. A worker from before speaks to the whole bubble, so it is given
 * such a reply only while its person is alone with the bot, and nothing before the worker has said what it can do.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PrivateEventPusherToFront } from '@workadventure/messages';
import { VoiceCalls, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import { SAY_ONLY_FOR, type FromWorker, type ToWorker } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';

const SPACE = 'proximity-1';
const BOT = 'room_9';
const KHALID = 'room_7';
const SARA = 'room_8';

function setup() {
    const sent: ToWorker[] = [];
    let handlers!: LinkHandlers;
    const link: VoiceLink = { isUp: () => true, send: (message) => (sent.push(message), true), close: vi.fn() };
    const gameSide: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT : undefined),
        sendSignal: () => undefined,
        sendDisconnect: () => undefined,
        sendStart: () => undefined,
        sendDraft: () => undefined,
        sendStatus: () => undefined,
    };
    const calls = new VoiceCalls('bot-1', gameSide, (h) => ((handlers = h), link));
    const start = (sender: string): PrivateEventPusherToFront =>
        ({
            spaceName: SPACE,
            receiverUserId: BOT,
            sender: { spaceUserId: sender, uuid: `uuid-${sender}`, tags: [], name: 'p' },
            spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: sender, initiator: false } } },
        } as unknown as PrivateEventPusherToFront);
    const fromWorker = (m: object) => handlers.onMessage(m as FromWorker);
    const sessionId = () => (sent.find((m) => m.type === 'session.open') as { sessionId: string }).sessionId;
    /** A person's audio connects; the worker has said what it can do first, as it always has by then. */
    const connect = (person: string, features?: string[] | null) => {
        calls.handlePrivateEvent(start(person));
        if (features !== null) fromWorker({ type: 'session.start', sessionId: sessionId(), bubbleId: SPACE, mode: 'talk', engine: { id: 'e', kind: 'ts' }, ...(features ? { features } : {}) });
        const lane = [...sent].reverse().find((m) => m.type === 'lane.open' && m.participantId === person) as { epoch: number };
        fromWorker({ type: 'participant.join', sessionId: sessionId(), participantId: person, epoch: lane.epoch });
    };
    const says = () => sent.filter((m) => m.type === 'bot.say') as Extract<ToWorker, { type: 'bot.say' }>[];
    return { calls, sent, fromWorker, sessionId, connect, says };
}

describe('VoiceCalls: a reply for one person alone', () => {
    it('goes to a worker that keeps it to them with that person on it, whoever else is in the bubble', () => {
        const t = setup();
        t.connect(KHALID, [SAY_ONLY_FOR]);
        t.connect(SARA, [SAY_ONLY_FOR]);
        expect(t.calls.keepsToOne(SPACE)).toBe(true);
        expect(t.calls.sharedWith(SPACE, KHALID)).toBe(false);

        expect(t.calls.say(SPACE, 's1', 'Your interview is at 10.', 60000, KHALID)).toBe(true);
        expect(t.says()).toEqual([{ type: 'bot.say', sessionId: t.sessionId(), segmentId: 's1', text: 'Your interview is at 10.', committed: true, maxMs: 60000, onlyFor: KHALID }]);
    });

    it('leaves a reply for everyone as it was', () => {
        const t = setup();
        t.connect(KHALID, [SAY_ONLY_FOR]);
        expect(t.calls.say(SPACE, 's1', 'The demo is on Sunday.', 60000)).toBe(true);
        expect(t.says()[0]).not.toHaveProperty('onlyFor');
    });

    it('is not said before the worker has said what it can do', () => {
        const t = setup();
        t.connect(KHALID, null);
        t.calls.aloneWith = () => true;
        expect(t.calls.keepsToOne(SPACE)).toBeUndefined();
        expect(t.calls.say(SPACE, 's1', 'Your interview is at 10.', 60000, KHALID)).toBe(false);
        expect(t.says()).toEqual([]);
        // A reply for everyone is said meanwhile, as before
        expect(t.calls.say(SPACE, 's2', 'The demo is on Sunday.', 60000)).toBe(true);
    });

    it('goes to a worker from before only while its person is alone with the bot, and never with them named on it', () => {
        const t = setup();
        let alone = true;
        t.calls.aloneWith = (space, person) => space === SPACE && person === KHALID && alone;
        // No features, or features that do not name it: the worker speaks to the whole bubble
        t.connect(KHALID, ['something.else']);
        expect(t.calls.keepsToOne(SPACE)).toBe(false);

        expect(t.calls.sharedWith(SPACE, KHALID)).toBe(false);
        expect(t.calls.say(SPACE, 's1', 'Your interview is at 10.', 60000, KHALID)).toBe(true);
        expect(t.says()).toHaveLength(1);
        expect(t.says()[0]).not.toHaveProperty('onlyFor');

        // Someone else is there now: it would be heard by them, so it is not said
        alone = false;
        expect(t.calls.sharedWith(SPACE, KHALID)).toBe(true);
        expect(t.calls.say(SPACE, 's2', 'And your salary is 1,200.', 60000, KHALID)).toBe(false);
        expect(t.says()).toHaveLength(1);
        // What is for everyone is still said
        expect(t.calls.say(SPACE, 's3', 'The demo is on Sunday.', 60000)).toBe(true);
    });

    it('is not said by a worker from before when nobody can say whether its person is alone', () => {
        const t = setup();
        t.connect(KHALID);
        expect(t.calls.keepsToOne(SPACE)).toBe(false);
        expect(t.calls.sharedWith(SPACE, KHALID)).toBe(true);
        expect(t.calls.say(SPACE, 's1', 'Your interview is at 10.', 60000, KHALID)).toBe(false);
        expect(t.says()).toEqual([]);
    });

    it('asks again what the worker can do when the bubble\'s audio is set up anew', () => {
        const t = setup();
        t.connect(KHALID, [SAY_ONLY_FOR]);
        expect(t.calls.keepsToOne(SPACE)).toBe(true);
        t.calls.linkDown();
        expect(t.calls.keepsToOne(SPACE)).toBeUndefined();
        expect(t.calls.say(SPACE, 's1', 'Your interview is at 10.', 60000, KHALID)).toBe(false);
    });

    it('waits for its person\'s own audio, not for anyone\'s', () => {
        const t = setup();
        t.connect(SARA, [SAY_ONLY_FOR]);
        expect(t.calls.hasAudience(SPACE)).toBe(true);
        expect(t.calls.hasAudience(SPACE, KHALID)).toBe(false);
        t.connect(KHALID, [SAY_ONLY_FOR]);
        expect(t.calls.hasAudience(SPACE, KHALID)).toBe(true);
    });

    it('tells that a reply was kept quiet when the worker could not keep it to its person, before it is counted as not played', () => {
        const t = setup();
        t.connect(KHALID, [SAY_ONLY_FOR]);
        const told: string[] = [];
        t.calls.onKeptQuiet = (_space, segmentId, heard) => void told.push(`quiet ${segmentId} ${heard ? 'stopped' : 'unsaid'}`);
        t.calls.onUnplayed = (_space, segmentId) => void told.push(`unplayed ${segmentId}`);
        t.calls.onStopped = (_space, segmentId) => void told.push(`talked over ${segmentId}`);

        // Not a moment of it was said
        t.fromWorker({ type: 'playback.progress', sessionId: t.sessionId(), segmentId: 's1', playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'private' });
        // It stopped part-way, as someone came into the room
        t.fromWorker({ type: 'playback.progress', sessionId: t.sessionId(), segmentId: 's2', playedMs: 1200, totalMs: 4000, finished: true, interrupted: true, reason: 'private' });
        // Any other ending says nothing of the kind
        t.fromWorker({ type: 'playback.progress', sessionId: t.sessionId(), segmentId: 's3', playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'retract' });

        expect(told).toEqual(['quiet s1 unsaid', 'unplayed s1', 'quiet s2 stopped', 'unplayed s3']);
        expect(t.calls.stats.keptQuiet).toBe(2);
    });
});
