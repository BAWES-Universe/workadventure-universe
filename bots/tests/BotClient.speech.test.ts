/**
 * A voice bot speaks its replies (#1665), end to end through the bot server: the words it writes are the words it says,
 * only once they are final and checked, a person talking over it stops it and marks the message, and a greeting is said
 * once, never again when the worker comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';
import type { BotConfiguration } from '../server/AdminApiService';

const links: { options: any; send: ReturnType<typeof vi.fn> }[] = [];
/**
 * What the worker says it can do when it accepts a session. `say.onlyFor`: it sends a reply for one person to that
 * person only (#1993). Undefined: a worker from before, which says nothing of the kind and speaks to the whole bubble.
 */
const worker: { features: string[] | undefined } = { features: ['say.onlyFor'] };
vi.mock('../voice/VoiceLink', () => ({
    WorkerLink: class {
        options: any;
        start = vi.fn();
        isUp = () => true;
        // The worker answers a session it accepted, as the real one does
        send = vi.fn((m: any) => {
            if (m.type === 'session.open') {
                const features = worker.features;
                queueMicrotask(() => this.options.onMessage({ type: 'session.start', sessionId: m.sessionId, bubbleId: m.bubbleId, mode: 'talk', engine: { id: 'e', kind: 'ts' }, ...(features ? { features } : {}) }));
            }
            return true;
        });
        close = vi.fn();
        constructor(options: any) {
            this.options = options;
            links.push(this as never);
        }
    },
}));

const SPACE = 'space-1';

function setup(botId: string, voiceEnabled: boolean) {
    const bot = new BotClient({
        botId,
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    bot.setFullConfig({ botId, voiceEnabled } as unknown as BotConfiguration);
    const behavior = {
        onChatMessage: vi.fn().mockResolvedValue(undefined),
        getPersonForAccess: vi.fn().mockReturnValue({ signedIn: true, identifier: 'khalid@example.test' }),
        isPersonKnown: vi.fn().mockReturnValue(true),
        onPlayerLeft: vi.fn(),
        onSpaceUserJoined: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi.fn();
    Object.assign(bot as unknown as { send: unknown; behavior: unknown }, { send, behavior });
    const internals = bot as unknown as { spaces: Map<string, string>; startVoice(): void; handleSubMessage(m: unknown): Promise<void> };
    internals.spaces.set(SPACE, 'room_9');
    const receive = (message: unknown) => internals.handleSubMessage(message);
    return { bot, behavior, send, internals, receive };
}

/** A voice bot with a person talking to it, the way the game sets one up. */
async function voiceBot(botId = 'voice-1') {
    const t = setup(botId, true);
    t.internals.startVoice();
    await t.receive({
        $case: 'initSpaceUsersMessage',
        initSpaceUsersMessage: { spaceName: SPACE, users: [{ spaceUserId: 'room_3', uuid: 'u3', tags: [], name: 'Khalid' }] },
    });
    await t.receive({
        $case: 'privateEvent',
        privateEvent: {
            spaceName: SPACE,
            receiverUserId: 'room_9',
            sender: { spaceUserId: 'room_3', uuid: 'u3', tags: [], name: 'Khalid' },
            spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'room_3', initiator: false } } },
        },
    });
    const sessionId = links[0].send.mock.calls[0][0].sessionId as string;
    // The worker's answer to the session has arrived
    await Promise.resolve();
    const fromWorker = (m: object) => links[0].options.onMessage({ sessionId, participantId: 'room_3', epoch: 1, ...m });
    return { ...t, worker: fromWorker };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    links.length = 0;
    worker.features = ['say.onlyFor'];
    vi.restoreAllMocks();
});

const says = (): { segmentId: string; text: string; maxMs?: number }[] =>
    links[0].send.mock.calls.map(([m]) => m).filter((m) => m.type === 'bot.say');

/** What the bot put in the chat for everyone, as [responseId, isFinal, text, stoppedBySpeech]. */
const streamed = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls
        .map(([m]) => m.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage)
        .filter((s) => s && s.speaking === undefined)
        .map((s) => [s.responseId, s.isFinal, s.finalContent ?? s.token, s.stoppedBySpeech === true]);

/** What the bot told everyone about a reply being heard (round 8), as [responseId, speaking]. */
const speakingEvents = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls
        .map(([m]) => m.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage)
        .filter((s) => s && s.speaking !== undefined)
        .map((s) => [s.responseId, s.speaking]);

describe('a voice bot says the words it writes', () => {
    it('says a reply once it is final, the same words, after it is in the chat', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', 'Hello ', false);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', 'there.', false);
        expect(says()).toEqual([]);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'Hello there.');
        // Khalid is alone with the bot, so the reply is his alone: the worker is given him with it, and sends it to nobody else (#1993)
        expect(says()).toEqual([{ type: 'bot.say', sessionId: expect.any(String), segmentId: 's1', text: 'Hello there.', committed: true, maxMs: 60000, onlyFor: 'room_3' }]);
        // The chat had it first
        expect(streamed(t.send).at(-1)).toEqual(['bot-voice-1-player-3-aaa', true, 'Hello there.', false]);
    });

    it('says a short line for a table and keeps the table in the chat in full', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        const table = 'Here is the week:\n| Day | Done |\n| --- | --- |\n| Mon | 3 |';
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, table);
        expect(says().map((s) => s.text)).toEqual(["Here is the week: I've put the table in the chat."]);
        expect(streamed(t.send).at(-1)![2]).toBe(table);
    });

    it('sends the mood with the final reply and nothing otherwise (#1667)', async () => {
        const t = await voiceBot();
        const moods = () => t.send.mock.calls.map(([m]) => m.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage).filter(Boolean).map((s) => s.mood);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-mmm', 'Hi', false);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-mmm', '', true, 'Hi', false, undefined, false, undefined, '😄');
        expect(moods()).toEqual([undefined, '😄']);
    });

    it('does not say a steps line or an error', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'steps-1', '', true, '{"state":"working"}', false, undefined, false, '{"state":"working"}');
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-bbb', '', false, '', true, "I'm having trouble processing that. Could you rephrase?");
        expect(says()).toEqual([]);
    });

    it('does not say a reply that is not checked, nor the claim a retry replaced', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.holdSpeech(SPACE, 3);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'Rebuilt it, v2 has the charts.\n\nNo new version was saved.');
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-bbb', '', true, 'Making that now.');
        expect(says()).toEqual([]);
        t.bot.releaseSpeech(SPACE, 3);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-ccc', '', true, 'Sorry, I could not save it.');
        expect(says().map((s) => s.text)).toEqual(['Sorry, I could not save it.']);
    });

    it('never speaks for a bot that is not a voice bot', async () => {
        const t = setup('text-1', false);
        t.bot.sendStreamMessage(SPACE, 'bot-text-1-player-3-aaa', '', true, 'Hello there.');
        t.bot.holdSpeech(SPACE, 3);
        t.bot.releaseSpeech(SPACE, 3);
        expect(links).toHaveLength(0);
        expect(streamed(t.send)).toEqual([['bot-text-1-player-3-aaa', true, 'Hello there.', false]]);
    });
});

describe('speaking over the bot', () => {
    it('marks the message for everyone when its voice was cut short, and says nothing else', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'A long answer with a lot to say.');
        t.send.mockClear();
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 840, totalMs: 3000, finished: true, interrupted: true, reason: 'barge_in' });
        expect(streamed(t.send)).toEqual([['bot-voice-1-player-3-aaa', true, '', true]]);
        expect(t.send.mock.calls[0][0].message.publicEvent.spaceName).toBe(SPACE);
    });

    it('marks nothing when no sound had been sent yet, when it ended another way, or for a segment it never made', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'A long answer.');
        t.send.mockClear();
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 0, totalMs: 3000, finished: true, interrupted: true, reason: 'barge_in' });
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 900, totalMs: 3000, finished: true, interrupted: true, reason: 'voice_stop' });
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 900, totalMs: 3000, finished: true, interrupted: true, reason: 'limit' });
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 900, totalMs: 3000, finished: false, interrupted: false });
        t.worker({ type: 'playback.progress', segmentId: 's77', playedMs: 900, totalMs: 3000, finished: true, interrupted: true, reason: 'barge_in' });
        expect(streamed(t.send)).toEqual([]);
    });

    it('does not talk over a person who is speaking, and does not say a reply that was begun before they started', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.worker({ type: 'user.speech_started', turnId: '1-1' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'Welcome!');
        expect(says()).toEqual([]);
        t.worker({ type: 'user.turn', turnId: '1-1', outcome: 'cleared', audioMs: 400 });

        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-bbb', 'Working ', false);
        t.worker({ type: 'user.speech_started', turnId: '1-2' });
        t.worker({ type: 'user.turn', turnId: '1-2', outcome: 'cleared', audioMs: 400 });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-bbb', '', true, 'Working on it.');
        expect(says()).toEqual([]);

        // Their next turn is answered in voice as usual
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-ccc', 'Sure', false);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-ccc', '', true, 'Sure.');
        expect(says().map((s) => s.text)).toEqual(['Sure.']);
    });
});

describe('a greeting', () => {
    it('is said when the first audio connects, once, and never again when the worker comes back', async () => {
        const t = await voiceBot();
        // Finished before anyone's audio is up
        t.bot.sendStreamMessage(SPACE, 'greeting-uuid-1', 'Welcome ', false);
        t.bot.sendStreamMessage(SPACE, 'greeting-uuid-1', '', true, 'Welcome to the lobby!');
        expect(says()).toEqual([]);
        t.worker({ type: 'participant.join' });
        expect(says().map((s) => s.text)).toEqual(['Welcome to the lobby!']);

        // The worker goes away and comes back: the person is asked to connect again, the bot says nothing new
        links[0].options.onDown();
        links[0].options.onUp();
        const again = links[0].send.mock.calls.map(([m]) => m).filter((m) => m.type === 'lane.open').at(-1);
        expect(again.epoch).toBeGreaterThan(1);
        const sessionId = links[0].send.mock.calls.map(([m]) => m).filter((m) => m.type === 'session.open').at(-1).sessionId;
        links[0].options.onMessage({ type: 'participant.join', sessionId, participantId: 'room_3', epoch: again.epoch });
        expect(says().map((s) => s.text)).toEqual(['Welcome to the lobby!']);
    });

    it('is not said late: it is in the chat, and the audio that comes long after hears nothing old', async () => {
        vi.useFakeTimers({ toFake: ['performance'] });
        try {
            const t = await voiceBot();
            t.bot.sendStreamMessage(SPACE, 'greeting-uuid-1', '', true, 'Welcome to the lobby!');
            vi.advanceTimersByTime(20000);
            t.worker({ type: 'participant.join' });
            expect(says()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('Stop speaking (round 8)', () => {
    const tapStop = (t: Awaited<ReturnType<typeof voiceBot>>, responseId: string) =>
        t.receive({
            $case: 'privateEvent',
            privateEvent: {
                spaceName: SPACE,
                receiverUserId: 'room_9',
                sender: { spaceUserId: 'room_3', uuid: 'u3', tags: [], name: 'Khalid' },
                spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode: 'talk', listen: '', stopSpeaking: responseId } } },
            },
        });

    it('tells everyone when a reply starts being heard and when its audio is over', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'A long answer.');
        t.send.mockClear();
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 300, totalMs: 3000, finished: false, interrupted: false });
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 900, totalMs: 3000, finished: false, interrupted: false });
        expect(speakingEvents(t.send)).toEqual([['bot-voice-1-player-3-aaa', true]]);
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 3000, totalMs: 3000, finished: true, interrupted: false, reason: 'completed' });
        expect(speakingEvents(t.send)).toEqual([
            ['bot-voice-1-player-3-aaa', true],
            ['bot-voice-1-player-3-aaa', false],
        ]);
        expect(streamed(t.send)).toEqual([]);
    });

    it('stops the reply on a tap: the worker takes it back and the message is marked, as if someone spoke over it', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'A long answer.');
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 300, totalMs: 3000, finished: false, interrupted: false });
        t.send.mockClear();
        await tapStop(t, 'bot-voice-1-player-3-aaa');
        expect(links[0].send.mock.calls.map(([m]) => m).filter((m) => m.type === 'bot.retract')).toEqual([
            { type: 'bot.retract', sessionId: expect.any(String), segmentId: 's1' },
        ]);
        expect(speakingEvents(t.send)).toEqual([['bot-voice-1-player-3-aaa', false]]);
        expect(streamed(t.send)).toEqual([['bot-voice-1-player-3-aaa', true, '', true]]);
        // The worker's report of the end marks nothing twice
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 400, totalMs: 3000, finished: true, interrupted: true, reason: 'retract' });
        expect(streamed(t.send)).toHaveLength(1);
        expect(speakingEvents(t.send)).toHaveLength(1);
    });

    it('does nothing for a reply that is not being heard', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'Queued, not heard yet.');
        t.send.mockClear();
        await tapStop(t, 'bot-voice-1-player-3-aaa');
        await tapStop(t, 'bot-voice-1-player-3-zzz');
        expect(streamed(t.send)).toEqual([]);
    });
});

describe('a reply for one person alone is said to that person and nobody else (#1993)', () => {
    const REPLY = 'bot-voice-1-player-3-aaa';
    const SARA = { spaceUserId: 'room_4', uuid: 'u4', tags: [], name: 'Sara' };
    const walksUp = (t: Awaited<ReturnType<typeof voiceBot>>) => t.receive({ $case: 'addSpaceUserMessage', addSpaceUserMessage: { spaceName: SPACE, user: SARA } });
    const toWorker = (type: string) => links[0].send.mock.calls.map(([m]) => m).filter((m) => m.type === type);
    /** The lines the bot sent about a reply's voice, as [responseId, what, who it is for]. */
    const notes = (send: ReturnType<typeof vi.fn>) =>
        send.mock.calls
            .map(([m]) => m.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage)
            .filter((s) => s && (s.keptQuiet !== undefined || s.stoppedBySpeech !== undefined))
            .map((s) => [s.responseId, s.keptQuiet ?? 'talked over', s.onlyFor]);

    it('goes on being said when someone walks up: nothing is taken back, and nothing is marked', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.replyStarts(SPACE, 3, true);
        t.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 300, totalMs: 3000, finished: false, interrupted: false });
        expect(toWorker('bot.say')[0]).toMatchObject({ segmentId: 's1', onlyFor: 'room_3' });
        t.send.mockClear();

        await walksUp(t);
        expect(toWorker('bot.retract')).toEqual([]);
        expect(notes(t.send)).toEqual([]);

        // Its audio ends as any reply's does, and what it told about being heard went to its person alone
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 3000, totalMs: 3000, finished: true, interrupted: false, reason: 'completed' });
        const speaking = t.send.mock.calls.map(([m]) => m.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage).filter((s) => s && s.speaking !== undefined);
        expect(speaking.map((s) => [s.speaking, s.onlyFor])).toEqual([[false, 'room_3']]);
    });

    it('is still said to its person when someone walked up while it was being written', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.replyStarts(SPACE, 3, true);
        t.bot.sendStreamMessage(SPACE, REPLY, 'Your interview ', false);
        await walksUp(t);
        t.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

        expect(toWorker('bot.say')).toEqual([expect.objectContaining({ text: 'Your interview is at 10.', onlyFor: 'room_3' })]);
        expect(notes(t.send)).toEqual([]);
    });

    it('is marked for its person when the worker could not keep it to them: not said at all, or stopped part-way', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.replyStarts(SPACE, 3, true);
        t.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
        t.send.mockClear();
        t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'private' });
        expect(notes(t.send)).toEqual([[REPLY, 'unsaid', 'room_3']]);

        t.bot.replyStarts(SPACE, 3, true);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-bbb', '', true, 'And your salary is 1,200.');
        t.worker({ type: 'playback.progress', segmentId: 's2', playedMs: 300, totalMs: 3000, finished: false, interrupted: false });
        t.send.mockClear();
        t.worker({ type: 'playback.progress', segmentId: 's2', playedMs: 900, totalMs: 3000, finished: true, interrupted: true, reason: 'private' });
        expect(notes(t.send)).toEqual([['bot-voice-1-player-3-bbb', 'stopped', 'room_3']]);
    });

    describe('with a worker from before, which speaks to the whole bubble', () => {
        it('is said while its person is alone, with nobody named on it', async () => {
            worker.features = undefined;
            const t = await voiceBot();
            t.worker({ type: 'participant.join' });
            t.bot.replyStarts(SPACE, 3, true);
            t.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

            expect(toWorker('bot.say')).toHaveLength(1);
            expect(toWorker('bot.say')[0]).not.toHaveProperty('onlyFor');
        });

        it('stops when someone walks up, and its person is told why: not that someone spoke over it', async () => {
            worker.features = undefined;
            const t = await voiceBot();
            t.worker({ type: 'participant.join' });
            t.bot.replyStarts(SPACE, 3, true);
            t.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');
            t.worker({ type: 'playback.progress', segmentId: 's1', playedMs: 300, totalMs: 3000, finished: false, interrupted: false });
            t.send.mockClear();

            await walksUp(t);
            expect(toWorker('bot.retract')).toEqual([{ type: 'bot.retract', sessionId: expect.any(String), segmentId: 's1' }]);
            expect(notes(t.send)).toEqual([[REPLY, 'stopped', 'room_3']]);
        });

        it('is not said when someone walked up while it was being written, and its person is told why', async () => {
            worker.features = undefined;
            const t = await voiceBot();
            t.worker({ type: 'participant.join' });
            t.bot.replyStarts(SPACE, 3, true);
            t.bot.sendStreamMessage(SPACE, REPLY, 'Your interview ', false);
            await walksUp(t);
            t.send.mockClear();
            t.bot.sendStreamMessage(SPACE, REPLY, '', true, 'Your interview is at 10.');

            expect(toWorker('bot.say')).toEqual([]);
            expect(notes(t.send)).toEqual([[REPLY, 'unsaid', 'room_3']]);
        });
    });
});
