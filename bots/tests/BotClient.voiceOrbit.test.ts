/**
 * A voice bot asks Orbit who hears and speaks for it (#1746) when the bot server is set up with Orbit, and only then:
 * the settings are wired in BotClient.startVoice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotClient } from '../client/BotClient';
import type { BotConfiguration } from '../server/AdminApiService';

const orbit = vi.hoisted(() => ({
    configured: true,
    getVoiceActive: vi.fn(async () => ({ speaks: false, reason: 'key-down', profile: null })),
}));
const links: { send: ReturnType<typeof vi.fn> }[] = [];

vi.mock('../server/AdminApiService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../server/AdminApiService')>()),
    adminApiService: { isConfigured: () => orbit.configured, getVoiceActive: orbit.getVoiceActive },
}));
vi.mock('../voice/VoiceLink', () => ({
    WorkerLink: class {
        start = vi.fn();
        isUp = () => true;
        send = vi.fn(() => true);
        close = vi.fn();
        constructor() {
            links.push(this as never);
        }
    },
}));

function setup() {
    const bot = new BotClient({
        botId: 'abc',
        name: 'Echo',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    bot.setFullConfig({ botId: 'abc', voiceEnabled: true } as unknown as BotConfiguration);
    Object.assign(bot as unknown as { send: unknown }, { send: vi.fn() });
    const internals = bot as unknown as { spaces: Map<string, string>; startVoice(): void; handleSubMessage(m: unknown): Promise<void> };
    internals.spaces.set('space-1', 'room_9');
    return internals;
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
    orbit.getVoiceActive.mockClear();
    orbit.configured = true;
    delete process.env.BOT_SERVICE_TOKEN;
});

describe('BotClient voice with Orbit', () => {
    it('asks Orbit for the bot before it opens a session, and opens none for a bot that does not speak', async () => {
        process.env.BOT_SERVICE_TOKEN = 'token';
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const internals = setup();
        internals.startVoice();
        await internals.handleSubMessage(startEvent);
        await new Promise((resolve) => setImmediate(resolve));
        expect(orbit.getVoiceActive).toHaveBeenCalledWith('abc', expect.any(Number));
        expect(links[0].send).not.toHaveBeenCalled();
    });

    it("uses the worker's own engine, as before, when the bot server has no Orbit to ask", async () => {
        orbit.configured = false;
        const internals = setup();
        internals.startVoice();
        await internals.handleSubMessage(startEvent);
        expect(orbit.getVoiceActive).not.toHaveBeenCalled();
        expect(links[0].send).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.open' }));
    });
});
