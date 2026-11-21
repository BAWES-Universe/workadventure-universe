import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ComputerReports, FILE_TRIES, computerReportOf, missedText, moneyText, reportText, receiptOf, workedLine, type AttachedFile, type ComputerReport, type ComputerReportsApi, type ComputerSpeaker, type ComputerSpoke, type FilesAnswer, type UndeliverableWhy } from '../server/ComputerReports';
import axios from 'axios';
import { AdminApiService } from '../server/AdminApiService';

const base: ComputerReport = {
    key: 'computer-told:job-1:done',
    jobId: 'job-1',
    botId: 'brick-1',
    matrixUserId: '@sara:chat.test',
    origin: null,
    kind: 'done',
    title: 'Visa form',
    writes: true,
    seconds: 540,
    seq: null,
    waitingFor: null,
    ready: null,
    waitedFor: null,
    why: null,
    effects: [],
    files: [],
    handed: [],
    givenBack: false,
    refundPendingMicros: 0,
    apps: [],
    holdReleased: false,
};
const report = (over: Partial<ComputerReport>): ComputerReport => ({ ...base, ...over });

/** The first sentence is the news: a locked phone shows it as the title (up to 70 characters). */
const firstSentence = (text: string) => text.match(/^[^.!?]*[.!?]/)?.[0] ?? '';

describe('what Brick says when a computer job ends or waits', () => {
    it('says it finished, with the first sentence as a short news line for a locked phone', () => {
        const text = reportText(report({}));
        expect(firstSentence(text)).toBe('Visa form is done.');
        expect(firstSentence(text).length).toBeLessThanOrEqual(70);
    });

    it('says only what the record proves: what went where, what is not known, or that the record shows nothing', () => {
        expect(reportText(report({}))).toBe('Visa form is done. My record shows nothing was sent or paid.');
        expect(reportText(report({ writes: false }))).toBe('Visa form is done. I only looked, so nothing was sent, filled in or changed.');
        expect(reportText(report({ effects: [{ kind: 'send', state: 'done', where: 'the embassy desk' }, { kind: 'details', state: 'done', where: 'visa-portal.example' }] }))).toBe(
            'Visa form is done. Sent to the embassy desk. Your details were filled in at visa-portal.example.'
        );
        const unsure = reportText(report({ effects: [{ kind: 'submit', state: 'unknown', where: 'visa-portal.example' }] }));
        expect(unsure).toContain('not sure the submission at visa-portal.example went through, so check it before you rely on it');
        // An outcome that is not known is never claimed as sent
        expect(unsure).not.toMatch(/Submitted at|nothing was sent/);
    });

    it('names the files that appeared and no more than the first three', () => {
        expect(reportText(report({ files: ['visa-receipt.pdf'] }))).toContain('It saved visa-receipt.pdf on its computer.');
        expect(reportText(report({ files: ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf', 'e.pdf'] }))).toContain('It saved a.pdf, b.pdf and c.pdf and 2 more on its computer.');
    });

    it('says what it needs and why it is not Brick’s to do: paying and submitting are always the person’s', () => {
        const details = reportText(report({ kind: 'needs', seq: 1, waitingFor: 'details', ready: { what: 'Your name and passport number', where: 'visa-portal.example' } }));
        expect(firstSentence(details)).toBe('Visa form needs you.');
        expect(details).toContain('I\'m ready to put in Your name and passport number at visa-portal.example, and nothing of yours has reached it yet.');
        expect(details).toContain('Tap Take over, then “Fill in my details”.');
        // A step for details that went through, or may have, never says that nothing of theirs has reached the site (the record shows otherwise, or does not know)
        for (const state of ['done', 'unknown'] as const) {
            const touched = reportText(report({ kind: 'needs', seq: 1, waitingFor: 'details', ready: { what: 'Your name', where: 'visa-portal.example' }, effects: [{ kind: 'details', state, where: 'visa-portal.example' }] }));
            expect(touched).not.toContain('nothing of yours has reached it yet');
        }
        expect(reportText(report({ kind: 'needs', seq: 1, waitingFor: 'details', ready: { what: 'Your name', where: 'visa-portal.example' }, effects: [{ kind: 'details', state: 'unknown', where: 'visa-portal.example' }] }))).toContain(
            'not sure the'
        );
        const pay = reportText(report({ kind: 'needs', seq: 1, waitingFor: 'pay' }));
        expect(pay).toContain('Nothing has been sent or paid yet.');
        expect(pay).toContain('paying, and that is always yours');
        expect(reportText(report({ kind: 'needs', seq: 1, waitingFor: 'submit' }))).toContain('submitting, and that is always yours');
        expect(reportText(report({ kind: 'needs', seq: 1, waitingFor: 'signin' }))).toContain('sign in');
        expect(reportText(report({ kind: 'needs', seq: 1, waitingFor: 'upload' }))).toContain('choose the file to upload');
        expect(reportText(report({ kind: 'needs', seq: 1, waitingFor: 'answer' }))).toContain('I need something from you');
    });

    it('does not say nothing of the person’s reached the site when their details already went in', () => {
        const text = reportText(
            report({ kind: 'needs', seq: 2, waitingFor: 'details', ready: { what: 'Your name', where: 'visa-portal.example' }, effects: [{ kind: 'details', state: 'done', where: 'visa-portal.example' }] })
        );
        expect(text).not.toContain('nothing of yours has reached it yet');
        expect(text).toContain('Your details were filled in at visa-portal.example.');
    });

    it('says it could not finish with the computer’s sentence apart from the facts, and gives the try back only when the record proves it', () => {
        const failed = reportText(report({ kind: 'failed', why: 'the site stopped me at the passport upload and kept showing an error', givenBack: true }));
        expect(failed).toBe(
            "I couldn't finish Visa form. The site stopped me at the passport upload and kept showing an error. My record shows nothing was sent or paid. My computer kept what I had ready. This try won't count against your month. Want me to try again, or would you rather do that step yourself?"
        );
        expect(reportText(report({ kind: 'failed', givenBack: false }))).not.toContain('count against your month');
        // Something that did go before it stopped is said, not hidden behind "nothing was sent"
        const partway = reportText(report({ kind: 'failed', effects: [{ kind: 'send', state: 'done', where: 'the embassy desk' }] }));
        expect(partway).toContain('Sent to the embassy desk.');
        expect(partway).not.toContain('nothing was sent or paid');
    });

    it('says a refund that is pending as pending, and not that the try was given back', () => {
        const text = reportText(report({ kind: 'failed', givenBack: true, refundPendingMicros: 50_000 }));
        expect(text).toContain('$0.05 refund pending.');
        expect(text).not.toContain("won't count against your month");
        expect(text).not.toMatch(/given back|returned/i);
        // from an older Orbit, or with nothing pending, it reads as before
        expect(reportText(report({ kind: 'failed', givenBack: true, refundPendingMicros: 0 }))).toContain("This try won't count against your month.");
        expect(reportText(report({ kind: 'failed', givenBack: false }))).not.toContain('refund pending');
        // and in the other reports that carry a receipt
        expect(reportText(report({ kind: 'done', refundPendingMicros: 9_000 }))).toContain('$0.009 refund pending.');
        expect(reportText(report({ kind: 'rule', refundPendingMicros: 120_000 }))).toContain('$0.12 refund pending.');
        expect(receiptOf({ effects: [], writes: true, refundPendingMicros: 50_000 })).toBe('My record shows nothing was sent or paid. $0.05 refund pending.');
    });

    it('says a refund that is pending in every message that needs the person, whatever it waits for, with or without effects', () => {
        for (const waitingFor of ['signin', 'upload', 'details', 'answer', 'pay', 'submit'] as const) {
            const text = reportText(report({ kind: 'needs', waitingFor, effects: [], refundPendingMicros: 50_000 }));
            expect(text, waitingFor).toContain('$0.05 refund pending.');
            // nothing pending: nothing is said, as before
            expect(reportText(report({ kind: 'needs', waitingFor, effects: [], refundPendingMicros: 0 })), waitingFor).not.toContain('refund pending');
        }
        // sign-in with nothing done yet reads in the waiting voice, with the pending refund last
        expect(reportText(report({ kind: 'needs', waitingFor: 'signin', effects: [], writes: true, refundPendingMicros: 50_000 }))).toContain('Nothing has been sent or paid yet. $0.05 refund pending.');
    });

    it("writes money exactly as Orbit's dollars() does: thousandths under a cent, cents above, rounded the same way", () => {
        const table: Array<[number, string]> = [
            [0, '$0'],
            [1, 'less than $0.001'],
            [499, 'less than $0.001'],
            [500, '$0.001'],
            [1200, '$0.001'],
            [1500, '$0.002'],
            [2500, '$0.003'],
            [9000, '$0.009'],
            [9999, '$0.010'],
            [10000, '$0.01'],
            [10001, '$0.01'],
            [15000, '$0.01'],
            [25000, '$0.03'],
            [35000, '$0.04'],
            [45000, '$0.04'],
            [50000, '$0.05'],
            [1250000, '$1.25'],
            [5000000, '$5.00'],
            [3209999, '$3.21'],
        ];
        for (const [micros, said] of table) expect(moneyText(micros)).toBe(said);
    });

    it('reads the refund Orbit has not paid yet as whole micros, and none from an older Orbit or from nonsense', () => {
        const raw = { key: 'k', jobId: 'j', botId: 'b', title: 'T', kind: 'failed' };
        expect(computerReportOf({ ...raw, refundPendingMicros: 50_000.4 })?.refundPendingMicros).toBe(50_000);
        expect(computerReportOf(raw)?.refundPendingMicros).toBe(0);
        for (const bad of [0, -5, 'x', null, Number.NaN, Infinity]) expect(computerReportOf({ ...raw, refundPendingMicros: bad })?.refundPendingMicros).toBe(0);
    });

    it('says nobody came, at which step, and that it is all saved', () => {
        const text = reportText(report({ kind: 'unanswered', waitedFor: 'pay' }));
        expect(firstSentence(text)).toBe('Visa form stopped waiting for you.');
        expect(text).toContain('I waited at the payment step and nobody came, so my computer went to rest.');
        expect(text).toContain("Everything is saved: tell me when you're ready and I'll pick it up from there.");
        expect(reportText(report({ kind: 'unanswered', waitedFor: null }))).toContain('a step that needed you');
    });

    it('says the month ran out without a number or a price, and points to Ask for more', () => {
        const text = reportText(report({ kind: 'month' }));
        expect(text).toBe('My computer time for this month ran out partway through Visa form. What I\'d done is saved. My record shows nothing was sent or paid. To go on, tap Ask for more in Usage, then ask me to carry on.');
        expect(text).not.toMatch(/\$|\d/);
    });

    it('says a rule the person set stopped it, in their words', () => {
        const text = reportText(report({ kind: 'rule', why: 'no more than $1 a month' }));
        expect(text).toContain('I stopped Visa form because of a rule you set. You said: “no more than $1 a month”.');
    });

    it('never says a job is done for any ending but done: a job stopped at a rule or its computer time, and every other report that is not a finished one, says what it is instead', () => {
        for (const kind of ['failed', 'needs', 'unanswered', 'month', 'rule'] as const) {
            const text = reportText(report({ kind, why: 'no more than $1 a month' }));
            expect(text).not.toMatch(/\bis done\b|\bwas done\b|\bfinished it\b/i);
        }
        // what did work before the stop is said as what it is, beside the stop, never as the job being done
        const stopped = reportText(report({ kind: 'rule', effects: [{ kind: 'send', state: 'done', where: 'the embassy' }] }));
        expect(stopped).toContain('I stopped Visa form because of a rule you set.');
        expect(stopped).toContain('Sent to the embassy.');
        expect(stopped).not.toMatch(/\bis done\b/);
        expect(reportText(report({ kind: 'done' }))).toMatch(/is done\./);
    });

    it('keeps a long title short and without a stop, so the headline is still a headline', () => {
        const text = reportText(report({ title: 'Apply for the tourist visa for two people at the embassy of Kuwait in London.' }));
        expect(firstSentence(text).length).toBeLessThanOrEqual(70);
        expect(text.startsWith('Apply for the tourist visa for two people at th… is done.')).toBe(true);
        expect(firstSentence(text).endsWith('… is done.')).toBe(true);
    });

    it('cuts a long title between whole characters, never through an emoji', () => {
        const title = `${'a'.repeat(46)}😀😀😀 and more`;
        const text = reportText(report({ title }));
        const headline = firstSentence(text);
        expect(headline).toBe(`${'a'.repeat(46)}😀… is done.`);
        // No half of an emoji is left behind
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false);
    });

    it('draws the “Worked on its computer” line from how long the machine was held', () => {
        const { field, text } = workedLine(base, 1_000_000);
        expect(text).toBe('Worked on its computer');
        expect(field).toMatchObject({ v: 1, state: 'done', line: 'Worked on its computer', took: 540, startedAt: 1_000_000 - 540_000 });
        expect(field.steps[0]).toMatchObject({ done: 'Worked on its computer', detail: 'Visa form', state: 'done', secs: 540 });
        expect(workedLine({ title: 'x', seconds: 0 }).field.took).toBe(1);
    });

    it('says nothing about effects it was not given: a receipt of nothing is only said for a job that wrote', () => {
        expect(receiptOf({ effects: [], writes: true }, 'waiting')).toBe('Nothing has been sent or paid yet.');
    });
});

describe('reading what Orbit gives', () => {
    const raw = { ...base, effects: [{ kind: 'send', state: 'done', where: 'x' }, { kind: 'send', state: 'planned' }, 'junk'] };

    it('keeps a report with what a message needs and drops what it does not', () => {
        expect(computerReportOf(raw)?.effects).toEqual([{ kind: 'send', state: 'done', where: 'x' }]);
        expect(computerReportOf({ ...base, kind: 'sold' })).toBeNull();
        expect(computerReportOf({ ...base, key: '' })).toBeNull();
        expect(computerReportOf(null)).toBeNull();
        // A wait without its number or what it waits for could not be told once
        expect(computerReportOf({ ...base, kind: 'needs', seq: null, waitingFor: 'pay' })).toBeNull();
        expect(computerReportOf({ ...base, kind: 'needs', seq: 1, waitingFor: 'bogus' })).toBeNull();
        expect(computerReportOf({ ...base, kind: 'needs', seq: 1, waitingFor: 'pay' })).toMatchObject({ kind: 'needs', seq: 1, waitingFor: 'pay' });
        expect(computerReportOf({ ...base, matrixUserId: null })?.matrixUserId).toBeNull();
    });

    it('reads Orbit’s list through the admin service, and tells Orbit a report was told with its number only for a wait', async () => {
        const admin = new AdminApiService() as unknown as { brickCall: (...args: unknown[]) => Promise<unknown>; computerReports(): Promise<ComputerReport[]>; keepComputerReportTold(r: unknown): Promise<boolean> };
        const calls: unknown[][] = [];
        admin.brickCall = vi.fn(async (...args: unknown[]) => {
            calls.push(args);
            return { data: args[0] === 'get' ? { reports: [raw, { nonsense: true }] } : {} };
        });
        expect((await admin.computerReports()).map((one) => one.jobId)).toEqual(['job-1']);
        expect(calls[0].slice(0, 2)).toEqual(['get', 'api/computer/jobs/reports']);
        expect(await admin.keepComputerReportTold({ jobId: 'job-1', kind: 'done', seq: null })).toBe(true);
        expect(calls[1]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'done' }]);
        expect(await admin.keepComputerReportTold({ jobId: 'job-1', kind: 'needs', seq: 2 })).toBe(true);
        expect(calls[2]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'needs', seq: 2 }]);
        admin.brickCall = vi.fn(async () => {
            throw new Error('Orbit down');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await admin.keepComputerReportTold({ jobId: 'job-1', kind: 'done', seq: null })).toBe(false);
        warn.mockRestore();
    });
});

describe('what the bot server tells Orbit about delivery', () => {
    function admin() {
        const service = new AdminApiService() as unknown as {
            brickCall: (...args: unknown[]) => Promise<unknown>;
            keepComputerReportUndeliverable(r: unknown, why: string): Promise<boolean>;
            keepComputerFileDelivered(jobId: string, fileId: string): Promise<boolean>;
            startComputerJob(bot: string, user: string, ask: unknown): Promise<unknown>;
        };
        const calls: unknown[][] = [];
        service.brickCall = vi.fn(async (...args: unknown[]) => {
            calls.push(args);
            return { data: { ok: true, job: { id: 'job-1', status: 'queued' } } };
        });
        return { service, calls };
    }

    it('waits for Orbit to hand the files over when a job finishes (minutes), and for nothing else longer than a few seconds', async () => {
        const service = new AdminApiService() as unknown as { brickCall: (...args: unknown[]) => Promise<unknown>; computerJobAction(bot: string, job: string, body: Record<string, unknown>): Promise<unknown> };
        const calls: unknown[][] = [];
        service.brickCall = vi.fn(async (...args: unknown[]) => {
            calls.push(args);
            return { data: {} };
        });
        await service.computerJobAction('bot-1', 'job-1', { action: 'finish', outcome: 'done' });
        await service.computerJobAction('bot-1', 'job-1', { action: 'renew' });
        // The fifth argument is how long the call may take: the finish may wait past the files' time budget (4 minutes), the others keep the short one
        expect(calls[0][4]).toBeGreaterThan(4 * 60_000);
        expect(calls[1][4]).toBe(8_000);
    });

    it('says a report is undeliverable with its reason, which is never the same call as told', async () => {
        const { service, calls } = admin();
        expect(await service.keepComputerReportUndeliverable({ jobId: 'job-1', kind: 'done', seq: null }, 'origin_gone')).toBe(true);
        expect(calls[0]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'done', outcome: 'undeliverable', why: 'origin_gone' }]);
        expect(await service.keepComputerReportUndeliverable({ jobId: 'job-1', kind: 'needs', seq: 3 }, 'no_chat')).toBe(true);
        expect(calls[1]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'needs', seq: 3, outcome: 'undeliverable', why: 'no_chat' }]);
    });

    it('says false when Orbit did not take it, so it is said again, and true for a job that is gone', async () => {
        const { service } = admin();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        service.brickCall = vi.fn(async () => {
            throw new Error('Orbit down');
        });
        expect(await service.keepComputerReportUndeliverable({ jobId: 'j', kind: 'done', seq: null }, 'refused')).toBe(false);
        expect(await service.keepComputerFileDelivered('j', 'f')).toBe(false);
        service.brickCall = vi.fn(async () => {
            throw Object.assign(new Error('missing'), { isAxiosError: true, response: { status: 404 } });
        });
        expect(await service.keepComputerReportUndeliverable({ jobId: 'j', kind: 'done', seq: null }, 'refused')).toBe(true);
        expect(await service.keepComputerFileDelivered('j', 'f')).toBe(true);
        warn.mockRestore();
    });

    it('says one file is in the chat, under its job and its own id', async () => {
        const { service, calls } = admin();
        expect(await service.keepComputerFileDelivered('job 1', 'file/1')).toBe(true);
        expect(calls[0].slice(0, 2)).toEqual(['post', 'api/computer/jobs/job%201/files/file%2F1']);
    });

    it('starts a job with the conversation it began in, and without one when none is kept', async () => {
        const { service, calls } = admin();
        await service.startComputerJob('brick-1', 'u', { title: 'Visa form', origin: { kind: 'dm', ref: '!dm:chat.test' } });
        expect(calls[0][2]).toEqual({ userId: 'u', title: 'Visa form', origin: { kind: 'dm', ref: '!dm:chat.test' } });
        await service.startComputerJob('brick-1', 'u', { title: 'Visa form' });
        expect(calls[1][2]).toEqual({ userId: 'u', title: 'Visa form' });
        // a key of its own for each start, in the header Orbit reads it from
        const keyOf = (call: unknown[]) => (call[5] as Record<string, string>)['X-Computer-Start-Attempt'];
        expect(keyOf(calls[0])).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        expect(keyOf(calls[1])).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        expect(keyOf(calls[0])).not.toBe(keyOf(calls[1]));
    });
});

function round(reports: ComputerReport[], answers: ComputerSpoke[] = []) {
    const told: Array<Pick<ComputerReport, 'jobId' | 'kind' | 'seq'>> = [];
    const undeliverable: Array<{ jobId: string; kind: string; why: UndeliverableWhy }> = [];
    const delivered: string[] = [];
    const said: Array<{ brickId: string; to: string; text: string; transactionId: string; steps: boolean; room: string | undefined }> = [];
    const api: ComputerReportsApi = {
        reports: vi.fn(async () => reports),
        keepTold: vi.fn(async (one) => {
            told.push({ jobId: one.jobId, kind: one.kind, seq: one.seq });
            return true;
        }),
        keepUndeliverable: vi.fn(async (one, why) => {
            undeliverable.push({ jobId: one.jobId, kind: one.kind, why });
            return true;
        }),
        keepFileDelivered: vi.fn(async (_job, fileId) => {
            delivered.push(fileId);
            return true;
        }),
        file: vi.fn(async () => Buffer.from('bytes')),
    };
    const speaker: ComputerSpeaker = {
        say: vi.fn(async (brickId, to, text, transactionId, extra) => {
            said.push({ brickId, to, text, transactionId, steps: !!extra?.steps, room: extra?.room });
            return answers.shift() ?? { ok: true as const, eventId: '$e' };
        }),
    };
    const warn = vi.fn();
    return { runner: new ComputerReports(api, speaker, { warn }), api, speaker, told, undeliverable, delivered, said, warn };
}

describe('saying it, once', () => {
    it('says each report in the person’s chat under its own key, then tells Orbit', async () => {
        const { runner, said, told } = round([report({}), report({ key: 'computer-told:job-2:needs:1', jobId: 'job-2', kind: 'needs', seq: 1, waitingFor: 'pay' })]);
        expect(await runner.tick()).toBe(2);
        expect(said.map((one) => [one.brickId, one.to, one.transactionId, one.steps])).toEqual([
            ['brick-1', '@sara:chat.test', 'computer-told:job-1:done', true],
            ['brick-1', '@sara:chat.test', 'computer-told:job-2:needs:1', false],
        ]);
        // A wait is told to Orbit with its number, so a later wait is not hidden by it
        expect(told).toEqual([{ jobId: 'job-1', kind: 'done', seq: null }, { jobId: 'job-2', kind: 'needs', seq: 1 }]);
    });

    it('puts the “Worked on its computer” line on a finished job only', async () => {
        const { runner, said } = round([report({ kind: 'failed', key: 'k1' }), report({ kind: 'unanswered', key: 'k2' }), report({ kind: 'month', key: 'k3' }), report({ key: 'k4' })]);
        await runner.tick();
        expect(said.map((one) => one.steps)).toEqual([false, false, false, true]);
    });

    it('leaves a report that could not be said just now for the next round, and does not tell Orbit it was told', async () => {
        const { runner, told, warn } = round([report({})], [{ ok: false, reason: 'unsure' }]);
        expect(await runner.tick()).toBe(0);
        expect(told).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('never calls a report told when nothing was delivered: no chat, not allowed, the chat it began in is gone, or the chat refuses are undeliverable, each with its reason', async () => {
        const { runner, told, undeliverable, warn, said } = round(
            [report({ key: 'a' }), report({ key: 'b', jobId: 'job-2' }), report({ key: 'c', jobId: 'job-3' }), report({ key: 'd', jobId: 'job-4' }), report({ key: 'e', jobId: 'job-5', matrixUserId: null })],
            [{ ok: false, reason: 'no_chat' }, { ok: false, reason: 'not_allowed' }, { ok: false, reason: 'origin_gone' }, { ok: false, reason: 'refused' }]
        );
        expect(await runner.tick()).toBe(0);
        expect(told).toEqual([]);
        expect(undeliverable).toEqual([
            { jobId: 'job-1', kind: 'done', why: 'no_chat' },
            { jobId: 'job-2', kind: 'done', why: 'not_allowed' },
            { jobId: 'job-3', kind: 'done', why: 'origin_gone' },
            { jobId: 'job-4', kind: 'done', why: 'refused' },
            { jobId: 'job-5', kind: 'done', why: 'no_chat' },
        ]);
        expect(warn).toHaveBeenCalledTimes(5);
        // The one with no chat id was never sent anywhere
        expect(said.map((one) => one.transactionId)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('goes back to the conversation the job began in, and says none when the job has none kept: never a chat it picked', async () => {
        const { runner, said } = round([report({ key: 'a', origin: { kind: 'dm', ref: '!dm:chat.test' } }), report({ key: 'b', jobId: 'job-2', kind: 'failed' , origin: { kind: 'dm', ref: '!dm:chat.test' } }), report({ key: 'c', jobId: 'job-3' })]);
        await runner.tick();
        expect(said.map((one) => one.room)).toEqual(['!dm:chat.test', '!dm:chat.test', undefined]);
    });

    it('reads the conversation a job began in, and drops what is not a direct chat', () => {
        expect(computerReportOf({ ...base, origin: { kind: 'dm', ref: '!dm:chat.test' } })?.origin).toEqual({ kind: 'dm', ref: '!dm:chat.test' });
        expect(computerReportOf({ ...base, origin: { kind: 'group', ref: '!room' } })?.origin).toBeNull();
        expect(computerReportOf({ ...base, origin: { kind: 'dm', ref: '' } })?.origin).toBeNull();
        expect(computerReportOf({ ...base, origin: undefined })?.origin).toBeNull();
    });

    it('keeps an undelivered report in the same state across a restart: it is only ever confirmed after the chat took it, and a chat that did not answer leaves it to be offered again', async () => {
        const first = round([report({})], [{ ok: false, reason: 'unsure' }]);
        expect(await first.runner.tick()).toBe(0);
        expect(first.told).toEqual([]);
        expect(first.undeliverable).toEqual([]);
        // A new runner (the bot server restarted) is offered the same report again and says the same message
        const second = round([report({})]);
        expect(await second.runner.tick()).toBe(1);
        expect(second.said[0].transactionId).toBe(first.said[0].transactionId);
        expect(second.told).toHaveLength(1);
    });

    it('says nothing when Orbit cannot be asked, and carries on with the rest when one report breaks', async () => {
        const down = round([]);
        (down.api.reports as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Orbit down'));
        expect(await down.runner.tick()).toBe(0);
        expect(down.said).toEqual([]);

        const { runner, speaker, said } = round([report({ key: 'a' }), report({ key: 'b', jobId: 'job-2' })]);
        (speaker.say as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
        expect(await runner.tick()).toBe(1);
        expect(said.map((one) => one.transactionId)).toEqual(['b']);
    });

    it('is the same message when Orbit did not keep that it was told and offers it again: same key', async () => {
        const first = round([report({})]);
        (first.api.keepTold as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
        await first.runner.tick();
        await first.runner.tick();
        expect(first.said.map((one) => one.transactionId)).toEqual(['computer-told:job-1:done', 'computer-told:job-1:done']);
        expect(first.warn).toHaveBeenCalledTimes(1);
    });

    it('does not run two rounds at once', async () => {
        const slow = round([report({})]);
        let release: () => void = () => undefined;
        (slow.api.reports as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise<ComputerReport[]>((resolve) => (release = () => resolve([report({})]))));
        const one = slow.runner.tick();
        expect(await slow.runner.tick()).toBe(0);
        release();
        expect(await one).toBe(1);
    });

    it('stops asking when stopped', async () => {
        vi.useFakeTimers();
        const { runner, api } = round([]);
        runner.start(1000);
        await vi.advanceTimersByTimeAsync(2500);
        expect(api.reports).toHaveBeenCalledTimes(2);
        runner.stop();
        await vi.advanceTimersByTimeAsync(5000);
        expect(api.reports).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });
});


/** What Orbit offers for the late follow-up (its contract): the same shape as any report, with the Apps and that the hold was released. */
const lateRaw = {
    key: 'computer-told:job-1:late',
    jobId: 'job-1',
    botId: 'brick-1',
    matrixUserId: '@sara:chat.test',
    origin: { kind: 'dm', ref: '!dm:chat.test' },
    kind: 'late',
    title: 'Send the invoice',
    writes: true,
    seconds: 120,
    seq: null,
    waitingFor: null,
    ready: null,
    waitedFor: null,
    why: null,
    effects: [],
    files: [],
    handed: [],
    givenBack: true,
    refundPendingMicros: 0,
    apps: ['Gmail'],
    holdReleased: true,
};
const lateOf = (over: Record<string, unknown> = {}): ComputerReport => {
    const one = computerReportOf({ ...lateRaw, ...over });
    if (!one) throw new Error('a late report was dropped');
    return one;
};

describe('the late follow-up: an App that went out after all', () => {
    it('says it in Brick’s approved words, one App or several, as one message', () => {
        expect(reportText(lateOf())).toBe('Update: Gmail did go out after all. We couldn’t confirm it earlier. You weren’t charged for it.');
        expect(reportText(lateOf({ apps: ['Gmail', 'Slack'] }))).toBe('Update: Gmail and Slack did go out after all. We couldn’t confirm it earlier. You weren’t charged for it.');
        expect(reportText(lateOf({ apps: ['Gmail', 'Slack', 'Notion'] }))).toBe('Update: Gmail, Slack and Notion did go out after all. We couldn’t confirm it earlier. You weren’t charged for it.');
        // The first sentence is the news a locked phone shows
        expect(firstSentence(reportText(lateOf()))).toBe('Update: Gmail did go out after all.');
    });

    it('names no more than five Apps, and says how many more, so it stays one short message', () => {
        const five = reportText(lateOf({ apps: ['A1', 'A2', 'A3', 'A4', 'A5'] }));
        expect(five).toBe('Update: A1, A2, A3, A4 and A5 did go out after all. We couldn’t confirm it earlier. You weren’t charged for it.');
        const seven = reportText(lateOf({ apps: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] }));
        expect(seven).toBe('Update: A1, A2, A3, A4 and 3 more did go out after all. We couldn’t confirm it earlier. You weren’t charged for it.');
    });

    it('is built only from what Orbit gives: the title, the files, the receipt and the number of a report are never in it', () => {
        const text = reportText(lateOf({ title: 'Secret invoice title', files: ['a.pdf'], effects: [{ kind: 'send', state: 'done', where: 'the embassy' }], why: 'because', refundPendingMicros: 5000 }));
        expect(text).toBe('Update: Gmail did go out after all. We couldn’t confirm it earlier. You weren’t charged for it.');
    });

    it('reads Orbit’s report: the Apps, that the hold was released, no number, and the conversation it began in', () => {
        const one = lateOf({ seq: 7 });
        expect(one).toMatchObject({ key: 'computer-told:job-1:late', kind: 'late', apps: ['Gmail'], holdReleased: true, seq: null, origin: { kind: 'dm', ref: '!dm:chat.test' } });
    });

    it('drops a late report with nothing true to say: no App named, or no word that the hold was released', () => {
        expect(computerReportOf({ ...lateRaw, apps: [] })).toBeNull();
        expect(computerReportOf({ ...lateRaw, apps: undefined })).toBeNull();
        expect(computerReportOf({ ...lateRaw, apps: 'Gmail' })).toBeNull();
        expect(computerReportOf({ ...lateRaw, apps: [3, null, '   '] })).toBeNull();
        expect(computerReportOf({ ...lateRaw, holdReleased: false })).toBeNull();
        expect(computerReportOf({ ...lateRaw, holdReleased: undefined })).toBeNull();
        expect(computerReportOf({ ...lateRaw, holdReleased: 'true' })).toBeNull();
    });

    it('keeps an App’s name as plain text: no markup, links, control characters or line breaks, whole characters, no repeats', () => {
        const one = lateOf({ apps: ['  Gmail  ', '<b>Slack</b>', 'gmail', 'Not\nion\u0000', '[Docs](https://x.test)', '`Sheets`', 'Del\u007fete', 'Tab\tle', 'GMAIL', 'Two    spaces', `   ${'y'.repeat(40)}`, `${'x'.repeat(39)}😀😀😀`] });
        expect(one.apps).toEqual(['Gmail', 'b Slack /b', 'Not ion', 'Docs (https://x.test)', 'Sheets', 'Del ete', 'Tab le', 'Two spaces', 'y'.repeat(40), `${'x'.repeat(39)}😀`]);
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(reportText(one))).toBe(false);
        expect(reportText(one)).not.toMatch(/[<>`[\]\n]/);
    });

    it('keeps at most a dozen Apps from Orbit', () => {
        expect(lateOf({ apps: Array.from({ length: 30 }, (_unused, index) => `App${index}`) }).apps).toHaveLength(12);
    });

    it('is a late report only: the Apps and the word about the hold on any other kind are ignored', () => {
        const done = computerReportOf({ ...lateRaw, kind: 'done', key: 'computer-told:job-1:done' });
        expect(done).toMatchObject({ kind: 'done', apps: [], holdReleased: false });
        expect(reportText(done as ComputerReport)).not.toMatch(/did go out after all|weren’t charged/);
        // A number on a late report is not kept: it is told for the whole job, never for one wait
        expect(computerReportOf({ ...lateRaw, seq: 4 })?.seq).toBeNull();
    });

    it('is told through the admin service: asked for with accepts=late, marked delivered without a number, and marked undeliverable with its reason', async () => {
        const admin = new AdminApiService() as unknown as {
            brickCall: (...args: unknown[]) => Promise<unknown>;
            computerReports(): Promise<ComputerReport[]>;
            keepComputerReportTold(r: unknown): Promise<boolean>;
            keepComputerReportUndeliverable(r: unknown, why: string): Promise<boolean>;
        };
        const calls: unknown[][] = [];
        admin.brickCall = vi.fn(async (...args: unknown[]) => {
            calls.push(args);
            return { data: args[0] === 'get' ? { reports: [lateRaw, { ...lateRaw, key: 'k2', jobId: 'job-2', apps: [] }] } : {} };
        });
        const got = await admin.computerReports();
        // A late report that has no App to name is dropped, the good one is kept
        expect(got.map((one) => [one.jobId, one.kind])).toEqual([['job-1', 'late']]);
        // Asking with accepts=late is what lets Orbit offer it: an older game never asks and never meets the kind
        expect(calls[0].slice(0, 2)).toEqual(['get', 'api/computer/jobs/reports']);
        expect(calls[0][3]).toEqual({ accepts: 'late' });
        expect(await admin.keepComputerReportTold(got[0])).toBe(true);
        expect(calls[1]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'late', outcome: 'delivered' }]);
        expect(await admin.keepComputerReportUndeliverable(got[0], 'origin_gone')).toBe(true);
        expect(calls[2]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'late', outcome: 'undeliverable', why: 'origin_gone' }]);
        // Every other kind is told as before: no outcome word
        expect(await admin.keepComputerReportTold({ jobId: 'job-1', kind: 'done', seq: null })).toBe(true);
        expect(calls[3]).toEqual(['post', 'api/computer/jobs/reports', { jobId: 'job-1', kind: 'done' }]);
    });

    it('says it once in the conversation the job began in, under its own key, with no steps line and no files, then tells Orbit it was delivered', async () => {
        const { runner, said, told } = round([lateOf({ handed: undefined })]);
        expect(await runner.tick()).toBe(1);
        expect(said).toEqual([{ brickId: 'brick-1', to: '@sara:chat.test', text: reportText(lateOf()), transactionId: 'computer-told:job-1:late', steps: false, room: '!dm:chat.test' }]);
        expect(told).toEqual([{ jobId: 'job-1', kind: 'late', seq: null }]);
    });

    it('never attaches files to it, even when Orbit sent some', async () => {
        const { runner, speaker } = round([{ ...lateOf(), handed: handed('a.pdf') }]);
        await runner.tick();
        expect((speaker.say as ReturnType<typeof vi.fn>).mock.calls[0][4]).toEqual({ room: '!dm:chat.test' });
    });

    it('is the same message when Orbit did not keep that it was delivered: a retry carries the same key, so the chat shows it once', async () => {
        const first = round([lateOf()]);
        (first.api.keepTold as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
        await first.runner.tick();
        await first.runner.tick();
        expect(first.said.map((one) => [one.transactionId, one.text])).toEqual([
            ['computer-told:job-1:late', reportText(lateOf())],
            ['computer-told:job-1:late', reportText(lateOf())],
        ]);
    });

    it('leaves it for the next round when the chat did not answer, and never calls it delivered when it could not go: no chat, or a conversation that is gone, is undeliverable with its reason', async () => {
        const unsure = round([lateOf()], [{ ok: false, reason: 'unsure' }]);
        expect(await unsure.runner.tick()).toBe(0);
        expect(unsure.told).toEqual([]);
        expect(unsure.undeliverable).toEqual([]);
        const gone = round([lateOf(), lateOf({ key: 'computer-told:job-2:late', jobId: 'job-2', matrixUserId: null })], [{ ok: false, reason: 'origin_gone' }]);
        expect(await gone.runner.tick()).toBe(0);
        expect(gone.told).toEqual([]);
        expect(gone.undeliverable).toEqual([
            { jobId: 'job-1', kind: 'late', why: 'origin_gone' },
            { jobId: 'job-2', kind: 'late', why: 'no_chat' },
        ]);
    });
});


const handed = (...names: string[]) => names.map((name, index) => ({ id: `file-${index + 1}`, name, bytes: 100, mime: 'application/pdf' }));

describe('the file card: files a finished job made, in the chat after the message', () => {
    it('reads the handed files of Orbit’s answer, keeping only whole ones', () => {
        const raw = {
            ...base,
            handed: [
                { id: 'f1', name: 'visa-receipt.pdf', bytes: 5000, mime: 'application/pdf' },
                { id: '', name: 'no-id.pdf', bytes: 1, mime: 'application/pdf' },
                { id: 'f3', name: 'no-bytes.pdf', mime: 'application/pdf' },
                { id: 'f4', name: 'no-type.pdf', bytes: 1 },
                null,
                'junk',
            ],
        };
        expect(computerReportOf(raw)?.handed).toEqual([{ id: 'f1', name: 'visa-receipt.pdf', bytes: 5000, mime: 'application/pdf' }]);
        expect(computerReportOf({ ...base, handed: 'nope' })?.handed).toEqual([]);
        expect(computerReportOf({ ...base, handed: undefined })?.handed).toEqual([]);
    });

    it('never says a file is attached before the chat took it: it says it is on its way, and the file card is the proof', () => {
        const text = reportText(report({ handed: handed('visa-receipt.pdf', 'b.pdf') }));
        expect(text).not.toMatch(/attached/i);
        expect(text).toContain("I'm sending them below");
    });

    it('says what is on its way, and names what was not handed over', () => {
        expect(reportText(report({ handed: handed('visa-receipt.pdf') }))).toBe('Visa form is done. My record shows nothing was sent or paid. It made visa-receipt.pdf, and I\'m sending it below.');
        expect(reportText(report({ handed: handed('a.pdf', 'b.pdf', 'c.pdf'), files: ['x.zip', 'y.zip'] }))).toBe(
            'Visa form is done. My record shows nothing was sent or paid. It made a.pdf, b.pdf and c.pdf, and I\'m sending them below. It also saved x.zip and y.zip on its computer.'
        );
        // With no card the message is as before
        expect(reportText(report({ files: ['notes.txt'] }))).toBe('Visa form is done. My record shows nothing was sent or paid. It saved notes.txt on its computer.');
    });

    it('still claims only the receipt: a file never turns into "it went through"', () => {
        const text = reportText(report({ handed: handed('visa-receipt.pdf'), effects: [{ kind: 'submit', state: 'unknown', where: 'visa-portal.example' }] }));
        expect(text).toContain("I'm not sure the submission at visa-portal.example went through");
        expect(text).toContain("It made visa-receipt.pdf, and I'm sending it below.");
    });

    function withFiles(reports: ComputerReport[], answer: (files: AttachedFile[]) => FilesAnswer | undefined) {
        const base_ = round(reports);
        const loaded: string[] = [];
        base_.api.file = vi.fn(async (_job: string, id: string) => {
            loaded.push(id);
            return Buffer.from(`bytes of ${id}`);
        });
        const seen: Array<{ transactionId: string; ids: string[] }> = [];
        const speaker: ComputerSpeaker = {
            say: vi.fn(async (brickId, to, text, transactionId, extra) => {
                base_.said.push({ brickId, to, text, transactionId, steps: !!extra?.steps, room: extra?.room });
                const files = extra?.files ?? [];
                seen.push({ transactionId, ids: files.map((file) => file.id) });
                const result = answer(files);
                return { ok: true as const, eventId: '$e', ...(result ? { files: result } : {}) };
            }),
        };
        const runner = new ComputerReports(base_.api, speaker, { warn: base_.warn });
        return { ...base_, speaker, runner, seen, loaded };
    }
    const allIn = (files: AttachedFile[]): FilesAnswer => ({ attached: files.map((file) => file.id), missed: [] });

    it('hands the files to the chat after the message, fetching a file only when it is its turn, and tells Orbit once they are in', async () => {
        const { runner, seen, told, loaded, api } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], (files) => allIn(files));
        expect(await runner.tick()).toBe(1);
        expect(seen).toEqual([{ transactionId: 'computer-told:job-1:done', ids: ['file-1', 'file-2'] }]);
        // Nothing was fetched by this part: the chat side fetches each file as it sends it
        expect(loaded).toEqual([]);
        expect(told).toEqual([{ jobId: 'job-1', kind: 'done', seq: null }]);
        expect(api.keepTold).toHaveBeenCalledTimes(1);
    });

    it('a file’s bytes come from Orbit under the job and the file’s own id, and a file Orbit no longer has is null', async () => {
        const { runner, api, loaded } = withFiles([report({ handed: handed('a.pdf') })], (files) => {
            void files[0].load();
            return allIn(files);
        });
        await runner.tick();
        expect(api.file).toHaveBeenCalledWith('job-1', 'file-1');
        expect(loaded).toEqual(['file-1']);
    });

    it('does not tell Orbit while a file may still go: the next round says the same message and sends only what is missing, then tells', async () => {
        let round_ = 0;
        const { runner, seen, told, said } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], (files) => {
            round_++;
            return round_ === 1 ? { attached: ['file-1'], missed: [{ id: 'file-2', name: 'b.pdf', again: true }] } : allIn(files);
        });
        expect(await runner.tick()).toBe(0);
        expect(told).toEqual([]);
        expect(await runner.tick()).toBe(1);
        expect(seen.map((one) => one.ids)).toEqual([['file-1', 'file-2'], ['file-2']]);
        expect(said.map((one) => one.transactionId)).toEqual(['computer-told:job-1:done', 'computer-told:job-1:done']);
        expect(told).toHaveLength(1);
    });

    it('says once that a file that can never go did not, says it is in Files, and the report is still told: the message did reach the chat', async () => {
        const { runner, said, told } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], () => ({ attached: ['file-1'], missed: [{ id: 'file-2', name: 'b.pdf', again: false }] }));
        expect(await runner.tick()).toBe(1);
        expect(said.map((one) => [one.transactionId, one.text])).toEqual([
            ['computer-told:job-1:done', expect.stringContaining("I'm sending them below.")],
            ['computer-told:job-1:done:missed', "I couldn't attach b.pdf here. It's saved in your Files."],
        ]);
        expect(told).toHaveLength(1);
    });

    it('gives up on a file the chat keeps failing, after a few rounds, and says so', async () => {
        const { runner, said, told } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], () => ({ attached: [], missed: [{ id: 'file-1', name: 'a.pdf', again: true }, { id: 'file-2', name: 'b.pdf', again: true }] }));
        for (let i = 0; i < FILE_TRIES - 1; i++) expect(await runner.tick()).toBe(0);
        expect(told).toEqual([]);
        expect(await runner.tick()).toBe(1);
        expect(said.at(-1)).toMatchObject({ transactionId: 'computer-told:job-1:done:missed', text: "I couldn't attach a.pdf and b.pdf here. They're saved in your Files." });
        expect(told).toHaveLength(1);
    });

    it('keeps the report for the next round when the note about a missing file could not be said', async () => {
        const { runner, speaker, told } = withFiles([report({ handed: handed('a.pdf') })], () => ({ attached: [], missed: [{ id: 'file-1', name: 'a.pdf', again: false }] }));
        const say = speaker.say as ReturnType<typeof vi.fn>;
        const first = say.getMockImplementation()!;
        say.mockImplementationOnce(first).mockImplementationOnce(async () => ({ ok: false as const, reason: 'unsure' as const }));
        expect(await runner.tick()).toBe(0);
        expect(told).toEqual([]);
        expect(await runner.tick()).toBe(1);
        expect(told).toHaveLength(1);
    });

    it('says where a file is that could not be attached, and that one Orbit no longer keeps is gone, never that it is in Files', () => {
        expect(missedText([{ name: 'a.pdf' }])).toBe("I couldn't attach a.pdf here. It's saved in your Files.");
        expect(missedText([{ name: 'a.pdf' }, { name: 'b.pdf' }])).toBe("I couldn't attach a.pdf and b.pdf here. They're saved in your Files.");
        expect(missedText([{ name: 'a.pdf', gone: true }])).toBe("I can't attach a.pdf: it is no longer kept.");
        expect(missedText([{ name: 'a.pdf' }, { name: 'b.pdf', gone: true }])).toBe("I couldn't attach a.pdf here. It's saved in your Files. I can't attach b.pdf: it is no longer kept.");
    });

    it('marks each file delivered once the chat has it, so Files shows it as delivered; a file the chat did not take is never marked', async () => {
        const { runner, delivered } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], () => ({ attached: ['file-1'], missed: [{ id: 'file-2', name: 'b.pdf', again: false }] }));
        await runner.tick();
        expect(delivered).toEqual(['file-1']);
    });

    it('does not call the report told while a file in the chat is still not marked: the mark is made again next round, and nothing is sent twice', async () => {
        const { runner, seen, told, api } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], allIn);
        const keep = api.keepFileDelivered as ReturnType<typeof vi.fn>;
        // Orbit does not take the mark of the second file this round
        keep.mockImplementation(async (_job: string, id: string) => id !== 'file-2');
        expect(await runner.tick()).toBe(0);
        expect(told).toEqual([]);
        // Next round: the files already in the chat are not handed to the chat again, only the marks are made again, and then it is told
        keep.mockImplementation(async () => true);
        expect(await runner.tick()).toBe(1);
        expect(seen[1].ids).toEqual([]);
        expect(keep.mock.calls.filter((call) => call[1] === 'file-2').length).toBeGreaterThanOrEqual(2);
        expect(told).toHaveLength(1);
    });

    it('never gives up on a mark Orbit has not taken: the report is not told however many rounds pass, and is told the round the mark is taken, the log not filling up', async () => {
        const { runner, told, api, warn } = withFiles([report({ handed: handed('a.pdf') })], allIn);
        const keep = api.keepFileDelivered as ReturnType<typeof vi.fn>;
        keep.mockImplementation(async () => false);
        for (let round = 1; round <= FILE_TRIES * 3; round++) expect(await runner.tick()).toBe(0);
        // Long past the rounds a file that cannot go is tried: still not told, so Files never keeps saying "not delivered" for a file that is in the chat
        expect(told).toEqual([]);
        // One line on the first round and one on every FILE_TRIES-th, not one a round
        expect(warn.mock.calls.filter((call) => String(call[0]).includes('did not keep that 1 file(s)'))).toHaveLength(1 + 3);
        keep.mockImplementation(async () => true);
        expect(await runner.tick()).toBe(1);
        expect(told).toHaveLength(1);
    });

    it('never tries a file again after saying it could not be attached, even when the report stays open for a mark Orbit has not taken', async () => {
        const { runner, seen, said, told, api } = withFiles([report({ handed: handed('a.pdf', 'b.pdf') })], (files) => ({
            attached: files.filter((file) => file.id === 'file-1').map((file) => file.id),
            missed: files.some((file) => file.id === 'file-2') ? [{ id: 'file-2', name: 'b.pdf', again: true }] : [],
        }));
        const keep = api.keepFileDelivered as ReturnType<typeof vi.fn>;
        // The first file is in the chat, but Orbit does not take its mark
        keep.mockImplementation(async () => false);
        for (let round = 1; round <= FILE_TRIES; round++) expect(await runner.tick()).toBe(0);
        const noted = said.filter((one) => one.text.includes("couldn't attach b.pdf"));
        expect(noted).toHaveLength(1);
        const offered = seen.length;
        // Later rounds: b.pdf is never offered again, so no card can follow the words that it could not be attached
        for (let round = 0; round < 3; round++) expect(await runner.tick()).toBe(0);
        expect(seen.slice(offered).every((one) => !one.ids.includes('file-2'))).toBe(true);
        expect(said.filter((one) => one.text.includes("couldn't attach b.pdf"))).toHaveLength(1);
        keep.mockImplementation(async () => true);
        expect(await runner.tick()).toBe(1);
        expect(told).toHaveLength(1);
    });

    it('says a file’s mark again when the report is done, in case Orbit missed it the first time', async () => {
        const { runner, delivered } = withFiles([report({ handed: handed('a.pdf') })], allIn);
        await runner.tick();
        expect(delivered).toEqual(['file-1']);
    });

    it('does not send again after a restart what Orbit shows as delivered: Orbit lists only the files not delivered yet, and the same message is deduped by its key', async () => {
        // The first file was marked before the restart: Orbit now hands over only the second
        const { runner, seen, told } = withFiles([report({ handed: [{ id: 'file-2', name: 'b.pdf', bytes: 100, mime: 'application/pdf' }] })], allIn);
        await runner.tick();
        expect(seen).toEqual([{ transactionId: 'computer-told:job-1:done', ids: ['file-2'] }]);
        expect(told).toHaveLength(1);
    });

    it('hands over files for a finished job only', async () => {
        const { runner, seen } = withFiles([report({ kind: 'failed', handed: handed('a.pdf') })], allIn);
        await runner.tick();
        expect(seen[0].ids).toEqual([]);
    });
});

describe('fetching a file from Orbit', () => {
    function adminWith(respond: () => Promise<unknown>) {
        const admin = new AdminApiService() as any;
        admin.isConfigured = () => true;
        admin.adminApiUrl = 'http://orbit.test';
        const get = vi.spyOn(axios, 'get').mockImplementation(respond as never);
        return { admin: admin as AdminApiService, get };
    }
    const token = process.env.BOT_SERVICE_TOKEN;
    beforeAll(() => {
        process.env.BOT_SERVICE_TOKEN = 'service-token';
    });
    afterAll(() => {
        if (token === undefined) delete process.env.BOT_SERVICE_TOKEN;
        else process.env.BOT_SERVICE_TOKEN = token;
        vi.restoreAllMocks();
    });

    it('asks Orbit for the job’s own file with the service token and gives the bytes', async () => {
        const bytes = new Uint8Array([1, 2, 3]).buffer;
        const { admin, get } = adminWith(async () => ({ data: bytes }));
        expect((await admin.computerReportFile('job 1', 'file/1'))?.equals(Buffer.from([1, 2, 3]))).toBe(true);
        const [url, options] = get.mock.calls[0] as [string, { headers: Record<string, string>; responseType: string }];
        expect(url).toBe('http://orbit.test/api/computer/jobs/job%201/files/file%2F1');
        expect(options.headers.Authorization).toBe('Bearer service-token');
        expect(options.responseType).toBe('arraybuffer');
    });

    it('says null when Orbit no longer has the file, and throws when it cannot be asked, so the try is made again', async () => {
        const gone = adminWith(async () => {
            throw Object.assign(new Error('not found'), { isAxiosError: true, response: { status: 404 } });
        });
        expect(await gone.admin.computerReportFile('j', 'f')).toBeNull();
        const down = adminWith(async () => {
            throw new Error('Orbit down');
        });
        await expect(down.admin.computerReportFile('j', 'f')).rejects.toThrow('Orbit down');
    });
});
