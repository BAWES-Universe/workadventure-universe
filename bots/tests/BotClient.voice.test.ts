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
        // The only thing the game is told: where the audio stands, for that person alone (#1666)
        expect(send.mock.calls.map(([m]) => m.message.privateEvent.spaceEvent.event.$case)).toEqual(['botVoiceStatus']);
    });

    it('tells a person its voice is connecting, naming itself, and takes their mode choice to the worker', async () => {
        const { internals, send } = setup(true);
        internals.startVoice();
        await internals.handleSubMessage(startEvent);
        expect(send).toHaveBeenCalledWith({
            message: {
                $case: 'privateEvent',
                privateEvent: {
                    spaceName: 'space-1',
                    receiverUserId: 'room_3',
                    spaceEvent: { event: { $case: 'botVoiceStatus', botVoiceStatus: { botId: 'abc', botName: 'Echo', state: 'connecting', followUpSeconds: 0 } } },
                },
            },
        });
        const choice = (mode: string, tags: string[] = []) => ({
            $case: 'privateEvent',
            privateEvent: {
                spaceName: 'space-1',
                receiverUserId: 'room_9',
                sender: { spaceUserId: 'room_3', uuid: 'u3', tags, name: 'Sam' },
                spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode } } },
            },
        });
        await internals.handleSubMessage(choice('type_and_listen'));
        await internals.handleSubMessage(choice('off', ['bot']));
        expect((links[0] as any).send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mode.set', mode: 'type_and_listen', participantId: 'room_3' }));
        expect((links[0] as any).send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mode.set', mode: 'off' }));
    });

    it('answers a mode choice with nothing for a text-only bot', async () => {
        const { internals, send } = setup(false);
        internals.startVoice();
        await internals.handleSubMessage({
            $case: 'privateEvent',
            privateEvent: {
                spaceName: 'space-1',
                receiverUserId: 'room_9',
                sender: { spaceUserId: 'room_3', uuid: 'u3', tags: [], name: 'Sam' },
                spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode: 'off' } } },
            },
        });
        expect(links).toEqual([]);
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

describe('BotClient in a meeting room', () => {
    const areas = [{ id: 'a1', x: 0, y: 0, width: 300, height: 300, roomKey: 'Board' }];
    type Internals = ReturnType<typeof setup>['internals'] & {
        meeting: { owns(space: string): boolean } | null;
        emitJoinSpace: (...args: unknown[]) => Promise<string>;
        emitLeaveSpace: (...args: unknown[]) => Promise<void>;
        joinMeetingSpace(space: string): Promise<boolean>;
        leaveMeetingSpace(space: string): Promise<void>;
        mayChat(space: string, sender: number, message: object): Promise<boolean>;
        behavior: unknown;
    };

    it('keeps no meeting-room code for a text-only bot, even when the map has meeting rooms', () => {
        const { bot, internals } = setup(false);
        bot.setMeetingAreas(areas, 'http://play.example.test/room');
        internals.startVoice();
        expect((internals as Internals).meeting).toBeNull();
    });

    it('joins a meeting room\'s space as itself, shows as in a meeting, and leaves it again', async () => {
        const { bot, internals, send } = setup(true);
        bot.setMeetingAreas(areas, 'http://play.example.test/room');
        internals.startVoice();
        const inner = internals as Internals;
        const emitJoinSpace = vi.fn().mockResolvedValue('room_9');
        inner.emitJoinSpace = emitJoinSpace;
        inner.emitLeaveSpace = vi.fn().mockResolvedValue(undefined);

        expect(await inner.joinMeetingSpace('area__board')).toBe(true);
        // The same media settings a player's browser joins a meeting with
        expect(emitJoinSpace).toHaveBeenCalledWith('area__board', expect.anything(), ['cameraState', 'microphoneState', 'screenShareState']);
        expect(internals.spaces.get('area__board')).toBe('room_9');
        const statuses = () => send.mock.calls.map(([m]) => m.message).filter((m) => m.$case === 'setPlayerDetailsMessage').map((m) => m.setPlayerDetailsMessage.availabilityStatus);
        expect(statuses()).toEqual([11]);

        await inner.leaveMeetingSpace('area__board');
        expect(internals.spaces.has('area__board')).toBe(false);
        expect(statuses()).toEqual([11, 1]);
    });

    it('does not join, and says so, when the game refuses', async () => {
        const { bot, internals } = setup(true);
        bot.setMeetingAreas(areas, 'http://play.example.test/room');
        internals.startVoice();
        const inner = internals as Internals;
        inner.emitJoinSpace = vi.fn().mockRejectedValue(new Error('this area is limited to other roles'));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await inner.joinMeetingSpace('area__board')).toBe(false);
        expect(internals.spaces.has('area__board')).toBe(false);
    });

    it('keeps the meeting room away from the bot\'s behaviour and chat: it only takes part in the audio', async () => {
        const { internals } = setup(true);
        const inner = internals as Internals;
        const behavior = { onSpaceUserJoined: vi.fn(), onSpaceUserLeft: vi.fn(), onSpaceLeft: vi.fn() };
        inner.behavior = behavior;
        inner.meeting = { owns: (space: string) => space === 'area__board' };
        const person = { spaceUserId: 'room_3', uuid: 'u3', tags: [], name: 'Sam' };
        await internals.handleSubMessage({ $case: 'initSpaceUsersMessage', initSpaceUsersMessage: { spaceName: 'area__board', users: [person] } });
        await internals.handleSubMessage({ $case: 'addSpaceUserMessage', addSpaceUserMessage: { spaceName: 'area__board', user: person } });
        await internals.handleSubMessage({ $case: 'removeSpaceUserMessage', removeSpaceUserMessage: { spaceName: 'area__board', spaceUserId: 'room_3' } });
        expect(behavior.onSpaceUserJoined).not.toHaveBeenCalled();
        expect(behavior.onSpaceUserLeft).not.toHaveBeenCalled();
        expect(await inner.mayChat('area__board', 3, {})).toBe(false);
    });
});
