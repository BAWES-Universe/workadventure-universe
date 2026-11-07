/**
 * Asking Orbit whether a person may have one more reply (#1159). Anything but a clear, well-formed "no" lets the reply
 * through: a limit check that fails must never silence a bot.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService } from '../server/AdminApiService';

let server: http.Server;
let service: AdminApiService;
let answer: { status: number; body: string };
let asked: { url?: string; auth?: string; body?: Record<string, unknown> };

const ASK = { userId: 'wa-sara', isGuest: false, source: 'universe-ai' as const };
const NO = { allowed: false, limit: 'universe-ai', resetsAt: '2026-10-27T20:20:00.000Z', who: 'member' };

beforeAll(async () => {
    process.env.BOT_SERVICE_TOKEN = 'service-token';
    server = http.createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
            asked = { url: request.url, auth: request.headers.authorization, body: JSON.parse(body) };
            response.statusCode = answer.status;
            response.setHeader('content-type', 'application/json');
            response.end(answer.body);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
});

beforeEach(() => {
    asked = {};
    answer = { status: 200, body: '{"allowed":true}' };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('asking Orbit for a reply allowance', () => {
    it('asks with the service token, who is talking and what the reply runs on', async () => {
        expect(await service.checkReplyAllowance('bot-1', ASK)).toEqual({ allowed: true });
        expect(asked).toEqual({ url: '/api/bots/bot-1/reply-allowance', auth: 'Bearer service-token', body: ASK });
    });

    it("passes on Orbit's no with the card's facts", async () => {
        answer = { status: 200, body: JSON.stringify(NO) };
        expect(await service.checkReplyAllowance('bot-1', ASK)).toEqual(NO);
    });

    it('lets the reply through when Orbit fails', async () => {
        answer = { status: 500, body: '{"error":"boom"}' };
        expect(await service.checkReplyAllowance('bot-1', ASK)).toEqual({ allowed: true });
    });

    it('lets the reply through on a no it cannot read', async () => {
        for (const bad of [{ ...NO, limit: 'other' }, { ...NO, who: 'stranger' }, { ...NO, resetsAt: 'soon' }]) {
            answer = { status: 200, body: JSON.stringify(bad) };
            expect(await service.checkReplyAllowance('bot-1', ASK)).toEqual({ allowed: true });
        }
    });
});

describe('asking Orbit whether a reply may be spoken (#1669)', () => {
    const SPEAK = { userId: 'wa-sara', isGuest: false, turnId: 'bot-1-player-4-aaaa' };

    it('asks with the service token, who the reply is for and its turn', async () => {
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toEqual({ allowed: true });
        expect(asked).toEqual({ url: '/api/bots/bot-1/voice-allowance', auth: 'Bearer service-token', body: SPEAK });
    });

    it("passes on Orbit's no with the end of the window", async () => {
        answer = { status: 200, body: JSON.stringify({ allowed: false, resetsAt: '2026-11-02T13:00:00.000Z' }) };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toEqual({ allowed: false, resetsAt: '2026-11-02T13:00:00.000Z' });
    });

    it('passes on what is left with a yes, and only when it is a count', async () => {
        answer = { status: 200, body: JSON.stringify({ allowed: true, left: 17, resetsAt: '2026-11-02T13:00:00.000Z' }) };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toEqual({ allowed: true, left: 17, resetsAt: '2026-11-02T13:00:00.000Z' });
        for (const bad of [{ left: -1 }, { left: 2.5 }, { left: '3' }, { left: null }]) {
            answer = { status: 200, body: JSON.stringify({ allowed: true, resetsAt: '2026-11-02T13:00:00.000Z', ...bad }) };
            expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toEqual({ allowed: true });
        }
        // A time that is not one is dropped, the count stays
        answer = { status: 200, body: JSON.stringify({ allowed: true, left: 4, resetsAt: 'soon' }) };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toEqual({ allowed: true, left: 4, resetsAt: undefined });
    });

    it('is null, so the reply stays in text, when Orbit cannot be asked or does not know the question', async () => {
        answer = { status: 404, body: '{"error":"Not found"}' };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toBeNull();
        answer = { status: 500, body: '{}' };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toBeNull();
        answer = { status: 200, body: 'nonsense' };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toBeNull();
        answer = { status: 200, body: JSON.stringify({ allowed: false }) };
        expect(await service.checkVoiceAllowance('bot-1', SPEAK)).toBeNull();
    });

    it('asks for a greeting when told it is one', async () => {
        await service.checkReplyAllowance('bot-1', { ...ASK, greeting: true });
        expect(asked.body).toEqual({ ...ASK, greeting: true });
    });
});

describe('asking Orbit what is left of a person\'s spoken replies (#1669)', () => {
    const WHO = { userId: 'wa-sara', isGuest: false };

    it('asks with the service token and who it is for, and reads the count and the end of the window', async () => {
        answer = { status: 200, body: JSON.stringify({ left: 18, resetsAt: '2026-11-02T13:00:00.000Z' }) };
        expect(await service.voiceRepliesLeft('bot-1', WHO)).toEqual({ left: 18, resetsAt: '2026-11-02T13:00:00.000Z' });
        expect(asked).toEqual({ url: '/api/bots/bot-1/voice-allowance/left', auth: 'Bearer service-token', body: WHO });
        answer = { status: 200, body: JSON.stringify({ left: 25, resetsAt: null }) };
        expect(await service.voiceRepliesLeft('bot-1', WHO)).toEqual({ left: 25, resetsAt: null });
        answer = { status: 200, body: JSON.stringify({ left: null, resetsAt: null }) };
        expect(await service.voiceRepliesLeft('bot-1', WHO)).toEqual({ left: null, resetsAt: null });
    });

    it('reads a count it cannot trust as none, and is null, never throwing, when Orbit cannot be asked or is from before this', async () => {
        answer = { status: 200, body: JSON.stringify({ left: -3, resetsAt: 'soon' }) };
        expect(await service.voiceRepliesLeft('bot-1', WHO)).toEqual({ left: null, resetsAt: null });
        for (const bad of [{ status: 404, body: '{"error":"Not found"}' }, { status: 500, body: '{}' }, { status: 200, body: 'nonsense' }]) {
            answer = bad;
            expect(await service.voiceRepliesLeft('bot-1', WHO)).toBeNull();
        }
    });
});

describe('giving back a spoken reply that was never heard (#1669)', () => {
    it('asks with the service token and the turn, and says whether Orbit gave it back', async () => {
        answer = { status: 200, body: '{"released":true}' };
        expect(await service.releaseVoiceReply('bot-1', { turnId: 'bot-1-player-4-aaaa' })).toBe(true);
        expect(asked).toEqual({ url: '/api/bots/bot-1/voice-allowance/release', auth: 'Bearer service-token', body: { turnId: 'bot-1-player-4-aaaa' } });
        answer = { status: 200, body: '{"released":false}' };
        expect(await service.releaseVoiceReply('bot-1', { turnId: 'bot-1-player-4-aaaa' })).toBe(false);
    });

    it('is null, and never throws, when Orbit cannot be asked or is from before this existed', async () => {
        for (const bad of [{ status: 404, body: '{"error":"Not found"}' }, { status: 500, body: '{}' }, { status: 200, body: 'nonsense' }, { status: 200, body: '{}' }]) {
            answer = bad;
            expect(await service.releaseVoiceReply('bot-1', { turnId: 't' })).toBeNull();
        }
    });
});

describe('reporting what a bot listened to in a day (#1859)', () => {
    const OK = { spent: false, usedSeconds: 30, limitSeconds: 3600, resetsAt: '2026-11-07T00:00:00.000Z' };

    it('sends the seconds with the service token and reads the answer', async () => {
        answer = { status: 200, body: JSON.stringify(OK) };
        expect(await service.reportVoiceListening('bot-1', { seconds: 30 })).toEqual(OK);
        expect(asked).toEqual({ url: '/api/bots/bot-1/voice-listening', auth: 'Bearer service-token', body: { seconds: 30 } });
    });

    it('is null, and never throws, when Orbit cannot be asked, is from before this existed, or answers nonsense', async () => {
        for (const bad of [{ status: 404, body: '{"error":"Not found"}' }, { status: 500, body: '{}' }, { status: 200, body: 'nonsense' }, { status: 200, body: '{}' }, { status: 200, body: JSON.stringify({ ...OK, resetsAt: 'soon' }) }]) {
            answer = bad;
            expect(await service.reportVoiceListening('bot-1', { seconds: 5 })).toBeNull();
        }
    });
});
