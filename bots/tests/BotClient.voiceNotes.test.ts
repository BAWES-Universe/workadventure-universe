/**
 * A voice note in a bot's nearby chat: heard only when it was sent to the bot (alone with it, a reply to its own message, or from the
 * person it is summoned to) and only then is the clip ever fetched. Everyone who got the note is told what was heard, and the bot
 * answers the words. Anything else is handled exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hearing = vi.hoisted(() => ({ hear: vi.fn(), canHear: vi.fn(), limits: { maxSeconds: 300, maxBytes: 1024, maxChars: 4000 } }));
vi.mock('../voice/NoteHearingWiring', () => ({ sharedNoteHearing: () => hearing }));

import { BotClient } from '../client/BotClient';
import { SocialBehavior, type SocialBehaviorConfig } from '../behaviors/SocialBehavior';
import type { BotAccessGate } from '../server/BotAccessGate';

const SPACE = 'proximity-1';
const KHALID = 7;
const SARA = 8;

const BOT_SPACE_ID = 'room_99';

function noteFrom(id: number, extra: Record<string, unknown> = {}) {
    return {
        $case: 'publicEvent',
        publicEvent: {
            spaceName: SPACE,
            senderUserId: `room_${id}`,
            spaceEvent: {
                event: {
                    $case: 'spaceMessage',
                    spaceMessage: {
                        name: id === KHALID ? 'Khalid' : 'Sara',
                        message: '',
                        id: `note-${id}`,
                        url: 'https://files.example.test/note.webm',
                        mediaType: 'audio',
                        fileName: 'Voice message.webm',
                        voiceDurationMs: 4000,
                        ...extra,
                    },
                },
            },
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
    (bot as unknown as { spaces: Map<string, string> }).spaces.set(SPACE, BOT_SPACE_ID);
    const sent: any[] = [];
    vi.spyOn(bot as unknown as { send(m: unknown): void }, 'send').mockImplementation((m) => void sent.push(m));
    const transcripts = () =>
        sent
            .map((m) => m?.message?.publicEvent?.spaceEvent?.event)
            .filter((e) => e?.$case === 'spaceMessageTranscript')
            .map((e) => e.spaceMessageTranscript);
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
    return { bot, transcripts, behavior, memory, storage, ai, onChatMessage, check, said, receive, nothingKept };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hearing.canHear.mockReset().mockResolvedValue(true);
    hearing.hear.mockReset().mockResolvedValue({ ok: true, text: 'what is on today', provider: 'soniox', timings: {} });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('BotClient: a voice note in nearby chat', () => {
    it('is heard when the person is alone with the bot: the words go to everyone and to the bot', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(noteFrom(KHALID));

        expect(hearing.hear).toHaveBeenCalledTimes(1);
        expect(hearing.hear.mock.calls[0][1]).toBe(`${SPACE}|note-${KHALID}`);
        expect(hearing.hear.mock.calls[0][2]).toMatchObject({ url: 'https://files.example.test/note.webm', seconds: 4 });
        expect(t.transcripts()).toEqual([
            { messageId: `note-${KHALID}`, state: 'listening' },
            { messageId: `note-${KHALID}`, state: 'heard', text: 'what is on today' },
        ]);
        expect(t.onChatMessage.mock.calls[0][1]).toBe('[Voice note] what is on today');
    });

    it('is never fetched in a group when nothing says it is for the bot, even inside the follow-up window', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        await t.receive({ ...noteFrom(KHALID, { message: 'Nora, a note' }) });
        await t.receive({ ...noteFrom(SARA) });

        expect(hearing.hear).not.toHaveBeenCalled();
        expect(t.transcripts()).toEqual([]);
    });

    it('is heard in a group when it replies to the bot\'s own message', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        await t.receive(noteFrom(KHALID, { replyTo: { id: 'bot-line', senderUserId: BOT_SPACE_ID, message: 'Shall I?' } }));

        expect(hearing.hear).toHaveBeenCalledTimes(1);
        expect(t.onChatMessage.mock.calls[0][1]).toBe('[Voice note] what is on today');
    });

    it('is not heard when it replies to someone else\'s message', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(joined(SARA));
        await t.receive(noteFrom(KHALID, { replyTo: { id: 'sara-line', senderUserId: `room_${SARA}`, message: 'Lunch?' } }));
        expect(hearing.hear).not.toHaveBeenCalled();
    });

    it('is left alone when the bot cannot hear (voice off, no hearing set up)', async () => {
        hearing.canHear.mockResolvedValue(false);
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(noteFrom(KHALID));
        expect(hearing.hear).not.toHaveBeenCalled();
        expect(t.transcripts()).toEqual([]);
    });

    it('shows that it could not be heard, and the bot does not answer a file it could not read', async () => {
        hearing.hear.mockResolvedValue({ ok: false, reason: 'failed' });
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(noteFrom(KHALID));

        expect(t.transcripts()).toEqual([
            { messageId: `note-${KHALID}`, state: 'listening' },
            { messageId: `note-${KHALID}`, state: 'failed' },
        ]);
        expect(t.onChatMessage).not.toHaveBeenCalled();
    });

    it('is not a voice note when it is any other audio file', async () => {
        const t = setup();
        await t.receive(joined(KHALID));
        await t.receive(noteFrom(KHALID, { fileName: 'song.mp3' }));
        expect(hearing.hear).not.toHaveBeenCalled();
    });
});
