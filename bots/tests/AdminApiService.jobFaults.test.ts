import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService } from '../server/AdminApiService';
import { createRefusalNotes, type CallRow } from '../server/ComputerRefusals';

let server: http.Server;
let service: AdminApiService;
let seen: { method?: string; url?: string; authorization?: string; body?: unknown } = {};
let answer: { status: number; body: unknown };
/** When set, answers from what was sent (an Orbit that reads each row on its own). */
let respond: ((body: { faults?: Array<{ callId: string }> }) => { status: number; body: unknown }) | undefined;
const savedToken = process.env.BOT_SERVICE_TOKEN;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        let text = '';
        request.on('data', (chunk) => (text += chunk));
        request.on('end', () => {
            seen = { method: request.method, url: request.url, authorization: request.headers.authorization, body: text ? JSON.parse(text) : undefined };
            const said = respond ? respond(seen.body as { faults?: Array<{ callId: string }> }) : answer;
            response.statusCode = said.status;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify(said.body));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    service = new AdminApiService(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'admin-token');
});

beforeEach(() => {
    process.env.BOT_SERVICE_TOKEN = 'bot-token';
    seen = {};
    respond = undefined;
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

        it('answers the named call ids, only those that were sent, each once; a row named twice is one row, and a call that was not sent is a refusal it does not account for', async () => {
            answer = { status: 200, body: { ok: true, stored: 1, rejected: [{ callId: 'call-2', why: 'bad reason' }, { callId: 'call-2', why: 'again' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-2'] });
            answer = { status: 200, body: { ok: true, stored: 1, rejected: [{ callId: 'call-2', why: 'bad reason' }, { callId: 'call-2', why: 'again' }, { callId: 'not-sent', why: 'x' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-2'], unnamed: 1 });
        });

        it('is true when the list is empty or absent, and false when Orbit did not say ok', async () => {
            answer = { status: 200, body: { ok: true, rejected: [] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            answer = { status: 200, body: { ok: true } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            answer = { status: 200, body: { rejected: [{ callId: 'call-2' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(false);
        });

        it('never takes rows as delivered that Orbit says it refused without saying which: it answers how many are unaccounted for (a count, entries with no usable call id, an id that was not sent)', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            for (const [rejected, count] of [
                [2, 2],
                [[{ why: 'x' }, {}], 2],
                [[null, 7, { callId: 5 }], 3],
                [[{ callId: '' }], 1],
                [[{ callId: 'elsewhere', why: 'not ours' }], 1],
            ] as Array<[unknown, number]>) {
                answer = { status: 200, body: { ok: true, rejected } };
                expect(await service.computerJobFaults('b', 'j', rows), JSON.stringify(rejected)).toEqual({ rejected: [], unnamed: count });
            }
            // some named, some not: the named are refused alone, the rest is counted
            answer = { status: 200, body: { ok: true, rejected: [{ callId: 'call-3' }, { why: 'x' }] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-3'], unnamed: 1 });
            // the operators are told through the report hook, not by a line in a log nobody reads
            expect(warn).not.toHaveBeenCalled();
            warn.mockRestore();
            // a count of zero, or nothing, says nothing
            answer = { status: 200, body: { ok: true, rejected: 0 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
            answer = { status: 200, body: { ok: true, rejected: [] } };
            expect(await service.computerJobFaults('b', 'j', rows)).toBe(true);
        });
    });

    describe('rejectedCount and a 400 that names the rows', () => {
        const rows = [row, { ...row, callId: 'call-2' }];

        it('counts rows it names and rows it only counts (rejectedCount): the named are refused alone, the rest is counted as unnamed, never taken as delivered', async () => {
            answer = { status: 200, body: { ok: true, rejected: [{ callId: 'call-2', why: 'x' }], rejectedCount: 3 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-2'], unnamed: 2 });
            answer = { status: 200, body: { ok: true, rejectedCount: 1 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: [], unnamed: 1 });
            // a count that is only the rows it names is nothing more
            answer = { status: 200, body: { ok: true, rejected: [{ callId: 'call-2' }], rejectedCount: 1 } };
            expect(await service.computerJobFaults('b', 'j', rows)).toEqual({ rejected: ['call-2'] });
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

describe('through the notes: an Orbit that counts refused rows without naming them (Sentry on #2114)', () => {
    const rowOf = (callId: string) => ({ ...row, callId }) as unknown as CallRow;

    it('does not drop the batch: the refused row is found and set aside, the operators are told, and the others are taken', async () => {
        const taken = new Set<string>();
        const told: string[] = [];
        // Orbit reads each row on its own, keeps the readable ones and only COUNTS the refused (an older Orbit, or a body without call ids)
        respond = (body) => {
            const ids = (body.faults ?? []).map((fault) => fault.callId);
            for (const id of ids.filter((one) => one !== 'bad')) taken.add(id);
            return { status: 200, body: ids.includes('bad') ? { ok: true, rejected: 1 } : { ok: true } };
        };
        const notes = createRefusalNotes(() => 1000, {
            retryMs: [0],
            laterMs: [],
            sink: (botId, jobId, rows) => service.computerJobFaults(botId, jobId, rows as unknown as Array<Record<string, unknown>>),
            report: (what, info) => told.push(`${what} ${info.jobId} ${info.callId}`),
        });
        for (const id of ['a', 'bad', 'b']) notes.record('bot', 'job', rowOf(id));
        expect(await notes.flush('job')).toBe(true);
        expect([...taken].sort()).toEqual(['a', 'b']);
        // told through the report hook (Sentry), which is what was missing: the row that Orbit refused is set aside, never taken as delivered
        expect(told).toContain('unnamed_rejection job ');
        expect(told).toContain('dead_letter job bad');
        expect(told.filter((one) => one.startsWith('dead_letter'))).toHaveLength(1);
    });

    it('a count of two with only one row named (Opus): the named row is set aside, the rest goes through the suspect path and ends taken or set aside, never dropped, and the operators are told exactly once for the job', async () => {
        const taken = new Set<string>();
        const told: string[] = [];
        // Orbit says 2 rows were refused and names only 'bad1'; the second it counts is not a row of this batch that it can name
        respond = (body) => {
            const ids = (body.faults ?? []).map((fault) => fault.callId);
            for (const id of ids.filter((one) => one !== 'bad1')) taken.add(id);
            return { status: 200, body: ids.includes('bad1') ? { ok: true, rejected: [{ callId: 'bad1', why: 'x' }], rejectedCount: 2 } : { ok: true } };
        };
        const notes = createRefusalNotes(() => 1000, {
            retryMs: [0],
            laterMs: [],
            sink: (botId, jobId, rows) => service.computerJobFaults(botId, jobId, rows as unknown as Array<Record<string, unknown>>),
            report: (what, info) => told.push(`${what} ${info.jobId} ${info.callId}`),
        });
        for (const id of ['a', 'bad1', 'b', 'c']) notes.record('bot', 'job', rowOf(id));
        expect(await notes.flush('job')).toBe(true);
        // every row not named is sent again and taken; none is dropped
        expect([...taken].sort()).toEqual(['a', 'b', 'c']);
        expect(told.filter((one) => one.startsWith('dead_letter'))).toEqual(['dead_letter job bad1']);
        expect(told.filter((one) => one.startsWith('unnamed_rejection'))).toEqual(['unnamed_rejection job ']);
    });
});
