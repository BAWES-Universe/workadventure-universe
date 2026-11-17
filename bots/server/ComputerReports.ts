/**
 * Brick tells the person how its computer job went (the report back). When a job ends, or waits for the person, Brick writes first in the person's own
 * chat with it, in its own voice: the same way a goal tells the person its news, so a locked phone shows the first sentence as the title.
 *
 * Orbit is the one that knows how a job went, and Orbit never speaks in a chat. So the bot server asks Orbit now and then for what is to be told, says
 * each item once, and tells Orbit it was said:
 *  - the message goes with the item's own key as its Matrix transaction id, so a retry of the same item is the same message to Matrix;
 *  - Orbit is told only after it went out; one that did not is offered again, one that can never go (no chat, the chat refuses) is let go with a line in the log;
 *  - what is said is only what Orbit's record proves: what reached a site and what is not known, the files that appeared while it ran, whether this try was
 *    given back. The computer's own sentence is only ever why it could not go on, and Orbit has cleaned it of links and markup.
 * The person's own Stop, a computer turned off and a Brick deleted are never offered: they just did it.
 */

import type { SpokeAnswer } from './BrickRunner';
import type { StepsField } from '../ai/ToolSteps';

export type ReportKind = 'done' | 'failed' | 'needs' | 'unanswered' | 'month' | 'rule';
export type Waiting = 'details' | 'signin' | 'upload' | 'pay' | 'submit' | 'answer';

export interface ReportEffect {
    kind: string;
    state: 'done' | 'unknown';
    where: string | null;
}

/** One thing to tell, as Orbit gives it (GET /api/computer/jobs/reports). */
export interface ComputerReport {
    key: string;
    jobId: string;
    botId: string;
    matrixUserId: string | null;
    kind: ReportKind;
    title: string;
    writes: boolean;
    seconds: number;
    seq: number | null;
    waitingFor: Waiting | null;
    ready: { what: string; where: string } | null;
    waitedFor: Waiting | null;
    why: string | null;
    effects: ReportEffect[];
    files: string[];
    givenBack: boolean;
}

const KINDS: readonly ReportKind[] = ['done', 'failed', 'needs', 'unanswered', 'month', 'rule'];
const WAITINGS: readonly Waiting[] = ['details', 'signin', 'upload', 'pay', 'submit', 'answer'];

/** One report of Orbit's answer, kept only when it has what a message needs. */
export function computerReportOf(raw: unknown): ComputerReport | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const report = raw as Record<string, unknown>;
    const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
    if (!text(report.key) || !text(report.jobId) || !text(report.botId) || !text(report.title)) return null;
    if (typeof report.kind !== 'string' || !(KINDS as readonly string[]).includes(report.kind)) return null;
    const waiting = (value: unknown): Waiting | null => (typeof value === 'string' && (WAITINGS as readonly string[]).includes(value) ? (value as Waiting) : null);
    const ready = report.ready as { what?: unknown; where?: unknown } | null | undefined;
    const effects: ReportEffect[] = [];
    if (Array.isArray(report.effects)) {
        for (const one of report.effects) {
            const effect = one as { kind?: unknown; state?: unknown; where?: unknown } | null;
            if (typeof effect?.kind === 'string' && (effect.state === 'done' || effect.state === 'unknown')) effects.push({ kind: effect.kind, state: effect.state, where: typeof effect.where === 'string' && effect.where ? effect.where : null });
        }
    }
    const kind = report.kind as ReportKind;
    const seq = typeof report.seq === 'number' ? report.seq : null;
    // A wait is told by its number: without one it could not be marked as told for that wait only
    if (kind === 'needs' && (seq === null || waiting(report.waitingFor) === null)) return null;
    return {
        key: report.key,
        jobId: report.jobId,
        botId: report.botId,
        matrixUserId: typeof report.matrixUserId === 'string' && report.matrixUserId ? report.matrixUserId : null,
        kind,
        title: report.title,
        writes: report.writes !== false,
        seconds: typeof report.seconds === 'number' && report.seconds > 0 ? Math.round(report.seconds) : 0,
        seq,
        waitingFor: waiting(report.waitingFor),
        ready: ready && typeof ready.what === 'string' && ready.what && typeof ready.where === 'string' && ready.where ? { what: ready.what, where: ready.where } : null,
        waitedFor: waiting(report.waitedFor),
        why: typeof report.why === 'string' && report.why ? report.why : null,
        effects,
        files: Array.isArray(report.files) ? report.files.filter((name): name is string => typeof name === 'string' && name.length > 0) : [],
        givenBack: report.givenBack === true,
    };
}

// --- the words -------------------------------------------------------------------------------------------------------------------------------

/** A job's title as the first words of a message: no stop at its end (a sentence of its own follows it), and short enough to be a headline on a locked phone. */
function nameOf(title: string, max = 48): string {
    const name = title.replace(/\s+/g, ' ').trim().replace(/[.!?…:;,\s]+$/, '');
    // By whole characters, never in the middle of an emoji (a half of one is no text a chat accepts)
    const letters = Array.from(name);
    return letters.length > max ? `${letters.slice(0, max - 1).join('').trimEnd()}…` : name;
}

const sentence = (text: string): string => {
    const trimmed = text.trim().replace(/[\s]+/g, ' ');
    return /[.!?…]["”’)]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
};
const capital = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text);
const list = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const DONE_WORDS: Record<string, (where: string | null) => string> = {
    send: (where) => (where ? `Sent to ${where}.` : 'It was sent.'),
    publish: (where) => (where ? `Published at ${where}.` : 'It was published.'),
    upload: (where) => (where ? `Uploaded to ${where}.` : 'It was uploaded.'),
    details: (where) => (where ? `Your details were filled in at ${where}.` : 'Your details were filled in.'),
    submit: (where) => (where ? `Submitted at ${where}.` : 'It was submitted.'),
    pay: (where) => (where ? `Paid at ${where}.` : 'It was paid.'),
};
const UNSURE_NOUN: Record<string, string> = { send: 'message', publish: 'publishing', upload: 'upload', details: 'filling in of your details', submit: 'submission', pay: 'payment' };

/**
 * What reached other places, from the record only: what is known to have gone, what was tried and is not known, and (only then) that the record
 * shows nothing went. A job that was only to look says that instead.
 */
export function receiptOf(report: Pick<ComputerReport, 'effects' | 'writes'>, quiet: 'ended' | 'waiting' = 'ended'): string {
    const done = report.effects.filter((effect) => effect.state === 'done').map((effect) => (DONE_WORDS[effect.kind] ?? (() => 'Something was done.'))(effect.where));
    const unsure = report.effects
        .filter((effect) => effect.state === 'unknown')
        .map((effect) => `I'm not sure the ${UNSURE_NOUN[effect.kind] ?? 'step'}${effect.where ? ` at ${effect.where}` : ''} went through, so check it before you rely on it.`);
    const parts = [...done, ...unsure];
    if (parts.length > 0) return parts.join(' ');
    if (!report.writes) return 'I only looked, so nothing was sent, filled in or changed.';
    return quiet === 'waiting' ? 'Nothing has been sent or paid yet.' : 'My record shows nothing was sent or paid.';
}

const STEP_NAME: Record<Waiting, string> = {
    details: 'step for your details',
    signin: 'sign-in',
    upload: 'upload',
    pay: 'payment step',
    submit: 'submit step',
    answer: 'question',
};

const NEEDS_NEXT: Record<Waiting, string> = {
    details: 'Tap Take over, then “Fill in my details”.',
    signin: 'Tap Take over and sign in, then hand it back and I’ll carry on.',
    upload: 'Tap Take over and choose the file to upload, then hand it back.',
    pay: 'The next step is paying, and that is always yours. Tap Take over, pay, then hand it back.',
    submit: 'The next step is submitting, and that is always yours. Tap Take over, look it over, submit, then hand it back.',
    answer: 'I need something from you. Tap Take over to see what, then hand it back.',
};

/** What Brick says, in its own voice. The first sentence is the news: a locked phone shows it as the title. */
export function reportText(report: ComputerReport): string {
    const name = nameOf(report.title);
    switch (report.kind) {
        case 'done': {
            const made = report.files.length > 0 ? ` It saved ${list(report.files.slice(0, 3))}${report.files.length > 3 ? ` and ${report.files.length - 3} more` : ''} on its computer.` : '';
            return `${name} is done. ${receiptOf(report)}${made}`;
        }
        case 'needs': {
            const next = NEEDS_NEXT[report.waitingFor ?? 'answer'];
            const ready =
                report.waitingFor === 'details' && report.ready && !report.effects.some((effect) => effect.kind === 'details' && effect.state === 'done')
                    ? ` I'm ready to put in ${report.ready.what.trim().replace(/[.!?]+$/, '')} at ${report.ready.where.trim().replace(/[.!?]+$/, '')}, and nothing of yours has reached it yet.`
                    : '';
            // Paying and submitting are the person's: they are told, from the record, that nothing has gone yet (or what has)
            const so = report.effects.length > 0 || report.waitingFor === 'pay' || report.waitingFor === 'submit' ? ` ${receiptOf(report, 'waiting')}` : '';
            return `${name} needs you.${ready}${so} ${next}`;
        }
        case 'failed': {
            const why = report.why ? ` ${capital(sentence(report.why))}` : '';
            const back = report.givenBack ? " This try won't count against your month." : '';
            return `I couldn't finish ${name}.${why} ${receiptOf(report)} My computer kept what I had ready.${back} Want me to try again, or would you rather do that step yourself?`;
        }
        case 'unanswered': {
            const step = report.waitedFor ? `the ${STEP_NAME[report.waitedFor]}` : 'a step that needed you';
            return `${name} stopped waiting for you. I waited at ${step} and nobody came, so my computer went to rest. ${receiptOf(report)} Everything is saved: tell me when you're ready and I'll pick it up from there.`;
        }
        case 'month':
            return `My computer time for this month ran out partway through ${name}. What I'd done is saved. ${receiptOf(report)} To go on, tap Ask for more in Usage, then ask me to carry on.`;
        case 'rule': {
            const said = report.why ? ` You said: “${report.why.replace(/[.!?]+$/, '')}”.` : '';
            return `I stopped ${name} because of a rule you set.${said} ${receiptOf(report)} My computer kept what I had ready.`;
        }
    }
}

/** The "Worked on its computer · 9 min" line a finished job shows above its message, in the field the game already draws for a reply's steps. */
export function workedLine(report: Pick<ComputerReport, 'title' | 'seconds'>, now: number = Date.now()): { field: StepsField; text: string } {
    const secs = Math.max(1, report.seconds);
    const detail = nameOf(report.title, 60);
    const field: StepsField = {
        v: 1,
        state: 'done',
        line: 'Worked on its computer',
        startedAt: now - secs * 1000,
        took: secs,
        steps: [{ doing: 'Working on its computer', done: 'Worked on its computer', ...(detail ? { detail } : {}), state: 'done', kind: 'write', secs }],
    };
    return { field, text: 'Worked on its computer' };
}

// --- saying it -------------------------------------------------------------------------------------------------------------------------------

/** What this part asks of Orbit. */
export interface ComputerReportsApi {
    /** What is to be told now; throws when Orbit cannot be asked (nothing is lost: it is offered again). */
    reports(): Promise<ComputerReport[]>;
    /** Orbit is told it was said (or can never be). False when Orbit did not take it: it is offered again and said again as the same message. */
    keepTold(report: Pick<ComputerReport, 'jobId' | 'kind' | 'seq'>): Promise<boolean>;
}

/** Says something in a person's own chat with a Brick; `steps` puts a "Worked on its computer" line above it. */
export interface ComputerSpeaker {
    say(brickId: string, matrixUserId: string, text: string, transactionId: string, extra?: { steps?: { field: StepsField; text: string } }): Promise<SpokeAnswer>;
}

export class ComputerReports {
    private running = false;
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;

    constructor(
        private readonly api: ComputerReportsApi,
        private readonly speaker: ComputerSpeaker,
        private readonly log: Pick<Console, 'warn'> = console
    ) {}

    /** Asks Orbit every `everyMs`, one round after another: a slow round never overlaps the next. */
    start(everyMs: number): void {
        this.stopped = false;
        const next = () => {
            if (this.stopped) return;
            this.timer = setTimeout(async () => {
                await this.tick();
                next();
            }, everyMs);
            this.timer.unref?.();
        };
        next();
    }

    stop(): void {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
    }

    /** One round: what is to be told is said, oldest first, each once. Returns how many were said. Safe to call twice at once: the second does nothing. */
    async tick(): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            let reports: ComputerReport[];
            try {
                reports = await this.api.reports();
            } catch (error) {
                this.log.warn('[ComputerReports] Could not ask Orbit what is to be told:', error instanceof Error ? error.message : error);
                return 0;
            }
            let said = 0;
            for (const report of reports) {
                if (this.stopped) break;
                try {
                    if (await this.sayOne(report)) said += 1;
                } catch (error) {
                    // One report that breaks never stops the ones behind it; Orbit offers it again
                    this.log.warn(`[ComputerReports] Could not tell about job ${report.jobId}:`, error instanceof Error ? error.message : error);
                }
            }
            return said;
        } finally {
            this.running = false;
        }
    }

    /** True when it went out. A report that can never go is let go (told to Orbit as told) with a line in the log; one that could not go just now is left. */
    private async sayOne(report: ComputerReport): Promise<boolean> {
        if (!report.matrixUserId) {
            this.log.warn(`[ComputerReports] Job ${report.jobId} (${report.kind}) has no chat to be told in; kept as told`);
            await this.api.keepTold(report);
            return false;
        }
        const spoke = await this.speaker.say(report.botId, report.matrixUserId, reportText(report), report.key, report.kind === 'done' ? { steps: workedLine(report) } : undefined);
        if ('eventId' in spoke) {
            if (!(await this.api.keepTold(report))) this.log.warn(`[ComputerReports] Orbit did not keep that job ${report.jobId} (${report.kind}) was told; it goes out again as the same message`);
            return true;
        }
        if (spoke.reason === 'unsure') return false;
        this.log.warn(`[ComputerReports] Job ${report.jobId} (${report.kind}) cannot be told in chat (${spoke.reason}); kept as told`);
        await this.api.keepTold(report);
        return false;
    }
}
