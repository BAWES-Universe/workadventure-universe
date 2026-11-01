/**
 * Which bots get voice: only a bot whose configuration says voice is on. Every other bot keeps today's behaviour:
 * a plain "bot" token, no socket to the worker, and game events about audio connections change nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { BotClient } from '../client/BotClient';
import type { BotConfiguration } from '../server/AdminApiService';

const links: { start: ReturnType<typeof vi.fn>; options: any }[] = [];
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

const config = (voiceEnabled?: boolean): BotConfiguration => ({ botId: 'abc', voiceEnabled } as unknown as BotConfiguration);

function setup(voiceEnabled?: boolean) {
    const bot = new BotClient({
        botId: 'abc',
        name: 'Echo',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    if (voiceEnabled !== undefined) bot.setFullConfig(config(voiceEnabled));
    const send = vi.fn();
    Object.assign(bot as unknown as { send: unknown }, { send });
    const internals = bot as unknown as { spaces: Map<string, string>; startVoice(): void; handleSubMessage(m: unknown): Promise<void>; generateBotToken(): string };
    internals.spaces.set('space-1', 'room_9');
    return { bot, send, internals };
}

const startEvent = {
    $case: 'privateEvent',
    privateEvent: {
        spaceName: 'space-1',
        receiverUserId: 'room_9',
        sender: { spaceUserId: 'room_3', uuid: 'u3', tags: [], name: 'Sam' },
        spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'room_3', initiator: false } } },
    },
};

afterEach(() => {
    links.length = 0;
});

describe('BotClient voice', () => {
    it('is a voice bot only when its configuration says voice is on', () => {
        expect(setup().bot.isVoiceBot()).toBe(false);
        expect(setup(false).bot.isVoiceBot()).toBe(false);
        expect(setup(true).bot.isVoiceBot()).toBe(true);
    });

    it('signs a plain bot token for a text-only bot, and a voice token for a voice bot', () => {
        const tags = (t: ReturnType<typeof setup>) => (jwt.decode(t.internals.generateBotToken()) as { tags: string[] }).tags;
        expect(tags(setup())).toEqual(['bot']);
        expect(tags(setup(false))).toEqual(['bot']);
        expect(tags(setup(true))).toEqual(['bot', 'voice-bot']);
    });

    it('does not open a socket to the worker, or answer audio events, for a text-only bot', async () => {
        const { internals, send } = setup(false);
        internals.startVoice();
        await internals.handleSubMessage(startEvent);
        expect(links).toEqual([]);
        expect(send).not.toHaveBeenCalled();
    });

    it('opens the socket to the worker for a voice bot and relays a person\'s start to it', async () => {
        const { internals, send } = setup(true);
        internals.startVoice();
        expect(links).toHaveLength(1);
        expect(links[0].start).toHaveBeenCalled();
        await internals.handleSubMessage(startEvent);
        expect((links[0] as any).send).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.open' }));
        expect((links[0] as any).send).toHaveBeenCalledWith(expect.objectContaining({ type: 'lane.open', participantId: 'room_3', epoch: 1 }));
        expect(send).not.toHaveBeenCalled();
    });

    it('answers a signal from the worker with a private event to that person only', async () => {
        const { internals, send } = setup(true);
        internals.startVoice();
        await internals.handleSubMessage(startEvent);
        const sessionId = (links[0] as any).send.mock.calls[0][0].sessionId;
        links[0].options.onMessage({ type: 'lane.signal', sessionId, participantId: 'room_3', epoch: 1, signal: { type: 'answer', sdp: 'x' } });
        expect(send).toHaveBeenCalledWith({
            message: {
                $case: 'privateEvent',
                privateEvent: { spaceName: 'space-1', receiverUserId: 'room_3', spaceEvent: { event: { $case: 'webRtcSignal', webRtcSignal: { signal: JSON.stringify({ type: 'answer', sdp: 'x' }) } } } },
            },
        });
    });

    it('tells the person to disconnect when the worker goes down', async () => {
        const { internals, send } = setup(true);
        internals.startVoice();
        await internals.handleSubMessage(startEvent);
        links[0].options.onDown();
        expect(send).toHaveBeenCalledWith({
            message: {
                $case: 'privateEvent',
                privateEvent: { spaceName: 'space-1', receiverUserId: 'room_3', spaceEvent: { event: { $case: 'webRtcDisconnectMessage', webRtcDisconnectMessage: { userId: 'room_9' } } } },
            },
        });
    });

    it('closes the socket to the worker when the bot disconnects', () => {
        const { bot, internals } = setup(true);
        internals.startVoice();
        bot.disconnect();
        expect((links[0] as any).close).toHaveBeenCalled();
    });
});
