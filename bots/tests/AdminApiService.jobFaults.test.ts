import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService } from '../server/AdminApiService';

let server: http.Server;
let service: AdminApiService;
let seen: { method?: string; url?: string; authorization?: string; body?: unknown } = {};
let answer: { status: number; body: unknown };
const savedToken = process.env.BOT_SERVICE_TOKEN;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        let text = '';
        request.on('data', (chunk) => (text += chunk));
        request.on('end', () => {
            seen = { method: request.method, url: request.url, authorization: request.headers.authorization, body: text ? JSON.parse(text) : undefined };
            response.statusCode = answer.status;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(answer.body));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
});

beforeEach(() => {
    process.env.BOT_SERVICE_TOKEN = 'bot-token';
    seen = {};
});

afterEach(() => {
    if (savedToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
    else process.env.BOT_SERVICE_TOKEN = savedToken;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const row = { turn: 2, callId: 'call-1', kind: 'fault', reason: 'provider_key_ours', source: 'universe-ai', route: 'universe-ai:p1', providerStatus: 401, at: '2026-11-20T10:00:00.000Z' };

describe('the fault record Orbit keeps of a computer job’s model calls', () => {
    it('posts the rows to the job’s own faults route over the bot server’s credential, and is true when Orbit took them', async () => {
        answer = { status: 200, body: { ok: true, stored: 1 } };
        expect(await service.computerJobFaults('bot 1', 'job/1', [row])).toBe(true);
        expect(seen.method).toBe('POST');
        expect(seen.url).toBe('/api/bots/bot%201/computer-jobs/job%2F1/faults');
        expect(seen.authorization).toBe('Bearer bot-token');
        expect(seen.body).toEqual({ faults: [row] });
    });

    it('is true when this Orbit has no such record yet (404 or 405): nothing to keep trying for', async () => {
        answer = { status: 404, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(true);
        answer = { status: 405, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(true);
    });

    it('is false when Orbit fails or refuses the rows, so they are kept and sent again', async () => {
        answer = { status: 500, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 400, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 200, body: { ok: false } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
    });

    it('is false when Orbit cannot be reached', async () => {
        const gone = new AdminApiService('http://127.0.0.1:1', 'admin-token');
        expect(await gone.computerJobFaults('b', 'j', [row])).toBe(false);
    });
});
