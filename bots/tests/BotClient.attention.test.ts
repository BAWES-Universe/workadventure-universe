/**
 * Game #1220 (b): with several people in a bot's nearby chat it only hears the one talking to it. A real social
 * behavior runs behind the bot here, with its memory, its saved chats and its AI watched: what a person who never
 * addressed the bot says leaves nothing in any of them, and nobody is asked about their access either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';
import { SocialBehavior, type SocialBehaviorConfig } from '../behaviors/SocialBehavior';
import type { BotAccessGate } from '../server/BotAccessGate';

const SPACE = 'proximity-1';
const KHALID = 7;
const SARA = 8;

function chatFrom(id: number, message: string) {
    return {
        $case: 'publicEvent',
        publicEvent: {
            spaceName: SPACE,
            senderUserId: `room_${id}`,
            spaceEvent: { event: { $case: 'spaceMessage', spaceMessage: { name: id === KHALID ? 'Khalid' : 'Sara', message } } },
        },
    };
}

const joined = (id: number) => ({
    $case: 'addSpaceUserMessage',
    addSpaceUserMessage: { spaceName: SPACE, user: { spaceUserId: `room_${id}`, name: `P${id}`, uuid: `uuid-${id}`, isLogged: true } },
});
const botJoined = (id: number) => ({
    $case: 'addSpaceUserMessage',
    addSpaceUserMessage: { spaceName: SPACE, user: { spaceUserId: `room_${id}`, name: 'Other bot', uuid: 'bot-other', isLogged: false, tags: ['bot'] } },
});
const left = (id: number) => ({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: SPACE, spaceUserId: `room_${id}` } });

const behaviorConfig: SocialBehaviorConfig = {
    type: 'social',
    assignedSpace: { center: { x: 0, y: 0 }, radius: 200 },
    conversationRadius: 150,
    minTimeBetweenConversations: 300000,
    maxConversationDuration: 300000,
    conversationHistorySize: 50,
    respectPlayerStatus: true,
    maxConcurrentConversations: 1,
    wanderRadius: 200,
    wanderCenter: { x: 0, y: 0 },
    wanderSpeed: 50,
    approachDistance: 50,
};

function setup() {
    const bot = new BotClient({
        botId: 'bot-1',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    bot.setFullConfig({ botId: 'bot-1', aiProviderRef: 'provider-1', chatInstructions: 'Be nice.' } as never);

    // What must stay empty for someone the bot was not spoken to by
    const memory = {
        addMessage: vi.fn(),
        extractPersonalInfo: vi.fn(),
        startConversation: vi.fn(),
        getConversationContext: vi.fn(() => ''),
        getPersonalInfo: vi.fn(() => undefined),
        updateEmotionsFromAI: vi.fn(),
    };
    const storage = {
        startConversation: vi.fn(),
        addMessage: vi.fn().mockResolvedValue(undefined),
        endConversation: vi.fn().mockResolvedValue(undefined),
    };
    const ai = {
        generateBotResponseStream: vi.fn(async function* () {
            yield { type: 'content', content: 'Sure.' };
        }),
        quickGenerate: vi.fn().mockResolvedValue('Sure.'),
        quickClassify: vi.fn().mockResolvedValue(null),
        isRestingLine: vi.fn(() => false),
    };
    const behavior = new SocialBehavior(behaviorConfig);
    behavior.setBot(bot);
    behavior.setServices(ai as never, {} as never, storage as never);
    behavior.setConversationMemory(memory as never);
    // Spy on the one entry point, keeping the real behavior behind it
    const onChatMessage = vi.spyOn(behavior, 'onChatMessage');
    bot.setBehavior(behavior);
    // The gate that asks Orbit who may chat: nobody should be asked about a line that was not for the bot
    const check = vi.fn().mockResolvedValue({ allowed: true, kind: 'allowed' });
    bot.setAccessGate({ check } as unknown as BotAccessGate);
    const said = vi.spyOn(bot, 'sendChatMessage').mockImplementation(() => undefined);
    vi.spyOn(bot, 'startTyping').mockImplementation(() => undefined);
    const receive = async (message: unknown) => {
        await (bot as unknown as { handleSubMessage(m: unknown): Promise<void> }).handleSubMessage(message);
        // Let the behavior's own (not awaited) work finish
        await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const nothingKept = () => {
        expect(onChatMessage).not.toHaveBeenCalled();
        expect(memory.addMessage).not.toHaveBeenCalled();
        expect(memory.extractPersonalInfo).not.toHaveBeenCalled();
        expect(storage.startConversation).not.toHaveBeenCalled();
        expect(storage.addMessage).not.toHaveBeenCalled();
        expect(ai.generateBotResponseStream).not.toHaveBeenCalled();
        expect(ai.quickGenerate).not.toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
    };
    return { bot, behavior, memory, storage, ai, onChatMessage, check, said, receive, nothingKept };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BOT_FOLLOW_UP_SECONDS;
});

describe('BotClient: a bot only hears the person talking to it', () => {
    it('leaves no transcript, memory, personal facts, AI call or access check for a person who never addressed it', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));

        await t.receive(chatFrom(SARA, 'Khalid, lunch at one? My name is Sara and my birthday is 3 May'));
        await t.receive(chatFrom(KHALID, 'sounds good to me'));

        t.nothingKept();
        expect(t.said).not.toHaveBeenCalled();
    });

    it('hears and answers the person who says its name, saves only their words, and the answer is for the bubble', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));

        await t.receive(chatFrom(SARA, 'we should get lunch'));
        await t.receive(chatFrom(KHALID, 'Nora, what do you think?'));

        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        expect(t.onChatMessage.mock.calls[0].slice(0, 3)).toEqual([SPACE, 'Nora, what do you think?', KHALID]);
        expect(t.check).toHaveBeenCalledTimes(1);
        expect(t.memory.addMessage).toHaveBeenCalledWith('bot-1', KHALID, 'Nora, what do you think?', 'person', SPACE);
        expect(t.memory.addMessage.mock.calls.filter((call) => call[1] === SARA)).toEqual([]);
        expect(t.storage.addMessage).toHaveBeenCalledWith('bot-1', 'uuid-7', 'Nora, what do you think?', 'person');
        expect(t.ai.generateBotResponseStream).toHaveBeenCalled();
    });

    it('keeps listening to the person it answered for the follow-up window, and not to anyone else', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        await t.receive(chatFrom(KHALID, 'Nora, what do you think?'));
        t.onChatMessage.mockClear();

        await t.receive(chatFrom(SARA, 'and what about tomorrow?'));
        expect(t.onChatMessage).not.toHaveBeenCalled();

        await t.receive(chatFrom(KHALID, 'and what about tomorrow?'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        expect(t.onChatMessage.mock.calls[0][2]).toBe(KHALID);
    });

    it('goes back to needing the name once the window has passed', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const t = setup();
            await t.receive(joined(KHALID));
            await t.receive(joined(SARA));
            await t.receive(chatFrom(KHALID, 'Nora, what do you think?'));
            t.onChatMessage.mockClear();

            vi.advanceTimersByTime(31_000);
            await t.receive(chatFrom(KHALID, 'and tomorrow?'));
            expect(t.onChatMessage).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('takes the window length from BOT_FOLLOW_UP_SECONDS and tells the game', async () => {
        process.env.BOT_FOLLOW_UP_SECONDS = '12';
        const t = setup();
        expect((t.bot as unknown as { attention: { followUpSeconds: number } }).attention.followUpSeconds).toBe(12);
    });

    it('works exactly as before with one person, and again once the others have left', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(chatFrom(KHALID, 'what is the weather?'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);

        await t.receive(joined(SARA));
        t.onChatMessage.mockClear();
        await t.receive(chatFrom(SARA, 'hello?'));
        expect(t.onChatMessage).not.toHaveBeenCalled();

        await t.receive(left(SARA));
        await t.receive(chatFrom(SARA, 'hello? (late message, no longer in the bubble)'));
        await t.receive(chatFrom(KHALID, 'is anyone there'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        expect(t.onChatMessage.mock.calls[0][2]).toBe(KHALID);
    });

    it('does not count another bot as company, whatever its number', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(botJoined(40));
        await t.receive(chatFrom(KHALID, 'what is the weather?'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('takes a follow-up sent while it is still answering, as part of the same conversation', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        // The answer takes a long time
        let finish!: () => void;
        const slow = new Promise<void>((resolve) => (finish = resolve));
        t.ai.generateBotResponseStream.mockImplementationOnce(async function* () {
            await slow;
            yield { type: 'content', content: 'Done.' };
        });
        await t.receive(chatFrom(KHALID, 'Nora, research the market'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);

        await t.receive(chatFrom(SARA, 'and add the prices'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        await t.receive(chatFrom(KHALID, 'and add the prices'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(2);
        finish();
    });

    it('starts the follow-up window when the answer is finished, also for a line that waited its turn', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            const t = setup();
            await t.receive(joined(KHALID));
            await t.receive(joined(SARA));
            const attention = (t.bot as unknown as { attention: { attention(space: string, id: number, text: string): string } }).attention;
            let finish!: () => void;
            const slow = new Promise<void>((resolve) => (finish = resolve));
            t.ai.generateBotResponseStream.mockImplementationOnce(async function* () {
                await slow;
                yield { type: 'content', content: 'Done.' };
            });
            await t.receive(chatFrom(KHALID, 'Nora, research the market'));
            vi.advanceTimersByTime(60_000);
            expect(attention.attention(SPACE, KHALID, 'and the prices?')).toBe('follow-up');
            finish();
            await new Promise((resolve) => setTimeout(resolve, 50));
            // Answered just now: 20 seconds later is still inside the window, 40 is not
            vi.advanceTimersByTime(20_000);
            expect(attention.attention(SPACE, KHALID, 'and the prices?')).toBe('follow-up');
            vi.advanceTimersByTime(20_000);
            expect(attention.attention(SPACE, KHALID, 'and the prices?')).toBe('ignored');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a person in the conversation while a spoken answer to them plays, and starts their window when it is over', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        const internals = t.bot as unknown as {
            attention: { attention(space: string, id: number, text: string): string };
            speech: { onOver?: (space: string, person: number) => void; isSpeakingTo(person: number): boolean } | null;
        };
        // A voice bot's speech: Khalid's answer is playing
        let playing = true;
        internals.speech = { isSpeakingTo: (person: number) => playing && person === KHALID };
        expect(internals.attention.attention(SPACE, KHALID, 'wait, one more thing')).toBe('follow-up');
        expect(internals.attention.attention(SPACE, SARA, 'wait, one more thing')).toBe('ignored');
        playing = false;
        expect(internals.attention.attention(SPACE, KHALID, 'wait, one more thing')).toBe('ignored');
    });

    it('does not open the follow-up window with a greeting: a greeted newcomer still needs the name, until the bot has answered them', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        // The bot greets Sara as she arrives (the bot speaking first, not an answer to her)
        const social = t.behavior as unknown as {
            currentSpaceName: string;
            activeConversations: Map<number, unknown>;
            sendGreetingWithRetry(space: string, text: string, botId: string, playerId: number, attempt: number): void;
        };
        social.currentSpaceName = SPACE;
        social.activeConversations.set(SARA, {});
        (t.bot as unknown as { spaces: Map<string, number> }).spaces.set(SPACE, 1);
        const streamed = vi.spyOn(t.bot, 'sendStreamMessage').mockImplementation(() => undefined);
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        try {
            social.sendGreetingWithRetry(SPACE, 'Hi Sara, welcome!', 'bot-1', SARA, 0);
            await vi.advanceTimersByTimeAsync(1500);
        } finally {
            vi.useRealTimers();
        }
        expect(streamed).toHaveBeenCalled();
        social.activeConversations.delete(SARA);

        // Her reply without the name is not for the bot
        await t.receive(chatFrom(SARA, 'thanks, nice to be here'));
        expect(t.onChatMessage).not.toHaveBeenCalled();

        // With the name she is heard, and after that answer she can go on without it
        await t.receive(chatFrom(SARA, 'Nora, what is on today?'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        t.onChatMessage.mockClear();
        await t.receive(chatFrom(SARA, 'and tomorrow?'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('hears the person it is summoned to, even without its name, until the summon ends', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        const state = t.behavior as unknown as { isSummoned: boolean; summonedPlayerUuid: string | null };

        // A summon that failed or ended leaves nothing behind
        await t.receive(chatFrom(KHALID, 'thanks for coming'));
        expect(t.onChatMessage).not.toHaveBeenCalled();

        state.isSummoned = true;
        state.summonedPlayerUuid = 'uuid-7';
        await t.receive(chatFrom(SARA, 'who called it?'));
        expect(t.onChatMessage).not.toHaveBeenCalled();
        await t.receive(chatFrom(KHALID, 'thanks for coming'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        expect(t.onChatMessage.mock.calls[0][2]).toBe(KHALID);
    });
});
