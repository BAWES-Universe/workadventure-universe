/**
 * The bot server's calls to Orbit about a bot's voice (#1746): what the bot speaks with now, a provider's credentials
 * for one bot, the server's voice limits, and how a provider call went.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService } from '../server/AdminApiService';

let server: http.Server;
let service: AdminApiService;
let answer: { status: number; body: string };
let asked: { method?: string; url?: string; auth?: string; body?: Record<string, unknown> };

beforeAll(async () => {
    process.env.BOT_SERVICE_TOKEN = 'service-token';
    server = http.createServer((request, response) => {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
            asked = { method: request.method, url: request.url, auth: request.headers.authorization, body: body ? JSON.parse(body) : undefined };
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
    answer = { status: 200, body: '{}' };
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('reading what a bot speaks with', () => {
    it('asks for the bot by id with the service token', async () => {
        answer.body = JSON.stringify({ speaks: true, reason: null, profile: {} });
        expect(await service.getVoiceActive('bot 1', 1000)).toMatchObject({ speaks: true });
        expect(asked).toMatchObject({ method: 'GET', url: '/api/bots/bot%201/voice/active', auth: 'Bearer service-token' });
    });

    it('is null for a bot Orbit does not know, and throws when Orbit cannot answer', async () => {
        answer = { status: 404, body: '{}' };
        expect(await service.getVoiceActive('bot-1', 1000)).toBeNull();
        answer = { status: 500, body: '{}' };
        await expect(service.getVoiceActive('bot-1', 1000)).rejects.toThrow();
    });
});

describe('reading a provider for one bot', () => {
    it('names the bot, so a key a person lent is served only to the bot it was lent for', async () => {
        answer.body = JSON.stringify({ id: 'p1', adapter: 'elevenlabs', apiKeyEncrypted: 'a:b:c' });
        expect(await service.getVoiceCredentials('p1', 'bot-1', 1000)).toMatchObject({ adapter: 'elevenlabs' });
        expect(asked).toMatchObject({ method: 'GET', url: '/api/voice/providers/p1/credentials?botId=bot-1', auth: 'Bearer service-token' });
    });

    it('is null when the bot may not use it (404 or 400), and throws on a failure', async () => {
        answer = { status: 404, body: '{}' };
        expect(await service.getVoiceCredentials('p1', 'bot-1', 1000)).toBeNull();
        answer = { status: 400, body: '{}' };
        expect(await service.getVoiceCredentials('p1', 'bot-1', 1000)).toBeNull();
        answer = { status: 503, body: '{}' };
        await expect(service.getVoiceCredentials('p1', 'bot-1', 1000)).rejects.toThrow();
    });
});

describe('reading the server voice limits', () => {
    it('returns the limits of the answer', async () => {
        answer.body = JSON.stringify({ revision: 3, limits: { replyCharacters: 600, replySeconds: 60 } });
        expect(await service.getVoiceLimits(1000)).toEqual({ replyCharacters: 600, replySeconds: 60 });
        expect(asked).toMatchObject({ method: 'GET', url: '/api/voice/limits', auth: 'Bearer service-token' });
    });
});

describe('telling Orbit how a provider call went', () => {
    it('posts the outcome with the bot', async () => {
        await service.reportVoiceHealth('p1', { part: 'speech', ok: true, botId: 'bot-1' }, 1000);
        expect(asked).toEqual({ method: 'POST', url: '/api/voice/providers/p1/health', auth: 'Bearer service-token', body: { part: 'speech', ok: true, botId: 'bot-1' } });
        await service.reportVoiceHealth('p1', { part: 'recognition', ok: false, botId: 'bot-1', status: 401, rejected: true }, 1000);
        expect(asked.body).toEqual({ part: 'recognition', ok: false, botId: 'bot-1', status: 401, rejected: true });
    });

    it("ignores a server provider, which has no health to keep (404), and throws on a real failure", async () => {
        answer = { status: 404, body: '{}' };
        await expect(service.reportVoiceHealth('p1', { part: 'speech', ok: true, botId: 'bot-1' }, 1000)).resolves.toBeUndefined();
        answer = { status: 500, body: '{}' };
        await expect(service.reportVoiceHealth('p1', { part: 'speech', ok: true, botId: 'bot-1' }, 1000)).rejects.toThrow();
    });
});
