/**
 * Free greetings with a cooldown (approved by Khalid 10 Nov 2026): a bot greets a person on its own at most once per cooldown (Orbit
 * remembers the last greeting per bot and person; the cooldown is Orbit's setting), the greeting costs the person nothing and is
 * never a voice reply. Only time and who the person is count.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { BotClient } from '../client/BotClient';
import { GreetingCooldown, greetingPersonOf, greetingReplyId, isGreetingReply, type GreetingOrbit } from '../client/GreetingCooldown';
import { AdminApiService } from '../server/AdminApiService';
import type { BotAccessGate } from '../server/BotAccessGate';

const SPACE = 'room-space';
const SARA = { userId: 'wa-sara', isGuest: false };

/** An Orbit that remembers greetings like the real one: a yes is remembered at once, and is said again only after `cooldownMs`. */
function fakeOrbit(cooldownMs = 12 * 60 * 60 * 1000) {
    let now = 0;
    const last = new Map<string, number>();
    const orbit = {
        claimGreeting: vi.fn(async (botId: string, talker: { userId: string }) => {
            const key = `${botId}|${talker.userId}`;
            const at = last.get(key);
            if (at !== undefined && now - at < cooldownMs) return { greet: false as const };
            last.set(key, now);
            return { greet: true as const, greetedAt: new Date(now).toISOString() };
        }),
        releaseGreeting: vi.fn(async (botId: string, input: { userId: string; greetedAt: string }) => {
            const key = `${botId}|${input.userId}`;
            if (last.get(key) === Date.parse(input.greetedAt)) last.delete(key);
        }),
    };
    return { orbit, later: (ms: number) => (now += ms) };
}

describe('a greeting reply id', () => {
    it('is told apart from any other reply, and still names the person it is for', () => {
        const id = greetingReplyId('bot-1', 7);
        expect(isGreetingReply(id)).toBe(true);
        expect(greetingPersonOf(id)).toBe(7);
        expect(isGreetingReply(`bot-bot-1-player-7-${crypto.randomUUID()}`)).toBe(false);
        expect(isGreetingReply(`bot-bot-1-say-${crypto.randomUUID()}`)).toBe(false);
    });
});

describe('the cooldown', () => {
    it('greets once, then not again until Orbit says the cooldown has passed', async () => {
        const { orbit, later } = fakeOrbit(60_000);
        const cooldown = new GreetingCooldown('bot-1', orbit);
        expect(await cooldown.claim(7, SARA)).toBe(true);
        cooldown.made(7);
        cooldown.ended(7);
        // Out of the bubble and back in, a reconnect: no new greeting
        later(10_000);
        expect(await cooldown.claim(7, SARA)).toBe(false);
        later(50_000);
        expect(await cooldown.claim(7, SARA)).toBe(true);
        expect(orbit.releaseGreeting).not.toHaveBeenCalled();
    });

    it('hands back a greeting that never reached the chat, so the person is greeted next time', async () => {
        const { orbit } = fakeOrbit();
        const cooldown = new GreetingCooldown('bot-1', orbit);
        expect(await cooldown.claim(7, SARA)).toBe(true);
        cooldown.ended(7);
        await Promise.resolve();
        expect(orbit.releaseGreeting).toHaveBeenCalledWith('bot-1', { ...SARA, greetedAt: new Date(0).toISOString() });
        expect(await cooldown.claim(7, SARA)).toBe(true);
    });

    it('makes no greeting when Orbit cannot answer', async () => {
        const orbit: GreetingOrbit = { claimGreeting: vi.fn().mockRejectedValue(new Error('down')), releaseGreeting: vi.fn() };
        expect(await new GreetingCooldown('bot-1', orbit).claim(7, SARA)).toBe(false);
    });

    it('greets as before someone nobody can name yet, or when there is no Orbit to remember it', async () => {
        const { orbit } = fakeOrbit();
        expect(await new GreetingCooldown('bot-1', orbit).claim(7, null)).toBe(true);
        expect(orbit.claimGreeting).not.toHaveBeenCalled();
        expect(await new GreetingCooldown('bot-1', null).claim(7, SARA)).toBe(true);
    });
});

function botWith(options: { voice?: boolean; access?: 'allowed' | 'refused' | 'none' } = {}) {
    const bot = new BotClient({
        botId: 'bot-1',
        name: 'Nora',
        roomUrl: 'http://play.example.test/_/global/maps.example.test/lobby.tmj',
        pusherUrl: 'http://play.example.test',
        position: { x: 100, y: 100 },
        viewport: { top: 0, bottom: 600, left: 0, right: 800 },
        characterTextureIds: [],
    });
    const behavior = {
        getPersonForAccess: vi.fn().mockReturnValue({ signedIn: true, identifier: 'wa-sara' }),
        getTalker: vi.fn().mockReturnValue(SARA),
    };
    (bot as unknown as { behavior: unknown }).behavior = behavior;
    vi.spyOn(bot, 'isVoiceBot').mockReturnValue(options.voice ?? false);
    const access = options.access ?? 'allowed';
    if (access !== 'none') {
        const verdict = access === 'allowed' ? { allowed: true, kind: 'allowed' } : { allowed: false, kind: 'refused', code: 'not_allowed', line: 'Sorry.' };
        bot.setAccessGate({ check: vi.fn().mockResolvedValue(verdict) } as unknown as BotAccessGate);
    }
    vi.spyOn(bot, 'sendChatMessage').mockImplementation(() => undefined);
    const { orbit, later } = fakeOrbit();
    bot.setGreetingOrbit(orbit);
    const speech = { final: vi.fn(), begin: vi.fn() };
    const inner = bot as unknown as { spaces: Map<string, string>; speech: unknown; send: (message: unknown) => void };
    inner.spaces.set(SPACE, 'room_1');
    inner.speech = speech;
    inner.send = vi.fn();
    return { bot, orbit, later, speech };
}

describe('a bot deciding whether to greet someone who walks up', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('greets them once, and not again when they step out and back in', async () => {
        const { bot, orbit } = botWith();
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
        bot.sendStreamMessage(SPACE, greetingReplyId('bot-1', 7), '', true, 'Hello Sara.');
        bot.greetingEnded(7);
        expect(await bot.mayGreet(SPACE, 7)).toBe(false);
        expect(orbit.claimGreeting).toHaveBeenCalledWith('bot-1', SARA);
        expect(orbit.releaseGreeting).not.toHaveBeenCalled();
    });

    it('greets them again next time when the greeting never reached the chat', async () => {
        const { bot, orbit } = botWith();
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
        bot.greetingEnded(7);
        await vi.waitFor(() => expect(orbit.releaseGreeting).toHaveBeenCalledTimes(1));
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
    });

    it('greets a voice bot\'s visitor too, whatever replies they have left: a greeting is free for them', async () => {
        const { bot } = botWith({ voice: true });
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
    });

    it('applies the cooldown when nobody is asked about chat access as well', async () => {
        const { bot } = botWith({ access: 'none' });
        expect(await bot.mayGreet(SPACE, 7)).toBe(true);
        expect(await bot.mayGreet(SPACE, 7)).toBe(false);
    });

    it('never remembers a greeting for a person the owner refused', async () => {
        const { bot, orbit } = botWith({ access: 'refused' });
        expect(await bot.mayGreet(SPACE, 7)).toBe(false);
        expect(orbit.claimGreeting).not.toHaveBeenCalled();
    });
});

describe('a greeting is never a voice reply', () => {
    it('stays in the chat and is never handed to the voice, while an ordinary reply still is', () => {
        const { bot, speech } = botWith({ voice: true });
        const greeting = greetingReplyId('bot-1', 7);
        bot.sendStreamMessage(SPACE, greeting, 'Hello ', false);
        bot.sendStreamMessage(SPACE, greeting, '', true, 'Hello Sara.');
        expect(speech.begin).not.toHaveBeenCalled();
        expect(speech.final).not.toHaveBeenCalled();
        const reply = `bot-bot-1-player-7-${crypto.randomUUID()}`;
        bot.sendStreamMessage(SPACE, reply, '', true, 'Here you go.');
        expect(speech.final).toHaveBeenCalledWith(SPACE, reply, 'Here you go.');
    });
});

describe('asking Orbit about a greeting', () => {
    let server: http.Server;
    let service: AdminApiService;
    let answer: { status: number; body: string };
    let asked: { url?: string; body?: Record<string, unknown> };

    beforeAll(async () => {
        process.env.BOT_SERVICE_TOKEN = 'service-token';
        server = http.createServer((request, response) => {
            let body = '';
            request.on('data', (chunk) => (body += chunk));
            request.on('end', () => {
                asked = { url: request.url, body: JSON.parse(body) };
                response.statusCode = answer.status;
                response.setHeader('content-type', 'application/json');
                response.end(answer.body);
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
    });
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('reads a yes with its time, and a no', async () => {
        answer = { status: 200, body: '{"greet":true,"greetedAt":"2026-11-10T12:00:00.000Z"}' };
        expect(await service.claimGreeting('bot-1', SARA)).toEqual({ greet: true, greetedAt: '2026-11-10T12:00:00.000Z' });
        expect(asked).toEqual({ url: '/api/bots/bot-1/greeting', body: SARA });
        answer = { status: 200, body: '{"greet":false,"nextAt":"2026-11-11T00:00:00.000Z"}' };
        expect(await service.claimGreeting('bot-1', SARA)).toEqual({ greet: false });
    });

    it('greets as before with an Orbit from before (404), and throws when Orbit fails, so no greeting is made', async () => {
        answer = { status: 404, body: '{}' };
        expect(await service.claimGreeting('bot-1', SARA)).toEqual({ greet: true });
        answer = { status: 500, body: '{}' };
        await expect(service.claimGreeting('bot-1', SARA)).rejects.toBeTruthy();
    });

    it('hands a greeting back with the time it was claimed at, and never throws', async () => {
        answer = { status: 200, body: '{"released":true}' };
        await service.releaseGreeting('bot-1', { ...SARA, greetedAt: '2026-11-10T12:00:00.000Z' });
        expect(asked).toEqual({ url: '/api/bots/bot-1/greeting/release', body: { ...SARA, greetedAt: '2026-11-10T12:00:00.000Z' } });
        answer = { status: 500, body: '{}' };
        await expect(service.releaseGreeting('bot-1', { ...SARA, greetedAt: '2026-11-10T12:00:00.000Z' })).resolves.toBeUndefined();
    });
});
