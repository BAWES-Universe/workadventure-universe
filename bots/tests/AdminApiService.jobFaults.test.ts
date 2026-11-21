import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

    describe('an Orbit that reads each row on its own and names the rows it could not read', () => {
        const rows = [row, { ...row, callId: 'call-2' }, { ...row, callId: 'call-3' }];

        it('answers the named call ids, only those that were sent, once, and takes the rest as delivered', async () => {
            answer = { status: 200, body: { ok: true, stored: 1, rejected: [{ callId: 'call-2', why: 'bad reason' }, { callId: 'call-2', why: 'again' }, { callId: 'not-sent', why: 'x' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-2'] });
        });

        it('is true when the list is empty or absent, and false when Orbit did not say ok', async () => {
            answer = { status: 200, body: { ok: true, rejected: [] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            answer = { status: 200, body: { ok: true } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            answer = { status: 200, body: { rejected: [{ callId: 'call-2' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(false);
        });

        it('dead-letters nothing extra and says so, with the count only, when Orbit gives a count or entries with no usable call id (an older Orbit)', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            for (const rejected of [2, [{ why: 'x' }, {}], [null, 7, { callId: 5 }], [{ callId: '' }]]) {
                warn.mockClear();
                answer = { status: 200, body: { ok: true, rejected } };
                expect(await service.computerJobFaults('b', 'j', rows), JSON.stringify(rejected)).toBe(true);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(String(warn.mock.calls[0][0])).toMatch(/could not read \d+ fault row/);
                expect(String(warn.mock.calls[0][0])).not.toContain('call-');
            }
            // some named, some not: the named are refused alone, the rest said
            warn.mockClear();
            answer = { status: 200, body: { ok: true, rejected: [{ callId: 'call-3' }, { why: 'x' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-3'] });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toMatch(/could not read 1 fault row/);
            // a count of zero, or nothing, says nothing
            warn.mockClear();
            answer = { status: 200, body: { ok: true, rejected: 0 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    describe('rejectedCount and a 400 that names the rows', () => {
        const rows = [row, { ...row, callId: 'call-2' }];

        it('counts rows it names and rows it only counts (rejectedCount): the named are refused alone, the rest is said once with the count', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            answer = { status: 200, body: { ok: true, rejected: [{ callId: 'call-2', why: 'x' }], rejectedCount: 3 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-2'] });
            expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/could not read 2 fault row/);
            warn.mockClear();
            answer = { status: 200, body: { ok: true, rejectedCount: 1 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/could not read 1 fault row/);
            warn.mockClear();
            answer = { status: 200, body: { ok: true, rejected: [{ callId: 'call-2' }], rejectedCount: 1 } };
            await service.computerJobFaults('b', 'j', rows);
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
        });

        it('takes a 400 that names every row of the batch as those rows refused alone (nothing to split), and any other 400 as before: split the batch', async () => {
            answer = { status: 400, body: { error: 'Invalid request', rejected: [{ callId: 'call-1', why: 'a' }, { callId: 'call-2', why: 'b' }], rejectedCount: 2 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-1', 'call-2'] });
            answer = { status: 400, body: { error: 'Invalid request', rejected: [{ callId: 'call-1' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe('rejected');
            answer = { status: 400, body: { error: 'Invalid request', rejected: [{ callId: 'elsewhere' }, { callId: 'else' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe('rejected');
            answer = { status: 400, body: { error: 'Invalid request' } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe('rejected');
            // a bare 400 (a gateway) says nothing of the rows, with a list or without
            answer = { status: 400, body: { rejected: [{ callId: 'call-1' }, { callId: 'call-2' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(false);
        });
    });

    it('is "missing", not true, when Orbit answers that it has no such job: there is nothing to keep the rows for, but Orbit read none of them', async () => {
        answer = { status: 404, body: { error: 'Job not found' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe('missing');
    });

    it('is false when the route is missing (an older Orbit answers 404 or 405 without its own words): the rows are kept for after the upgrade', async () => {
        answer = { status: 404, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 404, body: { error: 'Not found' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 405, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 405, body: { error: 'Job not found' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
    });

    it('is false when Orbit fails or refuses the rows, so they are kept and sent again', async () => {
        answer = { status: 500, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 400, body: {} };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 200, body: { ok: false } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
    });

    it('takes only Orbit’s own positive answer (200 with ok: true) as taking the rows: a 200 with no `ok`, an empty body, a page or a non-true `ok` leaves them kept', async () => {
        for (const body of [{}, { stored: 1 }, 'OK', '<html>ok</html>', [], null, { ok: 'true' }, { ok: 1 }, { ok: null }]) {
            answer = { status: 200, body };
            expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        }
        // any other 2xx is no answer of Orbit's either
        answer = { status: 202, body: { ok: true } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 200, body: { ok: true } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(true);
    });

    it('says \'rejected\' only for Orbit’s own 400 about the rows: a bare 400 (a gateway) is still false and the rows are sent again', async () => {
        answer = { status: 400, body: { error: 'Invalid request' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe('rejected');
        answer = { status: 400, body: { error: 'Bad gateway thing' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 401, body: { error: 'Invalid request' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
        answer = { status: 422, body: { error: 'Invalid request' } };
        expect(await service.computerJobFaults('b', 'j', [row])).toBe(false);
    });

    it('is false when Orbit cannot be reached', async () => {
        const gone = new AdminApiService('http://127.0.0.1:1', 'admin-token');
        expect(await gone.computerJobFaults('b', 'j', [row])).toBe(false);
    });
});
