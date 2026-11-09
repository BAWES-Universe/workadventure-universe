/**
 * Game #1670, the Stop half: with several people in a voice bot's nearby chat, a person telling the bot they are done
 * (judged by the bot itself, in its emotion block) ends only their own follow-up window. A real social behavior runs
 * behind the bot here, with its AI scripted.
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

let turn = 0;
/** A line the person said out loud to this voice bot (#1664), not typed: the game marks it as spoken to the bot. */
function spokenFrom(id: number, message: string) {
    const typed = chatFrom(id, message);
    Object.assign(typed.publicEvent.spaceEvent.event.spaceMessage, { spoken: { botId: 'bot-1', turnId: `turn-${++turn}` } });
    return typed;
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
    // A voice bot standing in the space; what it streams to the chat and sends privately is watched
    vi.spyOn(bot, 'isVoiceBot').mockReturnValue(true);
    (bot as unknown as { spaces: Map<string, string> }).spaces.set(SPACE, 'room_1');
    const streamed = vi.spyOn(bot, 'sendStreamMessage');
    const sent: any[] = [];
    vi.spyOn(bot as any, 'send').mockImplementation((message: any) => void sent.push(message));
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
    return { bot, behavior, memory, storage, ai, onChatMessage, check, said, receive, nothingKept, streamed, sent };
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


const block = (extra: string) =>
    `[EMOTION_UPDATE]{"personSentiment":0,"isInsult":false,"insultSeverity":0,"context":"neutral"${extra}}[/EMOTION_UPDATE]`;

/** What the scripted AI writes for the next turn: its words, then the emotion block. */
function script(t: ReturnType<typeof setup>, words: string, extra = '') {
    t.ai.generateBotResponseStream.mockImplementationOnce((async function* () {
        yield { content: words ? `${words} ${block(extra)}` : block(extra), done: false };
        yield { content: '', done: true };
    }) as never);
}

const privateTo = (sent: any[], $case: string) =>
    sent.filter((m) => m.message?.privateEvent?.spaceEvent?.event?.$case === $case).map((m) => m.message.privateEvent.receiverUserId);

/** Both people have been answered, so both are inside their follow-up window. */
async function bothAnswered(t: ReturnType<typeof setup>) {
    await t.receive(joined(KHALID));
    await t.receive(joined(SARA));
    script(t, 'Sure.');
    await t.receive(chatFrom(KHALID, 'Nora, what do you think?'));
    script(t, 'Yes.');
    await t.receive(chatFrom(SARA, 'Nora, and you?'));
    t.onChatMessage.mockClear();
    t.sent.length = 0;
    t.streamed.mockClear();
    t.memory.addMessage.mockClear();
}

describe('a voice bot told "stop" by one of several people', () => {
    it('ends only that person\'s window, says nothing, waves on its box and tells only them', async () => {
        const t = setup();
        await bothAnswered(t);

        script(t, '', ', "doneTalking": true');
        await t.receive(chatFrom(KHALID, 'ok that is all, stop'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);

        // Nothing is said: the only final is empty and carries the wave
        const finals = t.streamed.mock.calls.filter((call) => call[3] === true);
        expect(finals).toHaveLength(1);
        expect(finals[0][4]).toBe('');
        expect(finals[0][9]).toBe('👋');
        // Nothing is kept as the bot's words
        expect(t.memory.addMessage.mock.calls.filter((call) => call[3] === 'bot')).toEqual([]);
        // A private notice to Khalid, and to nobody else
        expect(privateTo(t.sent, 'botVoiceDone')).toEqual(['room_7']);

        // Khalid needs the name again, Sara still has her window, and the name works for Khalid at once
        t.onChatMessage.mockClear();
        await t.receive(chatFrom(KHALID, 'and one more thing'));
        expect(t.onChatMessage).not.toHaveBeenCalled();
        await t.receive(chatFrom(SARA, 'and one more thing'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        expect(t.onChatMessage.mock.calls[0][2]).toBe(SARA);
        script(t, 'Back.');
        await t.receive(chatFrom(KHALID, 'Nora, I have one more thing'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(2);
    });

    it('does not answer what was said while it thought about "stop", nor ask the classifier about it, and stays quiet after', async () => {
        const t = setup();
        await bothAnswered(t);

        // The bot is slow to judge "stop": people go on talking meanwhile, and each line waits behind it
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        t.ai.generateBotResponseStream.mockImplementationOnce((async function* () {
            await gate;
            yield { content: block(', "doneTalking": true'), done: false };
            yield { content: '', done: true };
        }) as never);
        t.ai.quickClassify.mockClear();
        const stop = t.receive(chatFrom(KHALID, 'ok that is all, stop'));
        await new Promise((resolve) => setTimeout(resolve, 30));
        await t.receive(spokenFrom(KHALID, 'so what did you think of the plan'));
        await t.receive(spokenFrom(KHALID, 'and the budget'));
        // More than the queue holds: the rest is dropped without the "I'll answer once I've finished" line, which would be spoken to the room
        for (const line of ['and the dates', 'and the team', 'and the risks']) await t.receive(spokenFrom(KHALID, line));
        expect(t.ai.quickClassify).not.toHaveBeenCalled();
        expect(t.streamed.mock.calls.some((call) => String(call[4]).includes("I'll answer your messages"))).toBe(false);
        release();
        await stop;
        await new Promise((resolve) => setTimeout(resolve, 50));

        // The stop was judged, the lines said meanwhile were dropped unanswered, and nothing was said
        expect(t.ai.generateBotResponseStream).toHaveBeenCalledTimes(3);
        expect(privateTo(t.sent, 'botVoiceDone')).toEqual(['room_7']);
        const finals = t.streamed.mock.calls.filter((call) => call[3] === true);
        expect(finals.map((call) => call[4])).toEqual(['']);

        // Talk after it is not for the bot, however long it goes on; only the name brings Khalid back
        t.onChatMessage.mockClear();
        for (const line of ['yes the budget is fine', 'what about Tuesday', 'and the plan']) await t.receive(chatFrom(KHALID, line));
        expect(t.onChatMessage).not.toHaveBeenCalled();
        script(t, 'Back.');
        await t.receive(chatFrom(KHALID, 'Nora, one more thing'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
        // ...and once it answered him, he can follow up again as before
        await t.receive(chatFrom(KHALID, 'and the day after'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(2);
    });

    it('keeps a line that calls the bot by name even when it was said while the bot thought about "stop", and answers it', async () => {
        const t = setup();
        await bothAnswered(t);

        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        t.ai.generateBotResponseStream.mockImplementationOnce((async function* () {
            await gate;
            yield { content: block(', "doneTalking": true'), done: false };
            yield { content: '', done: true };
        }) as never);
        const stop = t.receive(chatFrom(KHALID, 'ok that is all, stop'));
        await new Promise((resolve) => setTimeout(resolve, 30));
        await t.receive(spokenFrom(KHALID, 'so what did you think of the plan'));
        await t.receive(spokenFrom(KHALID, 'Nora, actually what about the risks'));
        script(t, 'The risks are small.');
        release();
        await stop;
        await new Promise((resolve) => setTimeout(resolve, 80));

        // The plan talk was dropped; the call by name was answered, and his window is open again after it
        expect(privateTo(t.sent, 'botVoiceDone')).toEqual(['room_7']);
        const said = t.streamed.mock.calls.filter((call) => call[3] === true).map((call) => call[4]);
        expect(said).toEqual(['', 'The risks are small.']);
        t.onChatMessage.mockClear();
        script(t, 'Sure.');
        await t.receive(chatFrom(KHALID, 'and the day after'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('drops words the bot wrote anyway, so nothing is said or spoken', async () => {
        const t = setup();
        await bothAnswered(t);

        script(t, 'Okay, bye!', ', "doneTalking": true');
        await t.receive(chatFrom(KHALID, 'we are done'));

        const finals = t.streamed.mock.calls.filter((call) => call[3] === true);
        expect(finals.map((call) => call[4])).toEqual(['']);
        expect(t.memory.addMessage.mock.calls.filter((call) => call[3] === 'bot')).toEqual([]);
    });

    it('does not end anything when the bot does not judge it so (a quoted or unrelated "stop")', async () => {
        const t = setup();
        await bothAnswered(t);

        script(t, 'You press the red button to stop the music.');
        await t.receive(chatFrom(KHALID, 'how do I stop the music?'));

        const finals = t.streamed.mock.calls.filter((call) => call[3] === true);
        expect(finals[0][4]).toBe('You press the red button to stop the music.');
        expect(finals[0][9]).not.toBe('👋');
        expect(privateTo(t.sent, 'botVoiceDone')).toEqual([]);
        t.onChatMessage.mockClear();
        await t.receive(chatFrom(KHALID, 'and the volume?'));
        expect(t.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('does not apply to a bot that is not a voice bot, or to a person alone with it', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        // Alone: nothing to end
        expect(t.bot.mayEndFollowUp(SPACE, KHALID)).toBe(false);
        expect(t.bot.endFollowUp(SPACE, KHALID)).toBe(false);
        await t.receive(joined(SARA));
        expect(t.bot.mayEndFollowUp(SPACE, KHALID)).toBe(true);
        vi.spyOn(t.bot, 'isVoiceBot').mockReturnValue(false);
        expect(t.bot.mayEndFollowUp(SPACE, KHALID)).toBe(false);
        expect(t.bot.endFollowUp(SPACE, KHALID)).toBe(false);
        expect(privateTo(t.sent, 'botVoiceDone')).toEqual([]);
    });

    it('is not offered to a person the bot is on a summon to', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        vi.spyOn(t.behavior, 'isSummonedBy').mockImplementation((id: number) => id === KHALID);
        expect(t.bot.mayEndFollowUp(SPACE, KHALID)).toBe(false);
        expect(t.bot.mayEndFollowUp(SPACE, SARA)).toBe(true);
    });
});

describe('a person who TYPES while a voice bot answers them, with others in the bubble', () => {
    /** The bot is in the middle of a long answer to Khalid: it has written a first part and is still working. */
    async function midAnswer(t: ReturnType<typeof setup>) {
        await bothAnswered(t);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        t.ai.generateBotResponseStream.mockImplementationOnce((async function* (...args: unknown[]) {
            yield { content: 'Here is the first part of the plan. ', done: false };
            await gate;
            // As a provider does: a stream that was cut off ends there
            if ((args[9] as AbortSignal | undefined)?.aborted) throw new Error('aborted');
            yield { content: `And here is the rest of the plan. ${block('')}`, done: false };
            yield { content: '', done: true };
        }) as never);
        t.ai.quickClassify.mockClear();
        const answering = t.receive(chatFrom(KHALID, 'Nora, write me the whole plan'));
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { answering, release };
    }

    const finals = (t: ReturnType<typeof setup>) => t.streamed.mock.calls.filter((call) => call[3] === true).map((call) => String(call[4]));

    it('still stops the answer on a typed "stop"', async () => {
        const t = setup();
        const { answering, release } = await midAnswer(t);
        t.ai.quickClassify.mockResolvedValueOnce({ action: 'cancel', message: 'Okay, I stopped.' });

        await t.receive(chatFrom(KHALID, 'stop'));
        expect(t.ai.quickClassify).toHaveBeenCalledTimes(1);
        expect(t.ai.quickClassify.mock.calls[0][2]).toBe('stop');
        release();
        await answering;
        await new Promise((resolve) => setTimeout(resolve, 50));

        // The answer was cut off where it was, the stop was confirmed, and the rest was never said
        expect(finals(t)).toContain('Okay, I stopped.');
        expect(finals(t).some((text) => text.includes('the rest of the plan'))).toBe(false);
    });

    it('still changes the answer on a typed "do this instead"', async () => {
        const t = setup();
        const { answering, release } = await midAnswer(t);
        t.ai.quickClassify.mockResolvedValueOnce({ action: 'update', message: 'Sure, the short one then.' });
        script(t, 'Short plan: ship on Tuesday.');

        await t.receive(chatFrom(KHALID, 'actually just give me the short version instead'));
        release();
        await answering;
        await new Promise((resolve) => setTimeout(resolve, 50));

        // The long answer was dropped and the new request answered in its place
        expect(t.ai.quickClassify).toHaveBeenCalledTimes(1);
        const asked = t.ai.generateBotResponseStream.mock.calls.map((call: unknown[]) => call.find((arg) => typeof arg === 'string' && arg.includes('short version')));
        expect(asked.filter(Boolean)).toHaveLength(1);
        expect(finals(t)).toContain('Short plan: ship on Tuesday.');
        expect(finals(t).some((text) => text.includes('the rest of the plan'))).toBe(false);
    });

    it('says it is busy when more typed lines come than wait in line, instead of dropping them without a word', async () => {
        const t = setup();
        const { answering, release } = await midAnswer(t);
        t.ai.quickClassify.mockResolvedValue({ action: 'queue', message: '' });

        for (const line of ['and the dates', 'and the team', 'and the budget', 'and the risks']) await t.receive(chatFrom(KHALID, line));
        expect(t.ai.quickClassify).toHaveBeenCalledTimes(4);
        expect(finals(t).some((text) => text.includes("I'll answer your messages"))).toBe(true);
        release();
        await answering;
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
});
