/**
 * Brick tells the person how its computer job went (the report back). When a job ends, or waits for the person, Brick writes first in the person's own
 * chat with it, in its own voice: the same way a goal tells the person its news, so a locked phone shows the first sentence as the title.
 *
 * Orbit is the one that knows how a job went, and Orbit never speaks in a chat. So the bot server asks Orbit now and then for what is to be told, says
 * each item once, and tells Orbit what became of it:
 *  - the message goes with the item's own key as its Matrix transaction id, so a retry of the same item is the same message to Matrix;
 *  - "told" is only ever what reached the chat. One that did not go yet is offered again; one that can never go (no chat, not allowed, the conversation it began in is
 *    gone, the chat refuses it) is told to Orbit as undeliverable with the reason, never as told: what the job made stays with the person in Files;
 *  - it goes back to the conversation the job began in (`origin`) and nowhere else: never a chat made or picked for it;
 *  - what is said is only what Orbit's record proves: what reached a site and what is not known, the files that appeared while it ran, whether this try was
 *    given back. The computer's own sentence is only ever why it could not go on, and Orbit has cleaned it of links and markup.
 * The person's own Stop, a computer turned off and a Brick deleted are never offered: they just did it.
 *
 * The file card: the files a finished job made come as `handed`: they are the person's own, kept by Orbit (and shown in their Files) whether or not the chat took them.
 * Each is fetched from Orbit one at a time, uploaded to the chat and sent as a file message under its own transaction id, after the message, and Orbit is told
 * as soon as each one is in, so a restart never sends one twice. A file that cannot go (too big for the chat, the chat kept refusing) is said so in a short
 * message and stays in Files.
 */

import type { StepsField } from '../ai/ToolSteps';

export type ReportKind = 'done' | 'failed' | 'needs' | 'unanswered' | 'month' | 'rule';
export type Waiting = 'details' | 'signin' | 'upload' | 'pay' | 'submit' | 'answer';

/** A file a finished job made, handed over to be put in the chat as a card. */
export interface HandedFile {
    id: string;
    name: string;
    bytes: number;
    mime: string;
}

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
    /** The conversation the job began in (a direct chat): what it made goes back there. Null for a job that began before this was kept. */
    origin: { kind: 'dm'; ref: string } | null;
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
    /** Files that appeared while the job ran and were not handed over: only named. */
    files: string[];
    /** Files handed over to be put in the chat as cards. */
    handed: HandedFile[];
    givenBack: boolean;
    /** Whole micros of a refund Orbit has promised and not paid yet (0 when none, or from an older Orbit): said as pending, never as given back. */
    refundPendingMicros: number;
}

const KINDS: readonly ReportKind[] = ['done', 'failed', 'needs', 'unanswered', 'month', 'rule'];
const WAITINGS: readonly Waiting[] = ['details', 'signin', 'upload', 'pay', 'submit', 'answer'];

/** The files handed over, each kept only when it has what a card needs. */
function handedOf(raw: unknown): HandedFile[] {
    if (!Array.isArray(raw)) return [];
    const out: HandedFile[] = [];
    for (const one of raw) {
        const file = one as { id?: unknown; name?: unknown; bytes?: unknown; mime?: unknown } | null;
        if (typeof file?.id === 'string' && file.id && typeof file.name === 'string' && file.name && typeof file.bytes === 'number' && file.bytes >= 0 && typeof file.mime === 'string' && file.mime) {
            out.push({ id: file.id, name: file.name, bytes: file.bytes, mime: file.mime });
        }
    }
    return out;
}

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
    const origin = report.origin as { kind?: unknown; ref?: unknown } | null | undefined;
    const kind = report.kind as ReportKind;
    const seq = typeof report.seq === 'number' ? report.seq : null;
    // A wait is told by its number: without one it could not be marked as told for that wait only
    if (kind === 'needs' && (seq === null || waiting(report.waitingFor) === null)) return null;
    return {
        key: report.key,
        jobId: report.jobId,
        botId: report.botId,
        matrixUserId: typeof report.matrixUserId === 'string' && report.matrixUserId ? report.matrixUserId : null,
        origin: origin && origin.kind === 'dm' && typeof origin.ref === 'string' && origin.ref ? { kind: 'dm', ref: origin.ref } : null,
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
        handed: handedOf(report.handed),
        givenBack: report.givenBack === true,
        refundPendingMicros: typeof report.refundPendingMicros === 'number' && Number.isFinite(report.refundPendingMicros) && report.refundPendingMicros > 0 ? Math.round(report.refundPendingMicros) : 0,
    };
}

/**
 * Money as the person reads it, exactly as Orbit's `dollars()` says it (the game's Usage page says it the same way): "$0", "less than $0.001"
 * under half a thousandth, thousandths of a dollar under a cent (`$0.009`), cents from a cent up (`$0.05`, `$2.50`).
 */
export function moneyText(micros: number): string {
    if (!(micros > 0)) return '$0';
    if (micros < 500) return 'less than $0.001';
    if (micros < 10_000) return `$${(micros / 1_000_000).toFixed(3)}`;
    return `$${(micros / 1_000_000).toFixed(2)}`;
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
export function receiptOf(report: Pick<ComputerReport, 'effects' | 'writes'> & { refundPendingMicros?: number }, quiet: 'ended' | 'waiting' = 'ended'): string {
    const said = receiptWords(report, quiet);
    // A refund Orbit has promised and not paid is said as pending, after what the record proves: it is not said as given back
    return report.refundPendingMicros && report.refundPendingMicros > 0 ? `${said} ${moneyText(report.refundPendingMicros)} refund pending.` : said;
}

function receiptWords(report: Pick<ComputerReport, 'effects' | 'writes'>, quiet: 'ended' | 'waiting'): string {
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
            // What it made is said to be on its way, never that it is attached: the file card is the proof, and what could not go is said after, in its own message
            const attached = report.handed.length > 0 ? ` It made ${list(report.handed.map((file) => file.name))}, and I'm sending ${report.handed.length === 1 ? 'it' : 'them'} below.` : '';
            const saved = report.files.length > 0 ? ` ${report.handed.length > 0 ? 'It also saved' : 'It saved'} ${list(report.files.slice(0, 3))}${report.files.length > 3 ? ` and ${report.files.length - 3} more` : ''} on its computer.` : '';
            return `${name} is done. ${receiptOf(report)}${attached}${saved}`;
        }
        case 'needs': {
            const next = NEEDS_NEXT[report.waitingFor ?? 'answer'];
            const ready =
                report.waitingFor === 'details' && report.ready && !report.effects.some((effect) => effect.kind === 'details' && (effect.state === 'done' || effect.state === 'unknown'))
                    ? ` I'm ready to put in ${report.ready.what.trim().replace(/[.!?]+$/, '')} at ${report.ready.where.trim().replace(/[.!?]+$/, '')}, and nothing of yours has reached it yet.`
                    : '';
            // Paying and submitting are the person's: they are told, from the record, that nothing has gone yet (or what has)
            const so = report.effects.length > 0 || report.waitingFor === 'pay' || report.waitingFor === 'submit' ? ` ${receiptOf(report, 'waiting')}` : '';
            return `${name} needs you.${ready}${so} ${next}`;
        }
        case 'failed': {
            const why = report.why ? ` ${capital(sentence(report.why))}` : '';
            // A refund that is still pending is said in the receipt as pending: the try is not said to be given back until it is
            const back = report.givenBack && report.refundPendingMicros <= 0 ? " This try won't count against your month." : '';
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
    /** Orbit is told it reached the chat. False when Orbit did not take it: it is offered again and said again as the same message. */
    keepTold(report: Pick<ComputerReport, 'jobId' | 'kind' | 'seq'>): Promise<boolean>;
    /** Orbit is told it can never reach the chat, and why: it is not offered again and is not "told"; what the job made stays in Files. False when Orbit did not take it. */
    keepUndeliverable(report: Pick<ComputerReport, 'jobId' | 'kind' | 'seq'>, why: UndeliverableWhy): Promise<boolean>;
    /** Orbit is told this file is in the chat, so a restart never sends it again and Files shows it as delivered. False when Orbit did not take it. */
    keepFileDelivered(jobId: string, fileId: string): Promise<boolean>;
    /** The bytes of one handed-over file, or null when Orbit no longer has it. Throws when Orbit cannot be asked (it is asked again). */
    file(jobId: string, fileId: string): Promise<Buffer | null>;
}

/** A file to put in the chat as a card. Its bytes are fetched only when it is its turn, so a report with several never holds them all at once. */
export interface AttachedFile {
    id: string;
    name: string;
    mime: string;
    bytes: number;
    load(): Promise<Buffer | null>;
    /** Said the moment the file is in the chat. */
    delivered(): Promise<void>;
}

/** What happened to the files of one message: the ones in the chat, and the ones that did not go (`again`: it may go on a later try; `gone`: Orbit no longer keeps it). */
export interface FilesAnswer {
    attached: string[];
    missed: { id: string; name: string; again: boolean; gone?: boolean }[];
}

/** Why a report can never reach the chat (the words Orbit keeps). `refused`: the chat server turned the message down for good. */
export type UndeliverableWhy = 'no_chat' | 'not_allowed' | 'origin_gone' | 'refused';

/** What saying something came to: in the chat, not yet (try again), or never (and why). */
export type ComputerSpoke = { ok: true; eventId: string; files?: FilesAnswer } | { ok: false; reason: UndeliverableWhy | 'unsure' };

/** Says something in a person's own chat with a Brick; `steps` puts a "Worked on its computer" line above it, `files` follow it as file cards. */
export interface ComputerSpeaker {
    say(
        brickId: string,
        matrixUserId: string,
        text: string,
        transactionId: string,
        extra?: { steps?: { field: StepsField; text: string }; files?: AttachedFile[]; room?: string }
    ): Promise<ComputerSpoke>;
}

/** How many times a file that keeps failing to reach the chat is tried before it is given up on (the message says it did not go). Each try is a round, 10 seconds apart. */
export const FILE_TRIES = 6;

/** Said once for the files that did not go: where each one is (in Files, unless Orbit no longer has it). */
export function missedText(files: { name: string; gone?: boolean }[]): string {
    const kept = files.filter((file) => !file.gone).map((file) => file.name);
    const lost = files.filter((file) => file.gone).map((file) => file.name);
    const parts: string[] = [];
    if (kept.length > 0) parts.push(`I couldn't attach ${list(kept)} here. ${kept.length === 1 ? "It's" : "They're"} saved in your Files.`);
    if (lost.length > 0) parts.push(`I can't attach ${list(lost)}: ${lost.length === 1 ? 'it is' : 'they are'} no longer kept.`);
    return parts.join(' ');
}

export class ComputerReports {
    private running = false;
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;
    /** Files of a report already in the chat, and how many rounds a report's files have failed: only so a retry does the rest and gives up in the end. */
    private readonly attached = new Map<string, Set<string>>();
    private readonly failedRounds = new Map<string, number>();
    /** Files of a report that were given up on and said so in the chat (they are in Files): never tried again on a later round, so a card never follows the words "I couldn't attach it". */
    private readonly givenUp = new Map<string, Set<string>>();
    /** How many rounds Orbit did not take a file's "delivered" mark for a report: bounded, like the rounds of files that could not go. */
    private readonly unmarkedRounds = new Map<string, number>();

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

    /** True when it went out. One that can never go is told to Orbit as undeliverable, with why (never as told); one that could not go just now is left for the next round. */
    private async sayOne(report: ComputerReport): Promise<boolean> {
        if (!report.matrixUserId) return this.letGo(report, 'no_chat');
        const sent = this.attached.get(report.key) ?? new Set<string>();
        const files: AttachedFile[] =
            report.kind === 'done'
                ? report.handed
                      .filter((file) => !sent.has(file.id) && !this.givenUp.get(report.key)?.has(file.id))
                      .map((file) => ({ ...file, load: () => this.api.file(report.jobId, file.id), delivered: async () => void (await this.api.keepFileDelivered(report.jobId, file.id)) }))
                : [];
        const spoke = await this.speaker.say(report.botId, report.matrixUserId, reportText(report), report.key, {
            // Back to the conversation the job began in: never a chat made or picked for it
            ...(report.origin ? { room: report.origin.ref } : {}),
            ...(report.kind === 'done' ? { steps: workedLine(report), ...(files.length > 0 ? { files } : {}) } : {}),
        });
        if ('eventId' in spoke) {
            for (const id of spoke.files?.attached ?? []) sent.add(id);
            this.attached.set(report.key, sent);
            const missed = spoke.files?.missed ?? [];
            // A file that could not go just now (the chat or Orbit did not answer) is tried again on the next round, a few times; the message and the files already in the chat are the same events
            const rounds = (this.failedRounds.get(report.key) ?? 0) + (missed.some((file) => file.again) ? 1 : 0);
            if (missed.some((file) => file.again) && rounds < FILE_TRIES) {
                this.failedRounds.set(report.key, rounds);
                return false;
            }
            if (missed.length > 0) {
                // Said once, as its own message, so nobody waits for a card that will not come: the file is in Files
                const noted = await this.speaker.say(report.botId, report.matrixUserId, missedText(missed), `${report.key}:missed`, report.origin ? { room: report.origin.ref } : undefined);
                if (!('eventId' in noted) && noted.reason === 'unsure') return false;
                // It is said: these files are not tried again, even when the report stays open for a mark Orbit has not taken yet
                const given = this.givenUp.get(report.key) ?? new Set<string>();
                for (const file of missed) given.add(file.id);
                this.givenUp.set(report.key, given);
            }
            // Orbit may have missed a file's own mark (it is said again, and is safe to say twice): Files must not show a file in the chat as not delivered
            // A mark Orbit did not take keeps the report open: the files already in the chat are remembered in `sent` and are not sent again, only the mark is made again next round,
            // and the report is not "told" while a file in the chat still shows as not delivered
            let unmarked = 0;
            for (const id of sent) if (!(await this.api.keepFileDelivered(report.jobId, id))) unmarked += 1;
            if (unmarked > 0) {
                // Never told while a file in the chat still shows as not delivered: telling it would make Orbit stop offering the report, and Files would keep saying "not delivered"
                // for good. Only the mark is made again, every round, until Orbit takes it (a file Orbit no longer holds counts as marked), and nothing is sent twice
                const tries = (this.unmarkedRounds.get(report.key) ?? 0) + 1;
                this.unmarkedRounds.set(report.key, tries);
                // Said on the first round and then every FILE_TRIES rounds, so an Orbit that stays down does not fill the log
                if (tries === 1 || tries % FILE_TRIES === 0) {
                    this.log.warn(`[ComputerReports] Orbit did not keep that ${unmarked} file(s) of job ${report.jobId} reached the chat (round ${tries}); the mark is made again next round, nothing is sent twice`);
                }
                return false;
            }
            this.unmarkedRounds.delete(report.key);
            this.attached.delete(report.key);
            this.failedRounds.delete(report.key);
            this.givenUp.delete(report.key);
            if (!(await this.api.keepTold(report))) this.log.warn(`[ComputerReports] Orbit did not keep that job ${report.jobId} (${report.kind}) was told; it goes out again as the same message`);
            return true;
        }
        if (spoke.reason === 'unsure') return false;
        return this.letGo(report, spoke.reason);
    }

    /** It can never reach the chat: Orbit is told so, and why. It is not "told", and the result stays with the person in Files. Always false (nothing was said). */
    private async letGo(report: ComputerReport, why: UndeliverableWhy): Promise<false> {
        this.log.warn(`[ComputerReports] Job ${report.jobId} (${report.kind}) cannot be told in chat (${why}); kept as undelivered, its result stays in Files`);
        await this.api.keepUndeliverable(report, why);
        this.attached.delete(report.key);
        this.failedRounds.delete(report.key);
        this.givenUp.delete(report.key);
        this.unmarkedRounds.delete(report.key);
        return false;
    }
}
