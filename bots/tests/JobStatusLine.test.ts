import { describe, expect, it } from 'vitest';
import { ConfirmationQueue, runComputerTool } from '../ai/ComputerTools';
import { JOB_STATUS_PLACEMENT, JOB_STATUS_WORDS, jobLine, quotedTitle, withJobLines, type JobNote } from '../ai/JobStatusLine';

/**
 * The fixed status line of a computer job (the wording and placement approved in the mock): every state and every variant has a line of its own, built from the state Orbit really gave, with
 * and without the job's title. The expected strings are read from `JobStatusLine` (the one file that holds the words), never written out here.
 */
const TITLE = 'Visa form';
const QUOTED = quotedTitle(TITLE);

describe('every state and variant of the job status line', () => {
    const table: Array<[string, JobNote, { titled: (title: string) => string; plain: string }]> = [
        ['started', { state: 'started' }, JOB_STATUS_WORDS.started],
        ['queued, computer time used up (allowance)', { state: 'queued', queuedFor: 'allowance' }, JOB_STATUS_WORDS.queued.allowance],
        ['queued, next in line (turn)', { state: 'queued', queuedFor: 'turn' }, JOB_STATUS_WORDS.queued.turn],
        ['queued, computers paused by the team (busy)', { state: 'queued', queuedFor: 'busy' }, JOB_STATUS_WORDS.queued.other],
        ['queued, no room in the pool (pool)', { state: 'queued', queuedFor: 'pool' }, JOB_STATUS_WORDS.queued.other],
        ['queued, no reason given (null)', { state: 'queued', queuedFor: null }, JOB_STATUS_WORDS.queued.other],
        ['queued, no reason field at all', { state: 'queued' }, JOB_STATUS_WORDS.queued.other],
        ['queued, a reason this server does not know', { state: 'queued', queuedFor: 'something-new' }, JOB_STATUS_WORDS.queued.other],
        ['recovered (found again), this ask', { state: 'recovered' }, JOB_STATUS_WORDS.recovered.now],
        ['recovered (found again), an earlier ask', { state: 'recovered', earlier: true }, JOB_STATUS_WORDS.recovered.earlier],
        ['done, this ask', { state: 'done' }, JOB_STATUS_WORDS.done.now],
        ['done, an earlier ask', { state: 'done', earlier: true }, JOB_STATUS_WORDS.done.earlier],
        ['ended, this ask', { state: 'ended' }, JOB_STATUS_WORDS.ended.now],
        ['ended, an earlier ask', { state: 'ended', earlier: true }, JOB_STATUS_WORDS.ended.earlier],
    ];

    for (const [name, note, words] of table) {
        it(`${name}: with the job's title, and without`, () => {
            expect(jobLine({ ...note, title: TITLE })).toBe(words.titled(QUOTED));
            expect(jobLine(note)).toBe(words.plain);
            // the title is in the line, in curly quotes, and the line without one has none
            expect(jobLine({ ...note, title: TITLE })).toContain(`“${TITLE}”`);
            expect(jobLine(note)).not.toMatch(/[“”"]/);
        });
    }

    it('the lines of the ten states and variants that differ in meaning are all different words', () => {
        const lines = new Set(
            [
                { state: 'started' },
                { state: 'queued', queuedFor: 'allowance' },
                { state: 'queued', queuedFor: 'turn' },
                { state: 'queued', queuedFor: 'pool' },
                { state: 'recovered' },
                { state: 'recovered', earlier: true },
                { state: 'done' },
                { state: 'done', earlier: true },
                { state: 'ended' },
                { state: 'ended', earlier: true },
            ].map((note) => jobLine({ ...(note as JobNote), title: TITLE }))
        );
        expect(lines.size).toBe(10);
    });

    it('a job that is waiting is NEVER told as started or as being worked on, whatever the reason', () => {
        for (const queuedFor of ['allowance', 'turn', 'busy', 'pool', null, undefined]) {
            const line = jobLine({ state: 'queued', title: TITLE, ...(queuedFor === undefined ? {} : { queuedFor }) });
            expect(line).toMatch(/hasn't started yet/);
            expect(line).not.toMatch(/I've started|working on|is running/);
        }
    });

    it('only a job that was MADE waiting with the allowance reason carries the Usage link to ask for more; the others make no promise about the allowance', () => {
        expect(jobLine({ state: 'queued', title: TITLE, queuedFor: 'allowance' })).toContain('[Usage](#usage)');
        expect(jobLine({ state: 'queued', title: TITLE, queuedFor: 'turn' })).not.toContain('Usage');
        expect(jobLine({ state: 'queued', title: TITLE, queuedFor: 'pool' })).not.toContain('Usage');
    });

    it('a job that is found again is told as found, never as started or as finished', () => {
        const line = jobLine({ state: 'recovered', title: TITLE });
        expect(line).not.toMatch(/I've started|has finished|has already ended/);
    });

    it('a title never breaks out of its quotes: a quote of any kind inside it becomes an apostrophe', () => {
        expect(jobLine({ state: 'started', title: 'Say "hi" to “Sam”' })).toBe(JOB_STATUS_WORDS.started.titled('“Say \'hi\' to \'Sam\'”'));
    });

    it('apostrophes are straight and the title quotes are curly, as approved', () => {
        expect(jobLine({ state: 'started', title: TITLE })).toBe(`I've started “Visa form” on my computer.`);
        expect(jobLine({ state: 'queued', title: TITLE, queuedFor: 'turn' })).toBe(`“Visa form” is next in line and hasn't started yet. It starts by itself when the current job ends.`);
    });
});

describe('where the line goes in the reply', () => {
    const line = jobLine({ state: 'started', title: TITLE });

    it('at the END of the reply, in the same message, after ONE blank line', () => {
        expect(JOB_STATUS_PLACEMENT.afterWords).toBe('\n\n');
        expect(withJobLines('Sure, on it.', [line])).toBe(`Sure, on it.\n\n${line}`);
    });

    it('several jobs are joined by a newline, in order', () => {
        const other = jobLine({ state: 'queued', title: 'Taxi', queuedFor: 'turn' });
        expect(JOB_STATUS_PLACEMENT.betweenJobs).toBe('\n');
        expect(withJobLines('Sure.', [line, other])).toBe(`Sure.\n\n${line}\n${other}`);
    });

    it('a reply with no words of its own (a card or a file alone) is the line alone', () => {
        expect(withJobLines('', [line])).toBe(line);
        expect(withJobLines('  \n ', [line])).toBe(line);
    });

    it('a reply that names no job is left exactly as it is', () => {
        expect(withJobLines('Hello there.\n', [])).toBe('Hello there.\n');
    });

    it('the words the model wrote are trimmed before the line is put after them', () => {
        expect(withJobLines('  Sure.  \n\n', [line])).toBe(`Sure.\n\n${line}`);
    });
});

describe('the model is not told to say what the line says (it would be said twice), where there is a line', () => {
    const asked = async (admin: Record<string, unknown>, lined: boolean, job = 'Fill in my visa form') => {
        const queue = new ConfirmationQueue();
        const answer = (await runComputerTool({ job }, { admin: admin as never, botId: 'brick-1', userId: 'uuid-1', ...(lined ? { confirmations: queue } : {}) })) as Record<string, unknown>;
        // what the reply carries under its words (the fixed lines): a refused start must put none there
        return { answer, note: String(answer.note), lines: queue.tell() };
    };
    const made = (status: string, queuedFor: string | null = null) => ({ startComputerJob: async () => ({ ok: true, job: { id: 'job-1', status, queuedFor }, restoredFrom: null }) });

    it('a job that started: in the DM the note says the line tells them and not to say it; in a chat with no line the model is still told what to say', async () => {
        const lined = await asked(made('running'), true);
        expect(lined.answer).toMatchObject({ started: true });
        expect(lined.note).toContain('A fixed line under your reply tells them it started: do not say that yourself');
        expect(lined.note).not.toMatch(/Say in one short sentence what you started/);
        const bare = await asked(made('running'), false);
        expect(bare.note).toMatch(/Say in one short sentence what you started/);
    });

    it('a job that came back from a copy: the copy is still said (the line does not say it), the start is not', async () => {
        const lined = await asked({ startComputerJob: async () => ({ ok: true, job: { id: 'job-1', status: 'running', queuedFor: null }, restoredFrom: '2026-11-20T10:00:00Z' }) }, true);
        expect(lined.note).toContain('came back from its copy of');
        expect(lined.note).toContain('do not say that yourself');
        expect(lined.note).not.toMatch(/working on it/);
    });

    it('a queued job (each reason): the note leaves the waiting to the line', async () => {
        for (const queuedFor of ['allowance', 'turn', 'pool']) {
            const lined = await asked(made('queued', queuedFor), true);
            expect(lined.answer).toMatchObject({ started: false, queued: true });
            expect(lined.note).toContain('was queued and has not started');
            expect(lined.note).toContain('do not say that yourself');
            expect(lined.note).not.toMatch(/Never give a number|Tap Ask for more|tap Ask for more|next in line:|waits in line/);
        }
    });

    it('a job already waiting for the person: the start is left to the line, the need is said', async () => {
        const lined = await asked(made('waiting'), true);
        expect(lined.note).toContain('says it started: do not say that again');
        expect(lined.note).toContain('needs something from them');
    });

    it('a job found again, finished or ended (slow answer): the note leaves it to the line', async () => {
        for (const [status, flag] of [['running', 'found'], ['done', 'done'], ['failed', 'ended']] as const) {
            const admin = { startComputerJob: async () => ({ ok: false, reason: status === 'running' ? 'starting' : status === 'done' ? 'done' : 'ended' }) };
            const lined = await asked(admin, true);
            expect(lined.answer).toMatchObject({ [flag]: true });
            expect(lined.note).toContain('do not say that yourself');
            expect(lined.note).not.toMatch(/Say in one short sentence/);
        }
    });

    it('a start that did not go (off, paused, could not check) has NO line, so the model still says it', async () => {
        for (const reason of ['off', 'paused', 'broken_start']) {
            const lined = await asked({ startComputerJob: async () => ({ ok: false, reason }) }, true);
            expect(lined.note).toMatch(/Say so/);
            expect(lined.note).not.toContain('do not say that yourself');
            // and no fixed line is queued: nothing says "I've started" for a start that did not go
            expect(lined.lines, reason).toEqual([]);
        }
    });
});
