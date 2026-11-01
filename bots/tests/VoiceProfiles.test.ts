/**
 * What each voice bot hears and speaks with (#1746): the bot server reads the choice its maker made in Orbit, fetches the
 * key of each provider, and opens the bubble's session with them. Orbit is mocked, and so is the worker (a link that
 * records what it is sent).
 */
import crypto from 'crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrivateEventPusherToFront } from '@workadventure/messages';
import { BotSpeech } from '../voice/BotSpeech';
import { VoiceCalls, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ToWorker } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';
import { DEFAULT_REPLY_LIMITS, DEFAULT_VOICE_ORBIT_SETTINGS, voiceOrbitSettings } from '../voice/settings';
import { BotVoiceSettings, type VoiceActiveAnswer, type VoiceCredentialsAnswer, type VoiceHealthReport, type VoiceOrbit } from '../voice/VoiceSettings';

const SPACE = 'proximity-1';
const BOT_SPACE_ID = 'room_9';
const OFFER = JSON.stringify({ type: 'offer', sdp: 'v=0\r\n' });
const ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
/** Keys are made so a test can look for them anywhere. */
const KEYS = { ears: 'sk-ears-1111-secret', voiceA: 'sk-voice-A-2222-secret', voiceB: 'sk-voice-B-3333-secret', owner: 'sk-owner-4444-secret' };

function encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

beforeAll(() => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
});

const profile = (overrides: object = {}) => ({
    recognition: { providerId: 'ears', model: 'stt-v1' },
    speech: { providerId: 'voice-a', model: 'tts-v1', voiceId: 'voice-1', voiceName: 'Sara' },
    expression: 'natural',
    language: { mode: 'follow' },
    ...overrides,
});
const speaking = (overrides: Partial<VoiceActiveAnswer> = {}): VoiceActiveAnswer => ({
    speaks: true,
    reason: null,
    parts: { recognition: 'universe-ai', speech: 'universe-ai' },
    revision: 1,
    profile: profile(),
    ...overrides,
});
const notSpeaking = (reason: string): VoiceActiveAnswer => ({ speaks: false, reason, profile: reason === 'no-profile' ? null : profile() });
const provider = (id: string, adapter: string, key: string, extra: Partial<VoiceCredentialsAnswer> = {}): VoiceCredentialsAnswer => ({
    id,
    adapter,
    name: id,
    recognition: true,
    speech: true,
    endpoint: null,
    region: null,
    apiKeyEncrypted: encrypt(key),
    ...extra,
});

/** Orbit, as a fake: what it says per bot and per provider, and what it was asked. */
function orbit() {
    const state = {
        active: {} as Record<string, VoiceActiveAnswer | null | Error>,
        providers: {} as Record<string, VoiceCredentialsAnswer | Error | null>,
        limits: null as object | null | Error,
    };
    const fake = {
        getVoiceActive: vi.fn(async (botId: string) => {
            const answer = state.active[botId];
            if (answer instanceof Error) throw answer;
            return answer ?? null;
        }),
        getVoiceCredentials: vi.fn(async (id: string, _botId: string) => {
            const answer = state.providers[id];
            if (answer instanceof Error) throw answer;
            return answer ?? null;
        }),
        getVoiceLimits: vi.fn(async () => {
            if (state.limits instanceof Error) throw state.limits;
            return state.limits;
        }),
        reportVoiceHealth: vi.fn(async (_id: string, _report: VoiceHealthReport, _timeoutMs: number) => undefined),
    };
    return { state, fake: fake as typeof fake & VoiceOrbit };
}

const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** One voice bot: its relay, the settings from Orbit, and a worker that records what it is sent. */
function bot(botId: string, fake: VoiceOrbit, options: { activeCacheMs?: number } = {}) {
    const sent: ToWorker[] = [];
    const logs: string[] = [];
    const game = { disconnects: [] as string[], starts: [] as string[], statuses: [] as string[] };
    let handlers!: LinkHandlers;
    const link: VoiceLink = {
        isUp: () => true,
        send: (message) => (sent.push(message), true),
        close: vi.fn(),
    };
    const gameSide: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT_SPACE_ID : undefined),
        sendSignal: () => undefined,
        sendDisconnect: (_space, to) => game.disconnects.push(to),
        sendStart: (_space, to) => game.starts.push(to),
        sendDraft: () => undefined,
        sendStatus: (_space, to, status) => game.statuses.push(`${to}:${status}`),
    };
    const settings = new BotVoiceSettings(botId, fake, { timeoutMs: 1000, activeCacheMs: options.activeCacheMs ?? 0, limitsCacheMs: 60000 }, (m) => logs.push(m));
    const calls = new VoiceCalls(botId, gameSide, (h) => ((handlers = h), link), (m) => logs.push(m), settings);
    const speech = new BotSpeech(calls, DEFAULT_REPLY_LIMITS);
    calls.onAudience = (space) => speech.audience(space);
    const event = (kind: 'start' | 'signal', who = 'room_7'): PrivateEventPusherToFront =>
        ({
            spaceName: SPACE,
            receiverUserId: BOT_SPACE_ID,
            sender: { spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who },
            spaceEvent: { event: kind === 'start' ? { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: who, initiator: false } } : { $case: 'webRtcSignal', webRtcSignal: { signal: OFFER } } },
        }) as unknown as PrivateEventPusherToFront;
    const t = {
        botId, sent, logs, game, calls, speech, settings,
        opens: () => sent.filter((m) => m.type === 'session.open') as Extract<ToWorker, { type: 'session.open' }>[],
        fromWorker: (m: object) => handlers.onMessage(m as FromWorker),
        /** A person starts a connection and the session opens. */
        async connect(who = 'room_7') {
            t.start(who);
            await flush();
        },
        start(who = 'room_7') {
            calls.spaceUsers(SPACE, [{ spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who } as never]);
            calls.handlePrivateEvent(event('start', who));
        },
        /** The worker says the person's audio is connected. */
        joined(who = 'room_7') {
            const lane = [...sent].reverse().find((m) => m.type === 'lane.open' && m.participantId === who) as Extract<ToWorker, { type: 'lane.open' }>;
            t.fromWorker({ type: 'participant.join', sessionId: lane.sessionId, participantId: who, epoch: lane.epoch });
        },
        signal: (who = 'room_7') => calls.handlePrivateEvent(event('signal', who)),
    };
    return t;
}

afterEach(() => vi.restoreAllMocks());

describe('each bot opens its bubble with its own settings', () => {
    it('gives two bots with different voice profiles their own provider, model, voice and key', async () => {
        const o = orbit();
        o.state.active.alice = speaking({ profile: profile({ expression: 'expressive', language: { mode: 'fixed', code: 'ar-KW' } }) });
        o.state.active.bruno = speaking({
            profile: profile({ recognition: { providerId: 'ears-b', model: 'stt-v2' }, speech: { providerId: 'voice-b', model: 'tts-v9', voiceId: 'voice-7' }, expression: 'restrained' }),
        });
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['ears-b'] = provider('ears-b', 'deepgram', KEYS.owner, { endpoint: 'https://stt.example.test', region: 'eu' });
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        o.state.providers['voice-b'] = provider('voice-b', 'cartesia', KEYS.voiceB);
        const alice = bot('alice', o.fake);
        const bruno = bot('bruno', o.fake);

        await alice.connect();
        await bruno.connect();

        expect(alice.opens()).toHaveLength(1);
        expect(alice.opens()[0]).toEqual({
            type: 'session.open',
            sessionId: expect.any(String),
            bubbleId: SPACE,
            botId: 'alice',
            recognition: { adapter: 'soniox', model: 'stt-v1', key: KEYS.ears, language: 'ar-KW' },
            speech: { adapter: 'elevenlabs', model: 'tts-v1', voiceId: 'voice-1', key: KEYS.voiceA, language: 'ar-KW' },
            expression: 'expressive',
        });
        expect(bruno.opens()[0]).toEqual({
            type: 'session.open',
            sessionId: expect.any(String),
            bubbleId: SPACE,
            botId: 'bruno',
            // A language that follows the person is left out, and a provider's address and region go with it
            recognition: { adapter: 'deepgram', model: 'stt-v2', key: KEYS.owner, endpoint: 'https://stt.example.test', region: 'eu' },
            speech: { adapter: 'cartesia', model: 'tts-v9', voiceId: 'voice-7', key: KEYS.voiceB },
            expression: 'restrained',
        });
    });

    it('fetches each provider once, with the bot it is for', async () => {
        const o = orbit();
        // One provider that hears and speaks
        o.state.active.alice = speaking({ profile: profile({ recognition: { providerId: 'both', model: 'stt' }, speech: { providerId: 'both', model: 'tts', voiceId: 'v' } }) });
        o.state.providers.both = provider('both', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        await alice.connect();
        expect(o.fake.getVoiceCredentials).toHaveBeenCalledTimes(1);
        expect(o.fake.getVoiceCredentials).toHaveBeenCalledWith('both', 'alice', expect.any(Number));
        expect(alice.opens()[0].recognition?.key).toBe(KEYS.voiceA);
        expect(alice.opens()[0].speech?.key).toBe(KEYS.voiceA);
    });

    it('holds what the worker is to get until the session is open, then sends it in order', async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);

        // The person starts and sends their offer before Orbit has answered
        alice.start();
        alice.signal();
        expect(alice.sent).toEqual([]);
        await flush();

        expect(alice.sent.map((m) => m.type)).toEqual(['session.open', 'lane.open', 'lane.signal']);
        expect(alice.calls.hasCall(SPACE, 'room_7')).toBe(true);
    });

    it('opens one session for the bubble when two people start while Orbit is being asked', async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        alice.start('room_7');
        alice.start('room_8');
        await flush();
        expect(alice.opens()).toHaveLength(1);
        expect(alice.sent.filter((m) => m.type === 'lane.open')).toHaveLength(2);
        expect(o.fake.getVoiceActive).toHaveBeenCalledTimes(1);
    });
});

describe('a bot that does not speak answers in text', () => {
    const cases: [string, (state: ReturnType<typeof orbit>['state']) => void][] = [
        ['voice is off', (s) => (s.active.alice = notSpeaking('off'))],
        ['the universe does not allow it', (s) => (s.active.alice = notSpeaking('universe'))],
        ['it has no voice profile', (s) => (s.active.alice = notSpeaking('no-profile'))],
        ['its provider no longer works', (s) => (s.active.alice = notSpeaking('provider'))],
        ['its key is down', (s) => (s.active.alice = notSpeaking('key-down'))],
        ['Orbit says it speaks but sends no profile', (s) => (s.active.alice = speaking({ profile: null }))],
        ['Orbit does not know the bot', (s) => (s.active.alice = null)],
        ['Orbit cannot be reached', (s) => (s.active.alice = new Error('connect ECONNREFUSED'))],
        ['Orbit will not serve a provider to this bot', (s) => ((s.active.alice = speaking()), (s.providers.ears = provider('ears', 'soniox', KEYS.ears)), (s.providers['voice-a'] = null))],
        ['Orbit cannot be asked for a provider', (s) => ((s.active.alice = speaking()), (s.providers.ears = new Error('boom')), (s.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA)))],
        ['a provider has no key', (s) => ((s.active.alice = speaking()), (s.providers.ears = provider('ears', 'soniox', KEYS.ears)), (s.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA, { apiKeyEncrypted: null })))],
        ['a key cannot be decrypted', (s) => ((s.active.alice = speaking()), (s.providers.ears = provider('ears', 'soniox', KEYS.ears)), (s.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA, { apiKeyEncrypted: 'zz:zz:zz' })))],
        ['a provider does not do the job it is named for', (s) => ((s.active.alice = speaking()), (s.providers.ears = provider('ears', 'soniox', KEYS.ears, { recognition: false })), (s.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA)))],
    ];

    it.each(cases)('opens no session when %s, and tells the person to disconnect', async (_why, arrange) => {
        const o = orbit();
        arrange(o.state);
        const alice = bot('alice', o.fake);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        alice.start();
        alice.signal();
        await flush();

        expect(alice.sent).toEqual([]);
        expect(alice.game.disconnects).toEqual(['room_7']);
        expect(alice.game.statuses.at(-1)).toBe('room_7:paused');
        expect(alice.calls.hasCall(SPACE, 'room_7')).toBe(false);
        // The next time the person starts, Orbit is asked again
        o.state.active.alice = speaking();
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        await alice.connect();
        expect(alice.opens()).toHaveLength(1);
    });

    it('does not touch another bot: one bot in text does not stop the next from speaking', async () => {
        const o = orbit();
        o.state.active.alice = notSpeaking('key-down');
        o.state.active.bruno = speaking();
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        const bruno = bot('bruno', o.fake);
        await alice.connect();
        await bruno.connect();
        expect(alice.opens()).toEqual([]);
        expect(bruno.opens()).toHaveLength(1);
    });

    it('leaves a bubble that went away while Orbit was being asked alone', async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        alice.start();
        alice.calls.spaceLeft(SPACE);
        await flush();
        expect(alice.sent).toEqual([]);
    });
});

describe('before each spoken turn', () => {
    async function speakingBot(o = orbit()) {
        o.state.active.alice = speaking({ parts: { recognition: 'owner', speech: 'owner' } });
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        await alice.connect();
        alice.joined();
        return { o, alice };
    }
    const says = (sent: ToWorker[]) => sent.filter((m) => m.type === 'bot.say') as Extract<ToWorker, { type: 'bot.say' }>[];
    const reply = (n: number) => `bot-alice-player-7-0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;

    it('reads Orbit again, and says the reply when the bot still speaks', async () => {
        const { o, alice } = await speakingBot();
        const asked = o.fake.getVoiceActive.mock.calls.length;
        alice.speech.final(SPACE, reply(1), 'Hello there.');
        await flush();
        expect(o.fake.getVoiceActive.mock.calls.length).toBe(asked + 1);
        expect(says(alice.sent).map((m) => m.text)).toEqual(['Hello there.']);
    });

    it('answers in text for this turn when Orbit says the bot no longer speaks, and speaks again when it does', async () => {
        const { o, alice } = await speakingBot();
        o.state.active.alice = notSpeaking('key-down');
        alice.speech.final(SPACE, reply(1), 'First answer.');
        await flush();
        expect(says(alice.sent)).toEqual([]);
        // No session was closed: the person is still connected
        expect(alice.sent.filter((m) => m.type === 'session.end')).toEqual([]);

        o.state.active.alice = speaking({ parts: { recognition: 'owner', speech: 'owner' } });
        alice.speech.final(SPACE, reply(2), 'Second answer.');
        await flush();
        expect(says(alice.sent).map((m) => m.text)).toEqual(['Second answer.']);
    });

    it('answers in text when Orbit cannot be asked', async () => {
        const { o, alice } = await speakingBot();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        o.state.active.alice = new Error('timeout of 1000ms exceeded');
        alice.speech.final(SPACE, reply(1), 'An answer.');
        await flush();
        expect(says(alice.sent)).toEqual([]);
    });

    it('never says a reply a person talked over while Orbit was being asked', async () => {
        const { o, alice } = await speakingBot();
        const answer = o.fake.getVoiceActive.getMockImplementation()!;
        let release!: () => void;
        o.fake.getVoiceActive.mockImplementationOnce(async (id: string) => {
            await new Promise<void>((resolve) => (release = resolve));
            return answer(id);
        });
        alice.speech.final(SPACE, reply(1), 'An answer.');
        await Promise.resolve();
        // The person starts talking while Orbit is being asked
        alice.fromWorker({ type: 'user.speech_started', sessionId: alice.opens()[0].sessionId, participantId: 'room_7', epoch: 1, turnId: 't1' });
        release();
        await flush();
        expect(says(alice.sent)).toEqual([]);
    });

    it('closes the session and opens it again with the new settings when the bot\'s voice changed, and says the reply once the person is back', async () => {
        const { o, alice } = await speakingBot();
        const first = alice.opens()[0];
        o.state.active.alice = speaking({
            parts: { recognition: 'owner', speech: 'owner' },
            profile: profile({ speech: { providerId: 'voice-b', model: 'tts-v9', voiceId: 'voice-7' } }),
        });
        o.state.providers['voice-b'] = provider('voice-b', 'cartesia', KEYS.voiceB);

        alice.speech.final(SPACE, reply(1), 'Hello with the new voice.');
        await flush();

        // The old session is closed, the person is told to reconnect, and a new session carries the new voice
        expect(alice.sent.filter((m) => m.type === 'session.end')).toEqual([expect.objectContaining({ sessionId: first.sessionId })]);
        expect(alice.game.disconnects).toEqual(['room_7']);
        expect(alice.game.starts).toEqual(['room_7']);
        expect(alice.opens()).toHaveLength(2);
        expect(alice.opens()[1].sessionId).not.toBe(first.sessionId);
        expect(alice.opens()[1].speech).toEqual({ adapter: 'cartesia', model: 'tts-v9', voiceId: 'voice-7', key: KEYS.voiceB });
        expect(says(alice.sent)).toEqual([]);

        // Their audio is connected again: the reply that waited is said, in the new session
        alice.start();
        await flush();
        alice.joined();
        await flush();
        expect(says(alice.sent).map((m) => [m.sessionId, m.text])).toEqual([[alice.opens()[1].sessionId, 'Hello with the new voice.']]);
    });

    it('does not open the session again when nothing about the voice changed', async () => {
        const { alice } = await speakingBot();
        alice.speech.final(SPACE, reply(1), 'One.');
        await flush();
        alice.speech.final(SPACE, reply(2), 'Two.');
        await flush();
        expect(alice.opens()).toHaveLength(1);
        expect(says(alice.sent)).toHaveLength(2);
    });

    it('fetches the keys again for the next turn after a provider refused one', async () => {
        const { o, alice } = await speakingBot();
        alice.fromWorker({ type: 'provider.failed', sessionId: alice.opens()[0].sessionId, part: 'speech', adapter: 'elevenlabs', status: 401, rejected: true });
        alice.speech.final(SPACE, reply(1), 'Again.');
        await flush();
        expect(alice.opens()).toHaveLength(2);
        expect(o.fake.getVoiceCredentials.mock.calls.filter(([id]) => id === 'voice-a')).toHaveLength(2);
    });
});

describe('reply limits', () => {
    const long = 'This is a sentence that goes on. '.repeat(60);
    async function connected(o: ReturnType<typeof orbit>) {
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        await alice.connect();
        alice.joined();
        return alice;
    }
    const said = (alice: ReturnType<typeof bot>) => alice.sent.filter((m) => m.type === 'bot.say') as Extract<ToWorker, { type: 'bot.say' }>[];

    it("applies the bot's own limits from voice/active", async () => {
        const o = orbit();
        o.state.active.alice = speaking({ limits: { replyCharacters: 120, replySeconds: 7, turnSeconds: 30 } });
        const alice = await connected(o);
        alice.speech.final(SPACE, 'bot-alice-player-7-00000001-aaaa-bbbb-cccc-dddddddddddd', long);
        await flush();
        expect(said(alice)[0].text.length).toBeLessThanOrEqual(120);
        expect(said(alice)[0].maxMs).toBe(7000);
        expect(o.fake.getVoiceLimits).not.toHaveBeenCalled();
    });

    it("falls back to the server's limits when voice/active carries none", async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        o.state.limits = { replyCharacters: 200, replySeconds: 12 };
        const alice = await connected(o);
        alice.speech.final(SPACE, 'bot-alice-player-7-00000001-aaaa-bbbb-cccc-dddddddddddd', long);
        await flush();
        expect(said(alice)[0].text.length).toBeLessThanOrEqual(200);
        expect(said(alice)[0].maxMs).toBe(12000);
    });

    it("keeps the settings from the environment when neither Orbit answer has limits, or the server's cannot be read", async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        o.state.limits = new Error('down');
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const alice = await connected(o);
        alice.speech.final(SPACE, 'bot-alice-player-7-00000001-aaaa-bbbb-cccc-dddddddddddd', long);
        await flush();
        expect(said(alice)[0].text.length).toBeLessThanOrEqual(DEFAULT_REPLY_LIMITS.maxChars);
        expect(said(alice)[0].maxMs).toBe(DEFAULT_REPLY_LIMITS.maxSeconds * 1000);
    });

    it("does not keep one turn's limits for the next: a bot's own limits go when its key is replaced", async () => {
        const o = orbit();
        o.state.active.alice = speaking({ limits: { replyCharacters: 100, replySeconds: 5 } });
        const alice = await connected(o);
        alice.speech.final(SPACE, 'bot-alice-player-7-00000001-aaaa-bbbb-cccc-dddddddddddd', long);
        await flush();
        o.state.active.alice = speaking({ limits: { replyCharacters: 400, replySeconds: 30 } });
        alice.speech.final(SPACE, 'bot-alice-player-7-00000002-aaaa-bbbb-cccc-dddddddddddd', long);
        await flush();
        expect(said(alice)[0].maxMs).toBe(5000);
        expect(said(alice)[1].maxMs).toBe(30000);
        expect(said(alice)[1].text.length).toBeGreaterThan(100);
    });

    it("reads the server's limits once for a while, not for every turn", async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        o.state.limits = { replyCharacters: 200, replySeconds: 12 };
        const alice = await connected(o);
        for (const n of [1, 2, 3]) {
            alice.speech.final(SPACE, `bot-alice-player-7-0000000${n}-aaaa-bbbb-cccc-dddddddddddd`, 'Short.');
            await flush();
        }
        expect(o.fake.getVoiceLimits).toHaveBeenCalledTimes(1);
    });
});

describe('telling Orbit how the providers did', () => {
    async function connected(parts: { recognition: string; speech: string }, ids = { ears: 'ears', voice: 'voice-a' }) {
        const o = orbit();
        o.state.active.alice = speaking({
            parts: parts as never,
            profile: profile({ recognition: { providerId: ids.ears, model: 'stt-v1' }, speech: { providerId: ids.voice, model: 'tts-v1', voiceId: 'voice-1' } }),
        });
        o.state.providers[ids.ears] = provider(ids.ears, 'soniox', KEYS.ears);
        o.state.providers[ids.voice] = provider(ids.voice, 'elevenlabs', KEYS.voiceA);
        const alice = bot('alice', o.fake);
        await alice.connect();
        return { o, alice, session: alice.opens()[0].sessionId };
    }

    it('reports a speech call that worked once per reply, with the bot', async () => {
        const { o, alice, session } = await connected({ recognition: 'owner', speech: 'owner' });
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        expect(o.fake.reportVoiceHealth.mock.calls.map(([id, report]) => [id, report])).toEqual([
            ['voice-a', { part: 'speech', ok: true, botId: 'alice' }],
            ['voice-a', { part: 'speech', ok: true, botId: 'alice' }],
        ]);
    });

    it("sends each part's outcome to the provider that part runs on", async () => {
        const { o, alice, session } = await connected({ recognition: 'owner', speech: 'owner' }, { ears: 'ears-key', voice: 'voice-key' });
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'recognition', adapter: 'soniox' });
        alice.fromWorker({ type: 'provider.failed', sessionId: session, part: 'recognition', adapter: 'soniox', status: 401, rejected: true });
        alice.fromWorker({ type: 'provider.failed', sessionId: session, part: 'speech', adapter: 'elevenlabs', status: 503 });
        alice.fromWorker({ type: 'provider.failed', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        expect(o.fake.reportVoiceHealth.mock.calls.map(([id, report]) => [id, report])).toEqual([
            ['ears-key', { part: 'recognition', ok: true, botId: 'alice' }],
            ['ears-key', { part: 'recognition', ok: false, botId: 'alice', status: 401, rejected: true }],
            ['voice-key', { part: 'speech', ok: false, botId: 'alice', status: 503 }],
            ['voice-key', { part: 'speech', ok: false, botId: 'alice' }],
        ]);
    });

    it("reports only for a person's key: a part Universe AI pays for has no health", async () => {
        const { o, alice, session } = await connected({ recognition: 'universe-ai', speech: 'owner' });
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'recognition', adapter: 'soniox' });
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        expect(o.fake.reportVoiceHealth.mock.calls.map(([id, report]) => [id, (report as { part: string }).part])).toEqual([['voice-a', 'speech']]);
    });

    it('ignores a report about a session it does not know', async () => {
        const { o, alice } = await connected({ recognition: 'owner', speech: 'owner' });
        alice.fromWorker({ type: 'provider.ok', sessionId: 'someone-else.1', part: 'speech', adapter: 'elevenlabs' });
        expect(o.fake.reportVoiceHealth).not.toHaveBeenCalled();
    });

    it('still reports for the session a bubble had before it was opened again', async () => {
        const { o, alice, session } = await connected({ recognition: 'owner', speech: 'owner' });
        o.state.active.alice = speaking({ parts: { recognition: 'owner', speech: 'owner' }, profile: profile({ expression: 'expressive' }) });
        alice.joined();
        alice.speech.final(SPACE, 'bot-alice-player-7-00000001-aaaa-bbbb-cccc-dddddddddddd', 'Hi.');
        await flush();
        expect(alice.opens()).toHaveLength(2);
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        expect(o.fake.reportVoiceHealth).toHaveBeenCalledTimes(1);
    });

    it('never lets a failed report break the voice or wait for Orbit', async () => {
        const { o, alice, session } = await connected({ recognition: 'owner', speech: 'owner' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        o.fake.reportVoiceHealth.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        o.fake.reportVoiceHealth.mockImplementationOnce(() => {
            throw new Error('sync failure');
        });
        expect(() => alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' })).not.toThrow();
        expect(() => alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' })).not.toThrow();
        await flush();
        expect(alice.logs.filter((m) => m.includes('could not tell Orbit'))).toHaveLength(2);
        expect(warn).not.toHaveBeenCalled();
        expect(alice.calls.hasCall(SPACE, 'room_7')).toBe(true);
    });
});

describe('keys', () => {
    it('are in the one message that opens a session, and in nothing else the bot sends, logs or says', async () => {
        const o = orbit();
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        o.state.active.alice = speaking({ parts: { recognition: 'owner', speech: 'owner' } });
        o.state.providers.ears = provider('ears', 'soniox', KEYS.ears);
        o.state.providers['voice-a'] = provider('voice-a', 'elevenlabs', KEYS.voiceA);
        o.state.active.bruno = speaking({ profile: profile({ speech: { providerId: 'voice-b', model: 'tts', voiceId: 'v' } }) });
        o.state.providers['voice-b'] = provider('voice-b', 'cartesia', KEYS.voiceB, { apiKeyEncrypted: 'not:a:key' });
        o.state.active.carol = new Error(`failed with ${KEYS.owner}`);
        const alice = bot('alice', o.fake);
        const bruno = bot('bruno', o.fake);
        const carol = bot('carol', o.fake);

        // A working bubble, with reports of every kind, a refused key and a turn that changes the voice
        await alice.connect();
        alice.joined();
        const session = alice.opens()[0].sessionId;
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        alice.fromWorker({ type: 'provider.failed', sessionId: session, part: 'recognition', adapter: 'soniox', status: 401, rejected: true });
        o.fake.reportVoiceHealth.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
        alice.fromWorker({ type: 'provider.ok', sessionId: session, part: 'speech', adapter: 'elevenlabs' });
        alice.speech.final(SPACE, 'bot-alice-player-7-00000001-aaaa-bbbb-cccc-dddddddddddd', 'Hello.');
        await flush();
        // A bot whose key cannot be read, and one whose Orbit call fails
        await bruno.connect();
        await carol.connect();
        await flush();

        const everything = JSON.stringify([
            ...alice.sent.filter((m) => m.type !== 'session.open'),
            ...bruno.sent,
            ...carol.sent,
            alice.logs,
            bruno.logs,
            carol.logs,
            log.mock.calls,
            warn.mock.calls,
            error.mock.calls,
            info.mock.calls,
            o.fake.reportVoiceHealth.mock.calls,
            alice.game,
            alice.calls.stats,
        ]);
        for (const key of Object.values(KEYS)) expect(everything).not.toContain(key);
        // The keys did reach the worker, in the messages that open a session
        expect(JSON.stringify(alice.opens())).toContain(KEYS.ears);
        expect(JSON.stringify(alice.opens())).toContain(KEYS.voiceA);
        expect(alice.logs.length + bruno.logs.length + carol.logs.length).toBeGreaterThan(0);
    });
});

describe('without Orbit', () => {
    it('opens the session as it always did, with no provider named, when there are no settings', () => {
        const sent: ToWorker[] = [];
        const link: VoiceLink = { isUp: () => true, send: (m) => (sent.push(m), true), close: vi.fn() };
        const game: GameSide = {
            botSpaceUserId: () => BOT_SPACE_ID,
            sendSignal: () => undefined,
            sendDisconnect: () => undefined,
            sendStart: () => undefined,
            sendDraft: () => undefined,
            sendStatus: () => undefined,
        };
        const calls = new VoiceCalls('plain', game, () => link);
        calls.handlePrivateEvent({
            spaceName: SPACE,
            receiverUserId: BOT_SPACE_ID,
            sender: { spaceUserId: 'room_7', uuid: 'u', tags: [], name: 'p' },
            spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'room_7', initiator: false } } },
        } as never);
        expect(sent[0]).toEqual({ type: 'session.open', sessionId: expect.any(String), bubbleId: SPACE, botId: 'plain' });
        expect(calls.beforeSpeaking).toBeUndefined();
    });
});

describe('settings for talking to Orbit', () => {
    it('come from the environment, with a default for each', () => {
        expect(voiceOrbitSettings({})).toEqual(DEFAULT_VOICE_ORBIT_SETTINGS);
        expect(voiceOrbitSettings({ VOICE_ORBIT_TIMEOUT_SECONDS: '2.5', VOICE_ACTIVE_CACHE_SECONDS: '0', VOICE_LIMITS_CACHE_SECONDS: '120' })).toEqual({ timeoutMs: 2500, activeCacheMs: 0, limitsCacheMs: 120000 });
        // A timeout of nothing, or something that is not a number, is not a setting
        expect(voiceOrbitSettings({ VOICE_ORBIT_TIMEOUT_SECONDS: '0', VOICE_ACTIVE_CACHE_SECONDS: 'soon' })).toEqual(DEFAULT_VOICE_ORBIT_SETTINGS);
    });

    it('reuse an answer for a moment, so a bubble that has just started does not ask twice, and never an Orbit error', async () => {
        const o = orbit();
        o.state.active.alice = speaking();
        let clock = 0;
        const settings = new BotVoiceSettings('alice', o.fake, { timeoutMs: 1000, activeCacheMs: 3000, limitsCacheMs: 1000 }, () => undefined, () => clock);
        await settings.active();
        clock = 2000;
        await settings.active();
        expect(o.fake.getVoiceActive).toHaveBeenCalledTimes(1);
        clock = 3500;
        await settings.active();
        expect(o.fake.getVoiceActive).toHaveBeenCalledTimes(2);

        o.state.active.alice = new Error('busy');
        clock = 10000;
        expect(await settings.active()).toEqual({ speaks: false, reason: 'orbit' });
        o.state.active.alice = speaking();
        expect(await settings.active()).toMatchObject({ speaks: true });
    });
});
