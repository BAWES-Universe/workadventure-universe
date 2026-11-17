/**
 * What a live voice call uses goes into Orbit's books (0.5.0 spend caps, gap F4): the audio the hearing took and the seconds of a reply that
 * were played, against the person it was for and whoever paid. Orbit writes each event once under its id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotSpeech } from '../voice/BotSpeech';
import { VoiceMeter, type MeterOrbit, type SpeechEvent } from '../voice/VoiceMeter';
import { VoiceCalls, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ToWorker } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';
import { DEFAULT_REPLY_LIMITS } from '../voice/settings';
import type { SpeakingNow, VoiceSettings } from '../voice/VoiceSettings';

const SPACE = 'proximity-1';
const BOT_SPACE_ID = 'room_9';
const reply = (n: number, player = 7) => `bot-sam-player-${player}-0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => vi.useFakeTimers({ now: Date.parse('2026-11-16T12:00:00.000Z'), toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
afterEach(() => vi.useRealTimers());

/** An Orbit that says yes or no to what it is sent, and remembers every request. */
function orbit(answers: boolean[] = [true]) {
    const requests: SpeechEvent[][] = [];
    const queue = [...answers];
    const fake: MeterOrbit = {
        recordMeterEvents: vi.fn(async (events: SpeechEvent[]) => {
            requests.push(events);
            return queue.length > 1 ? queue.shift()! : queue[0];
        }),
    };
    return { fake, requests };
}

const use = (key: string, over: Partial<Parameters<VoiceMeter['add']>[0]> = {}) => ({ part: 'hearing' as const, key, ms: 2400, who: { userId: 'uuid-sara', isGuest: false }, owner: false, ...over });

describe('the meter: what it writes', () => {
    it('writes one event for a use, in whole seconds rounded up, for the person and who paid, with no price made up', async () => {
        const o = orbit();
        const m = new VoiceMeter('sam', o.fake, undefined, 'r1');
        m.add(use('a', { ms: 2400 }));
        m.add(use('b', { part: 'speaking', ms: 600, who: { userId: 'guest-9', isGuest: true }, owner: true }));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(o.requests).toHaveLength(1);
        expect(o.requests[0]).toEqual([
            expect.objectContaining({ eventId: 'speech:call:sam:r1:hearing:a', kind: 'speech', pool: 'chat', botId: 'sam', userId: 'uuid-sara', isGuest: false, payerKind: 'universe', route: 'universe-ai', quantity: 3, unit: 'second', costMicros: null, basis: 'unknown', detail: { part: 'hearing', source: 'call', ms: 2400 } }),
            expect.objectContaining({ eventId: 'speech:call:sam:r1:speaking:b', userId: 'guest-9', isGuest: true, payerKind: 'person', route: 'own-key', quantity: 1, basis: 'paid_by_other', costMicros: null }),
        ]);
    });

    it('names nobody when the bot does not know who it was for, and books nothing for no audio', async () => {
        const o = orbit();
        const m = new VoiceMeter('sam', o.fake, undefined, 'r1');
        m.add(use('a', { who: null }));
        m.add(use('b', { ms: 0 }));
        m.add(use('c', { ms: Number.NaN }));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(o.requests[0]).toHaveLength(1);
        expect(o.requests[0][0]).not.toHaveProperty('userId');
    });

    it('tells one run of the server from the next: the same turn number after a restart is another event', async () => {
        const o = orbit();
        new VoiceMeter('sam', o.fake, undefined, 'one').add(use('1-1'));
        new VoiceMeter('sam', o.fake, undefined, 'two').add(use('1-1'));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(o.requests.flat().map((event) => event.eventId)).toEqual(['speech:call:sam:one:hearing:1-1', 'speech:call:sam:two:hearing:1-1']);
    });
});

describe('the meter: sending', () => {
    it('sends what gathers in one request after a short wait, and at once when a lot has gathered', async () => {
        const o = orbit();
        const m = new VoiceMeter('sam', o.fake, undefined, 'r1');
        m.add(use('a'));
        m.add(use('b'));
        expect(o.requests).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(o.requests.map((r) => r.length)).toEqual([2]);
        for (let i = 0; i < 50; i++) m.add(use(`n${i}`));
        await vi.advanceTimersByTimeAsync(0);
        expect(o.requests.map((r) => r.length)).toEqual([2, 50]);
    });

    it('keeps what Orbit did not take and sends the same events again after a wait that grows, and never holds anything up', async () => {
        const o = orbit([false, false, true]);
        const logs: string[] = [];
        const m = new VoiceMeter('sam', o.fake, (message) => logs.push(message), 'r1');
        m.add(use('a'));
        await vi.advanceTimersByTimeAsync(5_000);
        expect(o.requests).toHaveLength(1);
        // The first wait is 15 s, then 30 s: nothing is sent in between, however much more gathers
        m.add(use('b'));
        await vi.advanceTimersByTimeAsync(14_000);
        expect(o.requests).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(o.requests).toHaveLength(2);
        expect(o.requests[1].map((e) => e.eventId)).toEqual(['speech:call:sam:r1:hearing:a', 'speech:call:sam:r1:hearing:b']);
        await vi.advanceTimersByTimeAsync(28_000);
        expect(o.requests).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(o.requests).toHaveLength(3);
        expect(o.requests[2].map((e) => e.eventId)).toEqual(['speech:call:sam:r1:hearing:a', 'speech:call:sam:r1:hearing:b']);
        // Taken: nothing is left to send
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(o.requests).toHaveLength(3);
        expect(logs).toHaveLength(2);
    });

    it('treats an Orbit that throws as one that did not answer', async () => {
        const recordMeterEvents = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(true);
        const m = new VoiceMeter('sam', { recordMeterEvents }, undefined, 'r1');
        m.add(use('a'));
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(recordMeterEvents).toHaveBeenCalledTimes(2);
    });

    it('never takes away an event that was not sent when the oldest are dropped for room while a request is out', async () => {
        const sent: string[] = [];
        let answer!: (ok: boolean) => void;
        const gate = new Promise<boolean>((resolve) => (answer = resolve));
        const recordMeterEvents = vi.fn(async (events: SpeechEvent[]) => {
            sent.push(...events.map((e) => e.eventId));
            return sent.length === events.length ? gate : true;
        });
        const m = new VoiceMeter('sam', { recordMeterEvents }, undefined, 'r1');
        m.add(use('first'));
        void m.flush();
        // While Orbit is asked about the first one, more gather than are kept: the first is dropped from the waiting list
        for (let n = 0; n < 1100; n += 1) m.add(use(`k${n}`));
        answer(true);
        await vi.advanceTimersByTimeAsync(60_000);
        await vi.advanceTimersByTimeAsync(60_000);
        // Everything kept was sent after all: the newest 1000, and nothing of them lost to the first one's leaving
        expect(sent).toContain('speech:call:sam:r1:hearing:k1099');
        expect(new Set(sent).size).toBe(1001);
        expect(sent.filter((id) => id.endsWith(':first'))).toHaveLength(1);
    });

    it('sends everything that gathered before the bot is switched off, also what gathered while a request was out and what is more than one request', async () => {
        const sent: string[] = [];
        let answer!: (ok: boolean) => void;
        const gate = new Promise<boolean>((resolve) => (answer = resolve));
        const recordMeterEvents = vi.fn(async (events: SpeechEvent[]) => {
            const first = sent.length === 0;
            sent.push(...events.map((e) => e.eventId));
            return first ? gate : true;
        });
        const m = new VoiceMeter('sam', { recordMeterEvents }, undefined, 'r1');
        m.add(use('first'));
        void m.flush();
        for (let n = 0; n < 130; n += 1) m.add(use(`k${n}`));
        const done = m.shutdown();
        answer(true);
        await done;
        expect(new Set(sent).size).toBe(131);
        m.add(use('late'));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sent).toHaveLength(131);
    });

    it('sends what is left when the bot is switched off, and books nothing after', async () => {
        const o = orbit();
        const m = new VoiceMeter('sam', o.fake, undefined, 'r1');
        m.add(use('a'));
        await m.shutdown();
        expect(o.requests.flat().map((e) => e.eventId)).toEqual(['speech:call:sam:r1:hearing:a']);
        m.add(use('b'));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(o.requests).toHaveLength(1);
    });
});

/** One voice bot on a call, whose hearing and voice are paid by Universe AI or by its maker's own keys. */
function bot(owners: { recognition: boolean; speech: boolean }, options: { withMeter?: boolean } = {}) {
    const sent: ToWorker[] = [];
    let handlers!: LinkHandlers;
    const link: VoiceLink = { isUp: () => true, send: (m) => (sent.push(m), true), close: vi.fn() };
    const game: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT_SPACE_ID : undefined),
        sendSignal: () => undefined,
        sendDisconnect: () => undefined,
        sendStart: () => undefined,
        sendDraft: () => undefined,
        sendStatus: () => undefined,
    };
    const active: SpeakingNow = {
        speaks: true,
        signature: 'one',
        providers: { recognition: { providerId: 'ears', owner: owners.recognition }, speech: { providerId: 'voice', owner: owners.speech } },
        profile: { recognitionModel: 'stt', speechModel: 'tts', voiceId: 'v', expression: 'natural' },
    };
    const settings: VoiceSettings = {
        active: async () => active,
        sessionSettings: async () => ({ recognition: { adapter: 'soniox', model: 'stt', key: 'k1' }, speech: { adapter: 'elevenlabs', model: 'tts', voiceId: 'v', key: 'k2' }, expression: 'natural' }),
        report: () => undefined,
    };
    const calls = new VoiceCalls('sam', game, (h) => ((handlers = h), link), () => undefined, settings);
    calls.playerIdOf = (spaceUserId) => Number(spaceUserId.split('_')[1]) || 0;
    const speech = new BotSpeech(calls, DEFAULT_REPLY_LIMITS);
    calls.onAudience = (space) => speech.audience(space);
    calls.onUnplayed = (space, segmentId) => speech.unplayed(space, segmentId);
    calls.onHeard = (space, segmentId) => speech.heard(space, segmentId);
    calls.onPlayed = (_space, segmentId) => speech.played(segmentId);
    const o = orbit();
    if (options.withMeter !== false) {
        calls.meter = new VoiceMeter('sam', o.fake, undefined, 'r1');
        calls.talkerOf = (playerId) => (playerId === 7 ? { userId: 'uuid-room_7', isGuest: false } : playerId === 8 ? { userId: 'uuid-room_8', isGuest: true } : null);
        calls.playerOfSegment = (segmentId) => speech.playerOfSegment(segmentId);
    }
    const present = new Set<string>();
    return {
        calls, speech, requests: o.requests, sent, link,
        async connect(who = 'room_7') {
            present.add(who);
            calls.spaceUsers(SPACE, [...present].map((id) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id }) as never));
            calls.handlePrivateEvent({
                spaceName: SPACE,
                receiverUserId: BOT_SPACE_ID,
                sender: { spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who },
                spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: who, initiator: false } } },
            } as never);
            await flush();
            const lane = [...sent].reverse().find((m) => m.type === 'lane.open' && m.participantId === who) as Extract<ToWorker, { type: 'lane.open' }>;
            handlers.onMessage({ type: 'participant.join', sessionId: lane.sessionId, participantId: who, epoch: lane.epoch } as FromWorker);
        },
        workerSays(message: object, who = 'room_7') {
            const lane = [...sent].reverse().find((m) => m.type === 'lane.open' && m.participantId === who) as Extract<ToWorker, { type: 'lane.open' }>;
            handlers.onMessage({ sessionId: lane.sessionId, participantId: who, epoch: lane.epoch, turnId: '1-1', ...message } as FromWorker);
        },
        async say(id: string, text = 'An answer.') {
            speech.final(SPACE, id, text);
            await flush();
        },
    };
}

describe('a live call is booked in Orbit', () => {
    it('books the audio the hearing took for each stretch of speech, for the person who spoke, whatever came of the words', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        b.workerSays({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Hello Sam', audioMs: 2300 });
        b.workerSays({ type: 'user.turn', turnId: '1-2', outcome: 'lost', text: 'Hel', reason: 'gap', audioMs: 900 });
        b.workerSays({ type: 'user.turn', turnId: '1-3', outcome: 'cleared', audioMs: 1100 });
        await vi.advanceTimersByTimeAsync(5_000);
        const events = b.requests.flat();
        expect(events.map((e) => [e.detail.part, e.quantity, e.userId, e.isGuest, e.payerKind, e.route])).toEqual([
            ['hearing', 3, 'uuid-room_7', false, 'universe', 'universe-ai'],
            ['hearing', 1, 'uuid-room_7', false, 'universe', 'universe-ai'],
            ['hearing', 2, 'uuid-room_7', false, 'universe', 'universe-ai'],
        ]);
        expect(new Set(events.map((e) => e.eventId)).size).toBe(3);
    });

    it('books the seconds of a reply that were played once it is over, for the person it was written for', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.connect('room_8');
        await b.say(reply(1, 8), 'For the guest.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 1500, totalMs: 4000, finished: false, interrupted: false });
        // Not booked while it plays: only once it is over, and then once
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests).toHaveLength(0);
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 3200, totalMs: 4000, finished: true, interrupted: true, reason: 'barge_in' });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.quantity, e.userId, e.isGuest, e.payerKind])).toEqual([['speaking', 4, 'uuid-room_8', true, 'universe']]);
    });

    it('books the seconds played of a reply the person stopped, or said they were done with, for that person: the worker reports them after the reply was forgotten', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.connect('room_8');
        await b.say(reply(1, 8), 'For the guest.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 1500, totalMs: 4000, finished: false, interrupted: false });
        expect(b.speech.stopReply(SPACE, reply(1, 8))).toBe(true);
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 3000, totalMs: 4000, finished: true, interrupted: true, reason: 'retract' });
        await b.say(reply(2, 7), 'For the member.');
        b.speech.endFor(SPACE, 7);
        b.workerSays({ type: 'playback.progress', segmentId: 's2', playedMs: 2000, totalMs: 4000, finished: true, interrupted: true, reason: 'retract' });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.quantity, e.userId, e.isGuest])).toEqual([
            ['speaking', 3, 'uuid-room_8', true],
            ['speaking', 2, 'uuid-room_7', false],
        ]);
    });

    it('books the seconds played of a reply cut by the end of its call: the worker\u2019s last report arrives after the bubble was forgotten', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.connect('room_8');
        await b.say(reply(1, 8), 'For the guest.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 1500, totalMs: 4000, finished: false, interrupted: false });
        b.calls.spaceLeft(SPACE);
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 2500, totalMs: 4000, finished: true, interrupted: true, reason: 'session_end' }, 'room_8');
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.quantity, e.userId, e.isGuest])).toEqual([['speaking', 3, 'uuid-room_8', true]]);
    });

    it('books hearing for the person who spoke when their audio is reported after they left (and the call ended), as they were when they were here', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        const here = new Set([7]);
        b.calls.talkerOf = (playerId) => (here.has(playerId) ? { userId: `uuid-room_${playerId}`, isGuest: false } : null);
        // They were here when the call opened and when they began to speak
        b.workerSays({ type: 'user.speech_started' });
        here.delete(7);
        b.calls.spaceLeft(SPACE);
        b.workerSays({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Hello Sam', audioMs: 2300 });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.quantity, e.userId, e.isGuest])).toEqual([['hearing', 3, 'uuid-room_7', false]]);
    });

    it('keeps the providers of a session a call still uses, however many newer sessions were opened since', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        const remember = (b.calls as unknown as { rememberSession(id: string, providers: unknown): void }).rememberSession.bind(b.calls);
        const others = { recognition: { providerId: 'x', owner: true }, speech: { providerId: 'y', owner: true } };
        for (let n = 0; n < 80; n += 1) remember(`other-${n}`, others);
        b.workerSays({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Hello Sam', audioMs: 1000 });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.payerKind])).toEqual([['hearing', 'universe']]);
    });

    it('shutting the calls down answers only when what they used was sent to Orbit, so a server being switched off can wait for it', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        let answer!: (ok: boolean) => void;
        const sent: string[] = [];
        b.calls.meter = new VoiceMeter('sam', { recordMeterEvents: async (events) => (sent.push(...events.map((e) => e.eventId)), new Promise<boolean>((resolve) => (answer = resolve))) }, undefined, 'r1');
        b.workerSays({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Hello Sam', audioMs: 1000 });
        let over = false;
        const done = b.calls.shutdown().then(() => (over = true));
        await flush();
        expect(sent).toHaveLength(1);
        expect(over).toBe(false);
        answer(true);
        await done;
        expect(over).toBe(true);
    });

    it('shutting down keeps the worker link open for the last report of a reply that was playing, books it, and only then closes the link', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.say(reply(1), 'Still talking.');
        let over = false;
        const done = b.calls.shutdown().then(() => (over = true));
        await vi.advanceTimersByTimeAsync(200);
        expect(b.sent.some((m) => m.type === 'session.end')).toBe(true);
        expect(b.link.close).not.toHaveBeenCalled();
        expect(over).toBe(false);
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 2500, totalMs: 4000, finished: true, interrupted: true, reason: 'session_end' });
        await done;
        expect(b.link.close).toHaveBeenCalledTimes(1);
        expect(b.requests.flat().map((e) => [e.detail.part, e.quantity])).toEqual([['speaking', 3]]);
    });

    it('shutting down does not wait for ever for a worker that never reports, and closes at once when no reply was playing', async () => {
        const quiet = bot({ recognition: false, speech: false });
        await quiet.connect();
        await quiet.calls.shutdown();
        expect(quiet.link.close).toHaveBeenCalledTimes(1);

        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.say(reply(1), 'Never reported.');
        const done = b.calls.shutdown();
        await vi.advanceTimersByTimeAsync(60_000);
        await done;
        expect(b.link.close).toHaveBeenCalledTimes(1);
    });

    it('shutting down does not wait for a reply of a call that ended long before: its last report was the worker\u2019s answer to that end', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.say(reply(1), 'Queued, never played.');
        b.calls.spaceLeft(SPACE);
        await b.calls.shutdown();
        expect(b.link.close).toHaveBeenCalledTimes(1);
    });

    it('books nothing for a reply of which no moment was heard', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        await b.say(reply(1));
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 0, totalMs: 4000, finished: true, interrupted: true, reason: 'barge_in' });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(b.requests).toHaveLength(0);
    });

    it('says a person’s own key paid, for hearing and for voice, when the maker chose their own providers', async () => {
        const b = bot({ recognition: true, speech: true });
        await b.connect();
        b.workerSays({ type: 'user.turn', outcome: 'final', text: 'Hello', audioMs: 1000 });
        await b.say(reply(1));
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 2000, totalMs: 2000, finished: true, interrupted: false });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.payerKind, e.route, e.basis])).toEqual([
            ['hearing', 'person', 'own-key', 'paid_by_other'],
            ['speaking', 'person', 'own-key', 'paid_by_other'],
        ]);
    });

    it('books hearing and voice on their own payers when only one part is the maker’s', async () => {
        const b = bot({ recognition: true, speech: false });
        await b.connect();
        b.workerSays({ type: 'user.turn', outcome: 'final', text: 'Hello', audioMs: 1000 });
        await b.say(reply(1));
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 2000, totalMs: 2000, finished: true, interrupted: false });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(b.requests.flat().map((e) => [e.detail.part, e.payerKind])).toEqual([
            ['hearing', 'person'],
            ['speaking', 'universe'],
        ]);
    });

    it('still books the audio of someone who left before the worker said it, and counts a late repeat once', async () => {
        const b = bot({ recognition: false, speech: false });
        await b.connect();
        b.workerSays({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Hello', audioMs: 1000 });
        b.workerSays({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Hello', audioMs: 1000 });
        b.calls.spaceUsers(SPACE, []);
        b.workerSays({ type: 'user.turn', turnId: '1-2', outcome: 'final', text: 'Bye', audioMs: 1000 });
        await vi.advanceTimersByTimeAsync(5_000);
        // The same stretch twice has the same id, so Orbit writes it once; it is the id that makes it one
        const ids = b.requests.flat().map((e) => e.eventId);
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(2);
    });

    it('books nothing for a bubble on the worker’s own test engine, or for a bot with no meter', async () => {
        const noMeter = bot({ recognition: false, speech: false }, { withMeter: false });
        await noMeter.connect();
        noMeter.workerSays({ type: 'user.turn', outcome: 'final', text: 'Hello', audioMs: 1000 });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(noMeter.requests).toHaveLength(0);
    });
});
