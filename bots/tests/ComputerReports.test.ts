import { describe, expect, it, vi } from 'vitest';
import { ComputerReports, computerReportOf, reportText, receiptOf, workedLine, type ComputerReport, type ComputerReportsApi, type ComputerSpeaker } from '../server/ComputerReports';
import { AdminApiService } from '../server/AdminApiService';

const base: ComputerReport = {
    key: 'computer-told:job-1:done',
    jobId: 'job-1',
    botId: 'brick-1',
    matrixUserId: '@sara:chat.test',
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
    givenBack: false,
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

function round(reports: ComputerReport[], answers: Array<{ ok: true; eventId: string } | { ok: false; reason: 'no_chat' | 'not_allowed' | 'unsure' }> = []) {
    const told: Array<Pick<ComputerReport, 'jobId' | 'kind' | 'seq'>> = [];
    const said: Array<{ brickId: string; to: string; text: string; transactionId: string; steps: boolean }> = [];
    const api: ComputerReportsApi = {
        reports: vi.fn(async () => reports),
        keepTold: vi.fn(async (one) => {
            told.push({ jobId: one.jobId, kind: one.kind, seq: one.seq });
            return true;
        }),
    };
    const speaker: ComputerSpeaker = {
        say: vi.fn(async (brickId, to, text, transactionId, extra) => {
            said.push({ brickId, to, text, transactionId, steps: !!extra?.steps });
            return answers.shift() ?? { ok: true as const, eventId: '$e' };
        }),
    };
    const warn = vi.fn();
    return { runner: new ComputerReports(api, speaker, { warn }), api, speaker, told, said, warn };
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

    it('lets go of one that can never be said (no chat, the chat refuses, no chat id), with a line in the log, so it is not offered for ever', async () => {
        const { runner, told, warn, said } = round([report({ key: 'a' }), report({ key: 'b', jobId: 'job-2' }), report({ key: 'c', jobId: 'job-3', matrixUserId: null })], [{ ok: false, reason: 'no_chat' }, { ok: false, reason: 'not_allowed' }]);
        expect(await runner.tick()).toBe(0);
        expect(told.map((one) => one.jobId)).toEqual(['job-1', 'job-2', 'job-3']);
        expect(warn).toHaveBeenCalledTimes(3);
        // The one with no chat id was never sent anywhere
        expect(said.map((one) => one.transactionId)).toEqual(['a', 'b']);
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
