import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { AdminApiService } from '../server/AdminApiService';
import { ComputerReports, type ComputerSpeaker, type ComputerSpoke } from '../server/ComputerReports';

/**
 * End to end, from the bot server's real HTTP calls to the words in the chat and back, for what is said about a job the person's month or a spending
 * limit paused (computers plan piece 3, Opus C5.7 and C7.3). The stand-in for Orbit is modelled line by line on Orbit piece 3's own route
 * (app/api/computer/jobs/reports/route.ts and lib/computer-report.ts `tellingReportsSafely`, Orbit 2b2e7245) and the release desk's contract of 23 Nov:
 * - GET reads `accepts` as a comma list, keeps only the opt-in words, and NEVER sends a kind the reader did not name;
 * - each report: kind, jobId, botId, title, seq, key `computer-told:<job>:<kind>:<seq>`, matrixUserId, origin; on `paused` only, pausedWhy and, only when the
 *   screen was taken back, `heldScreen: true` (absent otherwise, never false);
 * - POST { jobId, kind, seq }: these kinds without a numeric seq are a 400; an unknown job is a 404; confirming marks that telling only, twice is safe.
 */

type TellingKind = 'paused' | 'carried_on' | 'can_carry_on' | 'back_in_line';
interface Telling {
    jobId: string;
    kind: TellingKind;
    seq: number;
    why?: 'allowance' | 'rule';
    heldScreen?: true;
    told: boolean;
}

const OPT_IN_KINDS = ['late', 'paused', 'carried_on', 'can_carry_on', 'back_in_line'];
const TELLING_KINDS: TellingKind[] = ['paused', 'carried_on', 'can_carry_on', 'back_in_line'];
const ALL_KINDS = ['done', 'failed', 'needs', 'unanswered', 'month', 'rule', 'late', ...TELLING_KINDS];
const JOBS: Record<string, { botId: string; title: string; person: string }> = {
    'job-1': { botId: 'brick-1', title: 'Visa form', person: '@sara:chat.test' },
    'job-2': { botId: 'brick-1', title: 'Hotel booking', person: '@sara:chat.test' },
};

let server: http.Server;
let service: AdminApiService;
let tellings: Telling[] = [];
let asked: string[] = [];
let confirms: Array<{ status: number; body: unknown }> = [];
const savedToken = process.env.BOT_SERVICE_TOKEN;

function orbitRoute(request: http.IncomingMessage, text: string): { status: number; body: unknown } {
    if (request.headers.authorization !== 'Bearer bot-token') return { status: 401, body: { error: 'Unauthorized' } };
    const url = new URL(request.url ?? '/', 'http://orbit.test');
    if (url.pathname !== '/api/computer/jobs/reports') return { status: 404, body: { error: 'Not found' } };
    if (request.method === 'GET') {
        asked.push(url.searchParams.get('accepts') ?? '');
        const accepts = (url.searchParams.get('accepts') ?? '').split(',').map((word) => word.trim()).filter((word) => OPT_IN_KINDS.includes(word));
        const kinds = TELLING_KINDS.filter((kind) => accepts.includes(kind));
        const reports = tellings
            .filter((one) => !one.told && kinds.includes(one.kind))
            .map((one) => {
                const job = JOBS[one.jobId];
                return {
                    key: `computer-told:${one.jobId}:${one.kind}:${one.seq}`,
                    jobId: one.jobId,
                    botId: job.botId,
                    matrixUserId: job.person,
                    origin: { kind: 'dm', ref: '!dm:chat.test' },
                    kind: one.kind,
                    title: job.title,
                    writes: true,
                    seconds: 300,
                    seq: one.seq,
                    waitingFor: null,
                    ready: null,
                    waitedFor: null,
                    why: null,
                    effects: [],
                    files: [],
                    handed: [],
                    givenBack: false,
                    ...(one.kind === 'paused' && one.why ? { pausedWhy: one.why } : {}),
                    ...(one.kind === 'paused' && one.heldScreen ? { heldScreen: true } : {}),
                };
            });
        return { status: 200, body: { reports } };
    }
    if (request.method === 'POST') {
        const body = (() => {
            try {
                return JSON.parse(text) as Record<string, unknown>;
            } catch {
                return null;
            }
        })();
        const valid =
            body !== null &&
            typeof body.jobId === 'string' &&
            ALL_KINDS.includes(body.kind as string) &&
            (body.seq === undefined || body.seq === null || (Number.isInteger(body.seq) && (body.seq as number) >= 0)) &&
            (body.outcome === undefined || body.outcome === 'delivered' || body.outcome === 'undeliverable');
        if (!valid) return { status: 400, body: { error: 'Invalid input data' } };
        if ((TELLING_KINDS as string[]).includes(body.kind as string) && typeof body.seq !== 'number') return { status: 400, body: { error: 'A confirmation about a paused job names its number (seq)' } };
        if (!JOBS[body.jobId as string]) return { status: 404, body: { error: 'Job not found' } };
        for (const one of tellings) if (one.jobId === body.jobId && one.kind === body.kind && one.seq === body.seq) one.told = true;
        return { status: 200, body: { ok: true } };
    }
    return { status: 405, body: {} };
}

beforeAll(async () => {
    server = http.createServer((request, response) => {
        let text = '';
        request.on('data', (chunk) => (text += chunk));
        request.on('end', () => {
            const said = orbitRoute(request, text);
            if (request.method === 'POST') confirms.push({ status: said.status, body: text ? JSON.parse(text) : undefined });
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
    tellings = [];
    asked = [];
    confirms = [];
});

afterEach(() => {
    if (savedToken === undefined) delete process.env.BOT_SERVICE_TOKEN;
    else process.env.BOT_SERVICE_TOKEN = savedToken;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** The person's chat: what was said, in order, and under which transaction key. */
function chat() {
    const said: Array<{ text: string; key: string; room?: string }> = [];
    let n = 0;
    const speaker: ComputerSpeaker = {
        say: async (_brick, _person, text, key, extra): Promise<ComputerSpoke> => {
            said.push({ text, key, ...(extra?.room ? { room: extra.room } : {}) });
            return { ok: true, eventId: `$event-${++n}` };
        },
    };
    const reports = new ComputerReports(
        {
            reports: () => service.computerReports(),
            keepTold: (report) => service.keepComputerReportTold(report),
            keepUndeliverable: (report, why) => service.keepComputerReportUndeliverable(report, why),
            keepFileDelivered: async () => true,
            file: async () => null,
        },
        speaker,
        { warn: () => undefined }
    );
    return { said, reports };
}

/** One kind end to end: Orbit offers it, Brick says it once in the job's own conversation, confirms it with { jobId, kind, seq }, and it is never said again. */
async function oneRound(telling: Omit<Telling, 'told'>): Promise<string> {
    tellings = [{ ...telling, told: false }];
    const { said, reports } = chat();
    expect(await reports.tick()).toBe(1);
    expect(said).toHaveLength(1);
    expect(said[0].key).toBe(`computer-told:${telling.jobId}:${telling.kind}:${telling.seq}`);
    expect(said[0].room).toBe('!dm:chat.test');
    expect(confirms).toEqual([{ status: 200, body: { jobId: telling.jobId, kind: telling.kind, seq: telling.seq } }]);
    expect(tellings[0].told).toBe(true);
    // Told: Orbit no longer offers it, so nothing is said twice
    expect(await reports.tick()).toBe(0);
    expect(said).toHaveLength(1);
    return said[0].text;
}

describe('what Brick says about a job Orbit paused by itself, end to end against the shape of Orbit piece 3’s reports route', () => {
    it('asks Orbit by the names Orbit uses, so Orbit offers every one of the three kinds (an unnamed kind is never sent)', async () => {
        tellings = [
            { jobId: 'job-1', kind: 'paused', seq: 1, why: 'allowance', told: false },
            { jobId: 'job-1', kind: 'carried_on', seq: 2, told: false },
            { jobId: 'job-2', kind: 'can_carry_on', seq: 1, told: false },
        ];
        const { said, reports } = chat();
        expect(await reports.tick()).toBe(3);
        expect(asked).toHaveLength(1);
        expect(asked[0].split(',')).toEqual(expect.arrayContaining(['late', 'paused', 'carried_on', 'can_carry_on', 'back_in_line']));
        expect(said.map((one) => one.key)).toEqual(['computer-told:job-1:paused:1', 'computer-told:job-1:carried_on:2', 'computer-told:job-2:can_carry_on:1']);
        expect(tellings.every((one) => one.told)).toBe(true);
    });

    it('paused for the month: the usual line, once, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-1', kind: 'paused', seq: 1, why: 'allowance' })).toBe(
            "I paused “Visa form”: this month's computer time is used up. Nothing is lost. Tap Ask for more in [Usage](#usage) and it carries on by itself."
        );
    });

    it('paused at the person’s spending limit: the usual line, once, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-1', kind: 'paused', seq: 3, why: 'rule' })).toBe('I paused “Visa form”: it reached the spending limit you set. Nothing is lost. Raise the limit or say resume.');
    });

    it('paused for the month while the person held the screen: the held-screen line, once, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-1', kind: 'paused', seq: 2, why: 'allowance', heldScreen: true })).toBe(
            "I had to take the screen back and pause “Visa form”: this month's computer time is used up. The job and its files are kept. Tap Ask for more in [Usage](#usage), and I'll ask you before I carry on."
        );
    });

    it('paused at the spending limit while the person held the screen: the held-screen line, once, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-1', kind: 'paused', seq: 4, why: 'rule', heldScreen: true })).toBe(
            'I had to take the screen back and pause “Visa form”: it reached the spending limit you set. The job and its files are kept. Raise the limit or say resume.'
        );
    });

    it('carried_on: said once when the job carries on by itself, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-1', kind: 'carried_on', seq: 2 })).toBe("I'm carrying on with “Visa form”.");
    });

    it('can_carry_on (C7.3: the Apps changed, a step’s outcome is unknown, or the screen was taken back): Brick asks once, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-2', kind: 'can_carry_on', seq: 1 })).toBe('“Hotel booking” can carry on now. Want me to?');
    });

    // GPT's sixth answer, finding 5: the pause is over, but the job is in line rather than running. One line for either reason it waits (another job on this computer, or every computer busy)
    it('back_in_line: more time arrived and the pause is over, but its turn has not come: said once, confirmed by its number', async () => {
        expect(await oneRound({ jobId: 'job-2', kind: 'back_in_line', seq: 1 })).toBe('“Hotel booking” is back in line. It carries on by itself when its turn comes.');
    });

    it('a pause then its carrying on of the same job are two messages, each confirmed under its own number, never one for the other', async () => {
        tellings = [{ jobId: 'job-1', kind: 'paused', seq: 1, why: 'rule', told: false }];
        const { said, reports } = chat();
        await reports.tick();
        tellings.push({ jobId: 'job-1', kind: 'carried_on', seq: 2, told: false });
        await reports.tick();
        expect(said.map((one) => one.text)).toEqual(['I paused “Visa form”: it reached the spending limit you set. Nothing is lost. Raise the limit or say resume.', "I'm carrying on with “Visa form”."]);
        expect(confirms.map((one) => one.body)).toEqual([
            { jobId: 'job-1', kind: 'paused', seq: 1 },
            { jobId: 'job-1', kind: 'carried_on', seq: 2 },
        ]);
        expect(confirms.every((one) => one.status === 200)).toBe(true);
    });

    it('a person with no chat: the telling is let go as undeliverable with its number (never a 400), and is not said', async () => {
        JOBS['job-3'] = { botId: 'brick-1', title: 'Tax form', person: '' };
        try {
            tellings = [{ jobId: 'job-3', kind: 'can_carry_on', seq: 5, told: false }];
            const { said, reports } = chat();
            expect(await reports.tick()).toBe(0);
            expect(said).toHaveLength(0);
            expect(confirms).toEqual([{ status: 200, body: { jobId: 'job-3', kind: 'can_carry_on', seq: 5, outcome: 'undeliverable', why: 'no_chat' } }]);
        } finally {
            delete JOBS['job-3'];
        }
    });
});
