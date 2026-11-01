/**
 * A voice bot speaks its replies (#1665), end to end through the bot server: the words it writes are the words it says,
 * only once they are final and checked, a person talking over it stops it and marks the message, and a greeting is said
 * once, never again when the worker comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';
import type { BotConfiguration } from '../server/AdminApiService';

const links: { options: any; send: ReturnType<typeof vi.fn> }[] = [];
vi.mock('../voice/VoiceLink', () => ({
    WorkerLink: class {
        options: any;
        start = vi.fn();
        isUp = () => true;
        send = vi.fn(() => true);
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
    const worker = (m: object) => links[0].options.onMessage({ sessionId, participantId: 'room_3', epoch: 1, ...m });
    return { ...t, worker };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    links.length = 0;
    vi.restoreAllMocks();
});

const says = (): { segmentId: string; text: string; maxMs?: number }[] =>
    links[0].send.mock.calls.map(([m]) => m).filter((m) => m.type === 'bot.say');

/** What the bot put in the chat for everyone, as [responseId, isFinal, text, stoppedBySpeech]. */
const streamed = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls
        .map(([m]) => m.message?.publicEvent?.spaceEvent?.event?.spaceStreamMessage)
        .filter(Boolean)
        .map((s) => [s.responseId, s.isFinal, s.finalContent ?? s.token, s.stoppedBySpeech === true]);

describe('a voice bot says the words it writes', () => {
    it('says a reply once it is final, the same words, after it is in the chat', async () => {
        const t = await voiceBot();
        t.worker({ type: 'participant.join' });
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', 'Hello ', false);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', 'there.', false);
        expect(says()).toEqual([]);
        t.bot.sendStreamMessage(SPACE, 'bot-voice-1-player-3-aaa', '', true, 'Hello there.');
        expect(says()).toEqual([{ type: 'bot.say', sessionId: expect.any(String), segmentId: 's1', text: 'Hello there.', committed: true, maxMs: 60000 }]);
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
