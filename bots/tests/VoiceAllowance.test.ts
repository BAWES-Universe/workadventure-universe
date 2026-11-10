/**
 * Voice inside the Universe AI allowance (#1669). A spoken reply that Universe AI pays for comes out of the person's 5-hour window,
 * which keeps some replies for text and gives a guest few. Orbit counts; these tests check what the bot server does with its answer:
 * the reply stays in text, that person's button shows paused, one fixed line says so (once), and voice comes back by itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotSpeech } from '../voice/BotSpeech';
import { OrbitTurnGate, pausedLine, type AllowanceOrbit } from '../voice/VoiceAllowance';
import { VoiceCalls, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ToWorker } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';
import { DEFAULT_REPLY_LIMITS } from '../voice/settings';
import type { ActiveVoice, SpeakingNow, VoiceSettings } from '../voice/VoiceSettings';

const SPACE = 'proximity-1';
const BOT_SPACE_ID = 'room_9';
const OFFER = JSON.stringify({ type: 'offer', sdp: 'v=0\r\n' });
const reply = (n: number, player = 7) => `bot-sam-player-${player}-0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

const speakingNow = (owners: { recognition: boolean; speech: boolean }): SpeakingNow => ({
    speaks: true,
    signature: 'one',
    providers: { recognition: { providerId: 'ears', owner: owners.recognition }, speech: { providerId: 'voice', owner: owners.speech } },
    profile: { recognitionModel: 'stt', speechModel: 'tts', voiceId: 'v', expression: 'natural' },
});

type Answer = Awaited<ReturnType<AllowanceOrbit['checkVoiceAllowance']>>;

/** One voice bot whose voice Universe AI (or its maker) pays for, with Orbit's allowance answers scripted. */
function bot(options: { owners?: { recognition: boolean; speech: boolean }; people?: Record<number, { userId: string; isGuest: boolean }> } = {}) {
    const owners = options.owners ?? { recognition: false, speech: false };
    const people = options.people ?? { 7: { userId: 'uuid-room_7', isGuest: false } };
    const sent: ToWorker[] = [];
    const statuses: string[] = [];
    /** What each status told the person they have left, as "person:status:count|time" (only the ones that said). */
    const lefts: string[] = [];
    const lines: string[] = [];
    const logs: string[] = [];
    let handlers!: LinkHandlers;
    const link: VoiceLink = { isUp: () => true, send: (m) => (sent.push(m), true), close: vi.fn() };
    const game: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT_SPACE_ID : undefined),
        sendSignal: () => undefined,
        sendDisconnect: () => undefined,
        sendStart: () => undefined,
        sendDraft: () => undefined,
        sendStatus: (_space, to, status, left) => {
            statuses.push(`${to}:${status}`);
            if (left) lefts.push(`${to}:${status}:${left.count}|${left.resetsAt ?? ''}`);
        },
    };
    const state = {
        active: speakingNow(owners) as ActiveVoice,
        answers: [] as Answer[],
        fallback: { allowed: true } as Answer,
        /** What Orbit says someone has left when asked with nothing counted. */
        left: { left: 25, resetsAt: null } as { left: number | null; resetsAt: string | null } | null,
    };
    const settings: VoiceSettings = {
        active: async () => state.active,
        sessionSettings: async () => ({
            recognition: { adapter: 'soniox', model: 'stt', key: 'k1' },
            speech: { adapter: 'elevenlabs', model: 'tts', voiceId: 'v', key: 'k2' },
            expression: 'natural',
        }),
        report: () => undefined,
    };
    const orbit = {
        checkVoiceAllowance: vi.fn(async (_botId: string, _input: { userId: string; isGuest: boolean; turnId: string }) => (state.answers.length ? state.answers.shift()! : state.fallback)),
        releaseVoiceReply: vi.fn(async (_botId: string, _input: { turnId: string }): Promise<boolean | null> => true),
        voiceRepliesLeft: vi.fn(async (_botId: string, _input: { userId: string; isGuest: boolean }): Promise<{ left: number | null; resetsAt: string | null } | null> => state.left),
    };
    const gate = new OrbitTurnGate('sam', orbit, (playerId) => people[playerId] ?? null, (m) => logs.push(m), async () => undefined);
    const calls = new VoiceCalls('sam', game, (h) => ((handlers = h), link), (m) => logs.push(m), settings, gate);
    calls.playerIdOf = (spaceUserId) => Number(spaceUserId.split('_')[1]) || 0;
    calls.onPaused = (space) => lines.push(`${space}:${pausedLine('Sam')}`);
    const speech = new BotSpeech(calls, DEFAULT_REPLY_LIMITS);
    calls.onAudience = (space) => speech.audience(space);
    calls.onUnplayed = (space, segmentId) => speech.unplayed(space, segmentId);
    calls.onHeard = (space, segmentId) => speech.heard(space, segmentId);
    calls.onSessionEnded = (space) => speech.sessionEnded(space);
    /** Everyone who has connected, as the space lists them. */
    const present = new Set<string>();
    const t = {
        sent, statuses, lefts, lines, logs, orbit, state, calls, speech,
        says: () => (sent.filter((m) => m.type === 'bot.say') as Extract<ToWorker, { type: 'bot.say' }>[]).map((m) => m.text),
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
        /** The worker says the person's audio is connected again (a reconnect). */
        rejoin(who = 'room_7') {
            const lane = [...sent].reverse().find((m) => m.type === 'lane.open') as Extract<ToWorker, { type: 'lane.open' }>;
            handlers.onMessage({ type: 'participant.join', sessionId: lane.sessionId, participantId: who, epoch: lane.epoch } as FromWorker);
        },
        /** Something the worker reports about the person's audio session. */
        workerSays(message: object, who = 'room_7') {
            const lane = [...sent].reverse().find((m) => m.type === 'lane.open') as Extract<ToWorker, { type: 'lane.open' }>;
            handlers.onMessage({ sessionId: lane.sessionId, participantId: who, epoch: lane.epoch, turnId: '1-1', ...message } as FromWorker);
        },
        async say(id: string, text = 'An answer.') {
            speech.final(SPACE, id, text);
            await flush();
        },
    };
    return t;
}

afterEach(() => vi.restoreAllMocks());

describe('a reply that Universe AI pays for', () => {
    it('is asked of the allowance under its own turn id, for the person it is for, and spoken when allowed', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Hello there.');
        expect(b.orbit.checkVoiceAllowance).toHaveBeenCalledWith('sam', { userId: 'uuid-room_7', isGuest: false, turnId: reply(1) });
        expect(b.says()).toEqual(['Hello there.']);
        expect(b.lines).toEqual([]);
    });

    it('stays in text when the allowance is used up: that person sees paused, one line says so, nothing is said', async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = { allowed: false, resetsAt: '2026-11-02T13:00:00.000Z' };
        await b.say(reply(1));
        expect(b.says()).toEqual([]);
        expect(b.statuses).toContain('room_7:paused');
        expect(b.lines).toEqual([`${SPACE}:Voice is paused for now. Keep typing: Sam still answers here.`]);
        // The session was not touched: the person stays connected and the chat carries on
        expect(b.sent.filter((m) => m.type === 'session.end' || m.type === 'lane.close')).toEqual([]);
    });

    it('says the line once however many replies are turned down, and the button comes back when voice speaks again', async () => {
        const b = bot();
        await b.connect();
        b.state.answers = [{ allowed: false, resetsAt: 'x' }, { allowed: false, resetsAt: 'x' }];
        await b.say(reply(1));
        await b.say(reply(2));
        expect(b.lines).toHaveLength(1);
        expect(b.says()).toEqual([]);

        // A later turn (the window ended) is allowed: voice speaks by itself and the button is put back
        b.state.fallback = { allowed: true };
        await b.say(reply(3), 'Back again.');
        expect(b.says()).toEqual(['Back again.']);
        expect(b.statuses.slice(-1)).toEqual(['room_7:on']);

        // Paused again later: the line is said again, once
        b.state.answers = [{ allowed: false, resetsAt: 'x' }];
        await b.say(reply(4));
        expect(b.lines).toHaveLength(2);
    });

    it('puts the button back to paused when a reconnect has set it to on, without saying the line again', async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = { allowed: false, resetsAt: 'x' };
        await b.say(reply(1));
        // The person's audio connects again: their button is on
        b.rejoin();
        expect(b.statuses.slice(-1)).toEqual(['room_7:on']);
        await b.say(reply(2));
        expect(b.statuses.slice(-1)).toEqual(['room_7:paused']);
        expect(b.lines).toHaveLength(1);
    });

    it('is only held back for the person whose allowance is used: another person in the bubble keeps hearing the bot', async () => {
        const b = bot({ people: { 7: { userId: 'uuid-room_7', isGuest: false }, 8: { userId: 'uuid-room_8', isGuest: true } } });
        await b.connect();
        b.state.answers = [{ allowed: false, resetsAt: 'x' }, { allowed: true }];
        await b.say(reply(1, 8));
        await b.say(reply(2, 7), 'For Sara.');
        expect(b.says()).toEqual(['For Sara.']);
        expect(b.orbit.checkVoiceAllowance.mock.calls.map(([, input]) => [input.userId, input.isGuest])).toEqual([['uuid-room_8', true], ['uuid-room_7', false]]);
    });

    describe('what they say out loud once their spoken replies are used up', () => {
        const modeSets = (b: ReturnType<typeof bot>) => b.sent.filter((m) => m.type === 'mode.set') as Extract<ToWorker, { type: 'mode.set' }>[];
        const lastMode = (b: ReturnType<typeof bot>, who: string) => modeSets(b).filter((m) => m.participantId === who).at(-1)?.mode;

        it('is no longer taken from their microphone, so it cannot turn into text replies that spend the ones kept for typing', async () => {
            const b = bot();
            await b.connect();
            b.state.answers = [{ allowed: false, resetsAt: '2999-01-01T00:00:00.000Z' }];
            await b.say(reply(1));
            expect(lastMode(b, 'room_7')).toBe('type_and_listen');
        });

        it('holds speak-and-read back to text only, and keeps the hold when their audio connects again', async () => {
            const b = bot();
            b.calls.handlePrivateEvent({
                spaceName: SPACE,
                receiverUserId: BOT_SPACE_ID,
                sender: { spaceUserId: 'room_7', uuid: 'uuid-room_7', tags: [], name: 'room_7' },
                spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode: 'speak_and_read' } } },
            } as never);
            await b.connect();
            b.state.fallback = { allowed: false, resetsAt: '2999-01-01T00:00:00.000Z' };
            await b.say(reply(1));
            expect(lastMode(b, 'room_7')).toBe('off');
            await b.connect();
            const lane = [...b.sent].reverse().find((m) => m.type === 'lane.open') as Extract<ToWorker, { type: 'lane.open' }>;
            expect(lane.mode).toBe('off');
        });

        it('is taken again once voice speaks for them (a typed message after a new window began)', async () => {
            const b = bot();
            await b.connect();
            b.state.answers = [{ allowed: false, resetsAt: '2999-01-01T00:00:00.000Z' }];
            await b.say(reply(1));
            expect(lastMode(b, 'room_7')).toBe('type_and_listen');
            b.state.fallback = { allowed: true };
            await b.say(reply(2), 'Back again.');
            expect(lastMode(b, 'room_7')).toBe('talk');
        });

        it('is taken again by itself when their window ends, without waiting for them to type', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            try {
                const b = bot();
                await b.connect();
                b.state.answers = [{ allowed: false, resetsAt: new Date(Date.now() + 60_000).toISOString() }];
                await b.say(reply(1));
                expect(lastMode(b, 'room_7')).toBe('type_and_listen');
                vi.advanceTimersByTime(30_000);
                expect(lastMode(b, 'room_7')).toBe('type_and_listen');
                vi.advanceTimersByTime(40_000);
                expect(lastMode(b, 'room_7')).toBe('talk');
            } finally {
                vi.useRealTimers();
            }
        });

        it('is only held back for the person whose allowance is used up', async () => {
            const b = bot({ people: { 7: { userId: 'uuid-room_7', isGuest: false }, 8: { userId: 'uuid-room_8', isGuest: false } } });
            await b.connect('room_7');
            await b.connect('room_8');
            b.state.answers = [{ allowed: false, resetsAt: '2999-01-01T00:00:00.000Z' }];
            await b.say(reply(1, 7));
            expect(lastMode(b, 'room_7')).toBe('type_and_listen');
            expect(lastMode(b, 'room_8')).toBeUndefined();
        });

        it('is not touched when the reply stays in text only because the allowance could not be settled', async () => {
            const b = bot();
            await b.connect();
            b.state.fallback = null;
            await b.say(reply(1));
            expect(modeSets(b)).toEqual([]);
        });
    });

    it('stays in text, with no line, when the allowance cannot be settled (Orbit cannot be asked or does not know the question)', async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = null;
        await b.say(reply(1));
        expect(b.says()).toEqual([]);
        expect(b.lines).toEqual([]);
        expect(b.statuses).not.toContain('room_7:paused');
        b.state.fallback = { allowed: true };
        await b.say(reply(2), 'Fine now.');
        expect(b.says()).toEqual(['Fine now.']);
    });

    it('is asked when only one of the two jobs is on Universe AI', async () => {
        const b = bot({ owners: { recognition: true, speech: false } });
        await b.connect();
        await b.say(reply(1));
        expect(b.orbit.checkVoiceAllowance).toHaveBeenCalledTimes(1);
    });

    it('is not counted when the maker\'s own keys pay for both jobs', async () => {
        const b = bot({ owners: { recognition: true, speech: true } });
        await b.connect();
        b.state.fallback = { allowed: false, resetsAt: 'x' };
        await b.say(reply(1), 'On the maker.');
        expect(b.orbit.checkVoiceAllowance).not.toHaveBeenCalled();
        expect(b.says()).toEqual(['On the maker.']);
    });

    it('is never stopped when the bot does not know who it is for', async () => {
        const b = bot({ people: {} });
        await b.connect();
        b.state.fallback = { allowed: false, resetsAt: 'x' };
        await b.say(reply(1), 'To someone.');
        expect(b.orbit.checkVoiceAllowance).not.toHaveBeenCalled();
        expect(b.says()).toEqual(['To someone.']);
    });

    it('does not reconnect anyone for a reply it keeps in text', async () => {
        const b = bot();
        await b.connect();
        // The maker changed the voice: a spoken reply would open the session again, a reply kept in text must not
        b.state.active = { ...speakingNow({ recognition: false, speech: false }), signature: 'two' };
        b.state.fallback = { allowed: false, resetsAt: 'x' };
        await b.say(reply(1));
        expect(b.sent.filter((m) => m.type === 'session.end')).toEqual([]);
    });

    it('is not counted again when it is asked for again (a greeting that waited for the audio to connect)', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Hi.');
        // Orbit counts a turn once; the bot server asks under the same id each time
        expect(b.orbit.checkVoiceAllowance.mock.calls.every(([, input]) => input.turnId === reply(1))).toBe(true);
    });
});

describe('a reply that was counted and then never spoken', () => {
    const released = (b: ReturnType<typeof bot>) => b.orbit.releaseVoiceReply.mock.calls.map(([botId, input]) => [botId, input.turnId]);

    it('is not given back when it was spoken', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Heard.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 1800, totalMs: 1800, finished: true, interrupted: false, reason: 'completed' });
        await flush();
        expect(b.says()).toEqual(['Heard.']);
        expect(released(b)).toEqual([]);
    });

    it('is given back when the person talked over it while Orbit was being asked', async () => {
        const b = bot();
        await b.connect();
        b.orbit.checkVoiceAllowance.mockImplementationOnce(async () => {
            b.workerSays({ type: 'user.speech_started' });
            return { allowed: true };
        });
        await b.say(reply(1));
        expect(b.says()).toEqual([]);
        expect(released(b)).toEqual([['sam', reply(1)]]);
    });

    it('is given back when its voice waits for the audio to come back and nobody comes', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const b = bot();
            await b.connect();
            // The maker changed the voice: the session opens again and the reply waits, like a greeting
            b.state.active = { ...speakingNow({ recognition: false, speech: false }), signature: 'two' };
            await b.say(reply(1), 'Welcome back.');
            expect(b.says()).toEqual([]);
            expect(released(b)).toEqual([]);
            await vi.advanceTimersByTimeAsync(DEFAULT_REPLY_LIMITS.greetingWaitSeconds * 1000 + 10);
            expect(released(b)).toEqual([['sam', reply(1)]]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('is given back when the person leaves while it waits', async () => {
        const b = bot();
        await b.connect();
        b.state.active = { ...speakingNow({ recognition: false, speech: false }), signature: 'two' };
        await b.say(reply(1), 'First.');
        expect(released(b)).toEqual([]);
        b.speech.spaceLeft(SPACE);
        await flush();
        expect(released(b)).toEqual([['sam', reply(1)]]);
    });

    it('is given back when the bot stops while it waits', async () => {
        const b = bot();
        await b.connect();
        b.state.active = { ...speakingNow({ recognition: false, speech: false }), signature: 'two' };
        await b.say(reply(1), 'First.');
        b.speech.shutdown();
        await flush();
        expect(released(b)).toEqual([['sam', reply(1)]]);
    });

    it('is given back when the voice worker ended it without a moment of it being heard', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Lost.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 0, finished: true, interrupted: true, reason: 'provider' });
        await flush();
        expect(released(b)).toEqual([['sam', reply(1)]]);
    });

    it('is given back when the session ends before any of it began to play, and kept when some of it was heard', async () => {
        const gone = bot();
        await gone.connect();
        await gone.say(reply(1), 'Never played.');
        gone.calls.spaceLeft(SPACE);
        await flush();
        expect(released(gone)).toEqual([['sam', reply(1)]]);

        const heard = bot();
        await heard.connect();
        await heard.say(reply(1), 'Playing.');
        heard.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 500, finished: false, interrupted: false });
        heard.calls.spaceLeft(SPACE);
        await flush();
        expect(released(heard)).toEqual([]);
    });

    it('is given back when the voice is opened again before it began to play', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Never played.');
        // The maker changes the voice: the session is closed and opened again
        b.state.active = { ...speakingNow({ recognition: false, speech: false }), signature: 'two' };
        await b.say(reply(2), 'Next.');
        expect(released(b)).toEqual([['sam', reply(1)]]);
    });

    it('is kept counted when some of it was heard, even if it was cut', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Part of it.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 900, finished: true, interrupted: true, reason: 'barge_in' });
        await flush();
        expect(released(b)).toEqual([]);
    });

    it('is never given back when it was never counted (turned down, or the maker pays)', async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = { allowed: false, resetsAt: 'x' };
        await b.say(reply(1));
        const maker = bot({ owners: { recognition: true, speech: true } });
        await maker.connect();
        await maker.say(reply(1), 'On the maker.');
        maker.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 0, finished: true, interrupted: true, reason: 'provider' });
        await flush();
        expect(released(b)).toEqual([]);
        expect(released(maker)).toEqual([]);
    });

    it('is given back only once, however many times it is let go', async () => {
        const b = bot();
        await b.connect();
        await b.say(reply(1), 'Lost.');
        for (let i = 0; i < 3; i++) b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 0, finished: true, interrupted: true, reason: 'provider' });
        await flush();
        expect(released(b)).toHaveLength(1);
    });

    it('never gets in the way of the reply: a release Orbit cannot take is tried again, then dropped, and the next reply is spoken', async () => {
        const b = bot();
        await b.connect();
        b.orbit.releaseVoiceReply.mockResolvedValue(null);
        await b.say(reply(1), 'Lost.');
        b.workerSays({ type: 'playback.progress', segmentId: 's1', playedMs: 0, finished: true, interrupted: true, reason: 'provider' });
        await flush();
        expect(b.orbit.releaseVoiceReply).toHaveBeenCalledTimes(3);
        expect(b.logs.some((m) => m.includes('could not give back'))).toBe(true);
        await b.say(reply(2), 'Still working.');
        expect(b.says()).toEqual(['Lost.', 'Still working.']);
    });
});

describe("a maker's key or a provider that is not working", () => {
    it('pauses voice for the person the same way, once', async () => {
        const b = bot();
        await b.connect();
        b.state.active = { speaks: false, reason: 'key-down' };
        await b.say(reply(1));
        await b.say(reply(2));
        expect(b.says()).toEqual([]);
        expect(b.statuses).toContain('room_7:paused');
        expect(b.lines).toHaveLength(1);
        b.state.active = speakingNow({ recognition: true, speech: true });
        await b.say(reply(3), 'It works again.');
        expect(b.says()).toEqual(['It works again.']);
        expect(b.statuses.slice(-1)).toEqual(['room_7:on']);
    });

    it('says nothing when the bot simply does not speak (voice off) or Orbit cannot be asked', async () => {
        const b = bot();
        await b.connect();
        b.state.active = { speaks: false, reason: 'off' };
        await b.say(reply(1));
        b.state.active = { speaks: false, reason: 'orbit' };
        await b.say(reply(2));
        expect(b.lines).toEqual([]);
        expect(b.statuses).not.toContain('room_7:paused');
    });
});

describe('the gate', () => {
    it('asks nothing for a turn without a person and says yes', async () => {
        const orbit = { checkVoiceAllowance: vi.fn(), releaseVoiceReply: vi.fn() };
        const gate = new OrbitTurnGate('sam', orbit, () => null);
        expect(await gate.mayUniverseAiSpeak({ turnId: 't' })).toBe('yes');
        expect(gate.personOf({ turnId: 't' })).toBeUndefined();
        expect(orbit.checkVoiceAllowance).not.toHaveBeenCalled();
    });

    it('gives back a reply it said yes to, once, and nothing it did not', async () => {
        const orbit = { checkVoiceAllowance: vi.fn(async () => ({ allowed: true }) as const), releaseVoiceReply: vi.fn(async () => true) };
        const gate = new OrbitTurnGate('sam', orbit, () => ({ userId: 'u', isGuest: false }), undefined, async () => undefined);
        await gate.release({ turnId: 'never-asked', playerId: 7 });
        expect(orbit.releaseVoiceReply).not.toHaveBeenCalled();
        await gate.mayUniverseAiSpeak({ turnId: 't', playerId: 7 });
        await gate.release({ turnId: 't', playerId: 7 });
        await gate.release({ turnId: 't', playerId: 7 });
        expect(orbit.releaseVoiceReply).toHaveBeenCalledTimes(1);
        expect(orbit.releaseVoiceReply).toHaveBeenCalledWith('sam', { turnId: 't' });
    });

    it('does not throw when Orbit throws, and stops after three tries', async () => {
        const orbit = { checkVoiceAllowance: vi.fn(async () => ({ allowed: true }) as const), releaseVoiceReply: vi.fn(async (): Promise<boolean | null> => { throw new Error('down'); }) };
        const logs: string[] = [];
        const gate = new OrbitTurnGate('sam', orbit, () => ({ userId: 'u', isGuest: false }), (m) => logs.push(m), async () => undefined);
        await gate.mayUniverseAiSpeak({ turnId: 't', playerId: 7 });
        await expect(gate.release({ turnId: 't', playerId: 7 })).resolves.toBe(false);
        expect(logs).toHaveLength(1);
    });
});

describe('what a person has left', () => {
    const RESET = '2026-11-02T13:00:00.000Z';

    it('is told to the person when their voice comes on, before any spoken reply, counting nothing', async () => {
        const b = bot();
        await b.connect();
        await flush();
        expect(b.orbit.voiceRepliesLeft).toHaveBeenCalledWith('sam', { userId: 'uuid-room_7', isGuest: false });
        expect(b.orbit.checkVoiceAllowance).not.toHaveBeenCalled();
        // No window is running yet: the count comes with no time
        expect(b.lefts).toEqual(['room_7:on:25|']);
    });

    it("goes with the status of a reply that is allowed: how many are left after it, and when the window ends", async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = { allowed: true, left: 17, resetsAt: RESET };
        await b.say(reply(1), 'Hello there.');
        expect(b.says()).toEqual(['Hello there.']);
        expect(b.lefts.slice(-1)).toEqual([`room_7:on:17|${RESET}`]);
    });

    it('goes with the paused status of a reply that is turned down, in one message: none left until the window ends', async () => {
        const b = bot();
        await b.connect();
        await flush();
        b.lefts.length = 0;
        b.state.fallback = { allowed: false, resetsAt: RESET };
        await b.say(reply(1));
        expect(b.lefts).toEqual([`room_7:paused:0|${RESET}`]);
        expect(b.lines).toHaveLength(1);
    });

    it('is only told again when it changed', async () => {
        const b = bot();
        await b.connect();
        await flush();
        b.state.fallback = { allowed: true, left: 17, resetsAt: RESET };
        await b.say(reply(1));
        await b.say(reply(2));
        // The second answer says the same: nothing new to tell
        expect(b.lefts.filter((l) => l.endsWith(`17|${RESET}`))).toHaveLength(1);
        b.state.fallback = { allowed: true, left: 16, resetsAt: RESET };
        await b.say(reply(3));
        expect(b.lefts.slice(-1)).toEqual([`room_7:on:16|${RESET}`]);
    });

    it('is told to each person alone: a guest with 3 and a member with 25', async () => {
        const b = bot({ people: { 7: { userId: 'uuid-room_7', isGuest: false }, 8: { userId: 'uuid-room_8', isGuest: true } } });
        b.state.left = null;
        await b.connect('room_7');
        await b.connect('room_8');
        await flush();
        b.state.answers = [{ allowed: true, left: 2, resetsAt: RESET }, { allowed: true, left: 24, resetsAt: RESET }];
        await b.say(reply(1, 8));
        // The first reply has been heard: the next one is free to be said
        b.workerSays({ type: 'playback.progress', segmentId: b.sent.filter((m) => m.type === 'bot.say').map((m) => (m as { segmentId: string }).segmentId)[0], playedMs: 1800, totalMs: 1800, finished: true, interrupted: false, reason: 'completed' }, 'room_8');
        await flush();
        await b.say(reply(2, 7));
        expect(b.lefts).toEqual([`room_8:on:2|${RESET}`, `room_7:on:24|${RESET}`]);
    });

    it('says nothing when Orbit has no count (an Orbit from before, or it cannot be asked)', async () => {
        const b = bot();
        b.state.left = null;
        await b.connect();
        b.state.fallback = { allowed: true };
        await b.say(reply(1), 'Hello there.');
        expect(b.says()).toEqual(['Hello there.']);
        expect(b.lefts).toEqual([]);
        // Orbit can't name the person: no count either
        b.state.left = { left: null, resetsAt: null };
        b.rejoin();
        await flush();
        expect(b.lefts).toEqual([]);
    });

    it("says nothing when the maker's own keys pay for both jobs: nobody's allowance is used", async () => {
        const b = bot({ owners: { recognition: true, speech: true } });
        await b.connect();
        await flush();
        expect(b.orbit.voiceRepliesLeft).not.toHaveBeenCalled();
        expect(b.lefts).toEqual([]);
    });

    it('is told again once a counted reply that was never heard is given back', async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = { allowed: true, left: 10, resetsAt: RESET };
        await b.say(reply(1), 'Hello there.');
        b.lefts.length = 0;
        b.state.left = { left: 11, resetsAt: RESET };
        b.calls.unspoken(SPACE, { turnId: reply(1), playerId: 7 } as never);
        await flush();
        expect(b.lefts).toEqual([`room_7:on:11|${RESET}`]);
    });

    it('is forgotten when the person leaves, so a later visit starts from what Orbit says then', async () => {
        const b = bot();
        await b.connect();
        b.state.fallback = { allowed: true, left: 10, resetsAt: RESET };
        await b.say(reply(1), 'Hello there.');
        b.calls.spaceUserLeft(SPACE, 'room_7');
        b.lefts.length = 0;
        b.state.left = { left: 25, resetsAt: null };
        await b.connect();
        await flush();
        expect(b.lefts).toEqual(['room_7:on:25|']);
    });
});

describe('the allowance gate and what is left', () => {
    const turn = { turnId: 't1', playerId: 7 } as never;

    it("reads what an answer said is left once, and not for an Orbit from before", async () => {
        const orbit: AllowanceOrbit = {
            checkVoiceAllowance: vi.fn(async () => ({ allowed: true as const, left: 4, resetsAt: '2026-11-02T13:00:00.000Z' })),
            releaseVoiceReply: vi.fn(async () => true),
        };
        const gate = new OrbitTurnGate('sam', orbit, () => ({ userId: 'u', isGuest: false }));
        expect(await gate.mayUniverseAiSpeak(turn)).toBe('yes');
        expect(gate.leftOf(turn)).toEqual({ count: 4, resetsAt: '2026-11-02T13:00:00.000Z' });
        expect(gate.leftOf(turn)).toBeUndefined();
        // An Orbit from before answers a bare yes
        (orbit.checkVoiceAllowance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: true });
        expect(await gate.mayUniverseAiSpeak({ turnId: 't2', playerId: 7 } as never)).toBe('yes');
        expect(gate.leftOf({ turnId: 't2', playerId: 7 } as never)).toBeUndefined();
        // And has no way to say what is left without counting
        expect(await gate.leftForPlayer(7)).toBeNull();
    });

    it('reads none left from a no', async () => {
        const orbit: AllowanceOrbit = {
            checkVoiceAllowance: vi.fn(async () => ({ allowed: false as const, resetsAt: '2026-11-02T13:00:00.000Z' })),
            releaseVoiceReply: vi.fn(async () => true),
        };
        const gate = new OrbitTurnGate('sam', orbit, () => ({ userId: 'u', isGuest: true }));
        expect(await gate.mayUniverseAiSpeak(turn)).toBe('no');
        expect(gate.leftOf(turn)).toEqual({ count: 0, resetsAt: '2026-11-02T13:00:00.000Z' });
    });

    it('asks what is left of the person it is for, and has no answer for nobody or an Orbit that fails', async () => {
        const voiceRepliesLeft = vi.fn(async () => ({ left: 3, resetsAt: null }));
        const orbit: AllowanceOrbit = { checkVoiceAllowance: vi.fn(), releaseVoiceReply: vi.fn(), voiceRepliesLeft } as never;
        const gate = new OrbitTurnGate('sam', orbit, (id) => (id === 7 ? { userId: 'u7', isGuest: true } : null));
        expect(await gate.leftForPlayer(7)).toEqual({ count: 3, resetsAt: undefined });
        expect(voiceRepliesLeft).toHaveBeenCalledWith('sam', { userId: 'u7', isGuest: true });
        expect(await gate.leftForPlayer(8)).toBeNull();
        voiceRepliesLeft.mockRejectedValueOnce(new Error('down'));
        expect(await gate.leftForPlayer(7)).toBeNull();
    });
});
