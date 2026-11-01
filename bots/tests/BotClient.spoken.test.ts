/**
 * What a person says to a voice bot (#1664). The words reach the person alone, as a private draft; when they finish,
 * the person's own game sends one chat line that says it was spoken to this bot. Every other bot in the bubble shows
 * the line but does not take it for a new request, and the bot it is for answers it once.
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

function line(senderUserId: string, message: string, spoken?: { botId: string; turnId: string }) {
    return {
        $case: 'publicEvent',
        publicEvent: {
            spaceName: SPACE,
            senderUserId,
            spaceEvent: { event: { $case: 'spaceMessage', spaceMessage: { name: 'Khalid', message, ...(spoken ? { spoken } : {}) } } },
        },
    };
}

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

describe('a voice bot shows a person what it hears, to them only', () => {
    it('sends the words so far as a private event to that person, naming the bot', async () => {
        const t = await voiceBot();
        t.send.mockClear();
        t.worker({ type: 'user.partial', turnId: '1-1', text: 'Actually which of them' });
        expect(t.send).toHaveBeenCalledTimes(1);
        expect(t.send).toHaveBeenCalledWith({
            message: {
                $case: 'privateEvent',
                privateEvent: {
                    spaceName: SPACE,
                    receiverUserId: 'room_3',
                    spaceEvent: {
                        event: {
                            $case: 'botVoiceDraft',
                            botVoiceDraft: { botId: 'voice-1', botName: 'Nora', turnId: '1-1', state: 'live', text: 'Actually which of them', reason: '' },
                        },
                    },
                },
            },
        });
    });

    it('says why words were lost, and sends nothing in the space for everyone', async () => {
        const t = await voiceBot();
        t.send.mockClear();
        t.worker({ type: 'user.turn', turnId: '1-1', outcome: 'lost', reason: 'cap', text: 'one two three', audioMs: 180000 });
        expect(t.send.mock.calls.map(([m]) => m.message.$case)).toEqual(['privateEvent']);
        expect(t.send.mock.calls[0][0].message.privateEvent.spaceEvent.event.botVoiceDraft).toMatchObject({ state: 'lost', reason: 'cap', text: 'one two three' });
    });
});

describe('a spoken line is for the bot that heard it', () => {
    it('is answered by that bot once, however many times it arrives', async () => {
        const t = await voiceBot();
        t.worker({ type: 'user.turn', turnId: '1-1', outcome: 'final', text: 'Actually which of them replied', audioMs: 1800 });
        await t.receive(line('room_3', 'Actually which of them replied', { botId: 'voice-1', turnId: '1-1' }));
        await t.receive(line('room_3', 'Actually which of them replied', { botId: 'voice-1', turnId: '1-1' }));
        expect(t.behavior.onChatMessage).toHaveBeenCalledTimes(1);
        expect(t.behavior.onChatMessage.mock.calls[0][1]).toBe('Actually which of them replied');
    });

    it('is an ordinary line when the bot never heard those words, so a made-up mark gains nothing', async () => {
        const t = await voiceBot();
        await t.receive(line('room_3', 'something typed', { botId: 'voice-1', turnId: '9-9' }));
        expect(t.behavior.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('is only shown, never taken as a request, by a text-only bot in the same bubble', async () => {
        const t = setup('text-1', false);
        await t.receive(line('room_3', 'Actually which of them replied', { botId: 'voice-1', turnId: '1-1' }));
        expect(t.behavior.onChatMessage).not.toHaveBeenCalled();
        // Its own typed lines are still answered
        await t.receive(line('room_3', 'typed hello'));
        expect(t.behavior.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('is only shown by another voice bot too', async () => {
        const t = await voiceBot('voice-2');
        await t.receive(line('room_3', 'for the other one', { botId: 'voice-1', turnId: '1-1' }));
        expect(t.behavior.onChatMessage).not.toHaveBeenCalled();
    });

    it('does not make a text-only bot treat a line marked for itself as spoken: it has no ears', async () => {
        const t = setup('text-1', false);
        await t.receive(line('room_3', 'typed with a mark', { botId: 'text-1', turnId: '1-1' }));
        expect(t.behavior.onChatMessage).toHaveBeenCalledTimes(1);
    });

    it('answers typed lines as before', async () => {
        const t = await voiceBot();
        await t.receive(line('room_3', 'hello'));
        await t.receive(line('room_3', 'hello'));
        expect(t.behavior.onChatMessage).toHaveBeenCalledTimes(2);
    });
});
