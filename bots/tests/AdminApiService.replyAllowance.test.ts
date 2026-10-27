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
