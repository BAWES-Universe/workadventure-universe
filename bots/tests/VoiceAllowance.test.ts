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
        sendStatus: (_space, to, status) => statuses.push(`${to}:${status}`),
    };
    const state = { active: speakingNow(owners) as ActiveVoice, answers: [] as Answer[], fallback: { allowed: true } as Answer };
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
    };
    const gate = new OrbitTurnGate('sam', orbit, (playerId) => people[playerId] ?? null, (m) => logs.push(m));
    const calls = new VoiceCalls('sam', game, (h) => ((handlers = h), link), (m) => logs.push(m), settings, gate);
    calls.onPaused = (space) => lines.push(`${space}:${pausedLine('Sam')}`);
    const speech = new BotSpeech(calls, DEFAULT_REPLY_LIMITS);
    calls.onAudience = (space) => speech.audience(space);
    const t = {
        sent, statuses, lines, logs, orbit, state, calls, speech,
        says: () => (sent.filter((m) => m.type === 'bot.say') as Extract<ToWorker, { type: 'bot.say' }>[]).map((m) => m.text),
        async connect(who = 'room_7') {
            calls.spaceUsers(SPACE, [{ spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who } as never]);
            calls.handlePrivateEvent({
                spaceName: SPACE,
                receiverUserId: BOT_SPACE_ID,
                sender: { spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who },
                spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: who, initiator: false } } },
            } as never);
            await flush();
            const lane = sent.find((m) => m.type === 'lane.open') as Extract<ToWorker, { type: 'lane.open' }>;
            handlers.onMessage({ type: 'participant.join', sessionId: lane.sessionId, participantId: who, epoch: lane.epoch } as FromWorker);
        },
        /** The worker says the person's audio is connected again (a reconnect). */
        rejoin(who = 'room_7') {
            const lane = [...sent].reverse().find((m) => m.type === 'lane.open') as Extract<ToWorker, { type: 'lane.open' }>;
            handlers.onMessage({ type: 'participant.join', sessionId: lane.sessionId, participantId: who, epoch: lane.epoch } as FromWorker);
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
        const orbit = { checkVoiceAllowance: vi.fn() };
        const gate = new OrbitTurnGate('sam', orbit, () => null);
        expect(await gate.mayUniverseAiSpeak({ turnId: 't' })).toBe('yes');
        expect(gate.personOf({ turnId: 't' })).toBeUndefined();
        expect(orbit.checkVoiceAllowance).not.toHaveBeenCalled();
    });
});
