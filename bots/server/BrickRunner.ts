/**
 * Goals and tasks, the bot server's part (game #2002): Orbit is the only scheduler, and this is what runs what it hands out.
 *
 * Every minute or so Orbit is asked for the runs that fell due (one run for each due time, claimed in its database, so two bot
 * servers or a retry never share one). A reminder is fixed text with no model: it is said once in its owner's own chat with their
 * Brick, and then reported. Nothing here starts a run on its own, and no timer of any provider does.
 *
 * Said once, however often a run is handed out again:
 *  - the message goes with the run's own id as its Matrix transaction id, so a second try of the same run is the same message to
 *    Matrix (it answers with the event it already made);
 *  - the event id it got back is kept in Orbit right after the send; a run handed out again that carries one is not sent again.
 *  - before the send, Orbit is asked whether the run may still go on (paused, finished, deleted or changed means it may not).
 * Never claimed as exactly once outside Universe.
 *
 * Only reminders run here so far; the other kinds wait for the parts that run them (watches, briefings and goals use a model). The due
 * call asks only for the kinds run here (RUNNABLE_KINDS), so Orbit never hands out, and never burns tries of, a run nothing here will try.
 */

import type { TaskResult } from './BrickTaskRun';

/** A run Orbit handed out, as far as this part needs it (POST /api/bricks/items/due). */
export interface DueRun {
    runId: string;
    itemId: string;
    brickId: string;
    userId: string;
    /** The owner's Matrix user id (like @uuid:domain), the person Brick speaks to; null when they have none, and then nothing can be said. */
    matrixUserId: string | null;
    kind: 'reminder' | 'schedule' | 'watch' | 'goal';
    words: string;
    /** A watch: what it speaks for. A goal: the outcome the person named, its steps so far and its last status line. */
    condition: string | null;
    outcome: string | null;
    steps: { text: string; state: 'todo' | 'doing' | 'done' }[];
    statusLine: string | null;
    timeZone: string;
    dueAt: string;
    /** A run that came after an outage: it says when it was due. */
    late: boolean;
    /** A watch or goal that was away for a while: one fresh check now, never a catch-up. */
    fresh: boolean;
    attempt: number;
    deliveredEventId: string | null;
}

export type RunCheck = { ok: true } | { ok: false; reason: string };

export interface RunReport {
    attempt: number;
    state: 'done' | 'failed';
    outcome?: 'quiet' | 'spoke' | 'waiting';
    result?: string;
    error?: string;
    /** A goal's progress after this run. */
    progress?: { statusLine?: string | null; steps?: { text: string; state: 'todo' | 'doing' | 'done' }[]; waitingFor?: string | null };
    /** A goal that reached the outcome the person named; the evidence is in `result`. */
    reached?: boolean;
}

/** What Orbit answered to a report: whether the person is to be told of a row of failures. */
export interface ReportAnswer {
    tellPerson: boolean;
}

/** A goal or task that waits because its owner's usage for goals and tasks is used up: said once per wait. */
export interface HeldNotice {
    itemId: string;
    brickId: string;
    userId: string;
    matrixUserId: string | null;
    kind: DueRun['kind'];
    words: string;
    resumesAt: string;
    timeZone: string | null;
    waitId: string;
}

/** What this part asks of Orbit. */
export interface BrickRunnerApi {
    /** The runs that fell due, and the goals and tasks that wait for usage; throws when Orbit cannot be asked (nothing is lost: they are handed out again). */
    claimDue(kinds: readonly DueRun['kind'][]): Promise<{ runs: DueRun[]; held: HeldNotice[] }>;
    checkRun(runId: string, attempt: number): Promise<RunCheck>;
    /** Keeps the chat event the run's message got. Returns whether Orbit kept it. */
    keepDelivered(runId: string, eventId: string): Promise<boolean>;
    /** Null when Orbit did not record it. */
    report(runId: string, report: RunReport): Promise<ReportAnswer | null>;
    /** The person was told about a row of failures (the report said so). Only after it went out. */
    keepTold(runId: string): Promise<boolean>;
    /** The person was told their goal or task waits for usage. Only after it went out. */
    keepHeldTold(itemId: string, waitId: string): Promise<boolean>;
}

/** Runs a watch, a briefing or a goal on a model (game #2002); see BrickTaskModel in the bot server. */
export interface BrickTaskModel {
    run(run: DueRun, permit: () => Promise<boolean>): Promise<TaskOutcome>;
}

/** How a run on a model ended. `stopped` and `unsure` leave it unreported: it was changed meanwhile, or a blip says nothing (the lease hands it out again). */
export type TaskOutcome = { kind: 'result'; result: TaskResult } | { kind: 'stopped' } | { kind: 'unsure' } | { kind: 'failed'; error: string };

/**
 * What came of saying it. `no_chat` and `not_allowed` are certain answers that will not fix themselves; `unsure` is "could not tell"
 * (a lookup or Orbit's access check failed, the send threw), which a later try may settle, so it is never reported as a failure.
 */
export type SpokeAnswer = { ok: true; eventId: string } | { ok: false; reason: 'no_chat' | 'not_allowed' | 'unsure' };

/** Says something in a person's own chat with a Brick. */
export interface BrickSpeaker {
    say(brickId: string, matrixUserId: string, text: string, transactionId: string): Promise<SpokeAnswer>;
}

/** The kinds of run this server can run, asked of Orbit's due list so it never hands out (and burns) what nothing here will try. Without a model, only reminders. */
export const RUNNABLE_KINDS: readonly DueRun['kind'][] = ['reminder'];
export const MODEL_KINDS: readonly DueRun['kind'][] = ['reminder', 'schedule', 'watch', 'goal'];

/** One run of Orbit's answer, kept only when it has what a run needs. */
export function dueRunOf(raw: unknown): DueRun | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const run = raw as Record<string, unknown>;
    const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
    const kinds = ['reminder', 'schedule', 'watch', 'goal'];
    if (!text(run.runId) || !text(run.itemId) || !text(run.brickId) || !text(run.userId) || !text(run.words) || !text(run.timeZone) || !text(run.dueAt)) return null;
    if (typeof run.kind !== 'string' || !kinds.includes(run.kind) || typeof run.attempt !== 'number') return null;
    const steps: DueRun['steps'] = [];
    if (Array.isArray(run.steps)) {
        for (const one of run.steps) {
            const step = one as { text?: unknown; state?: unknown } | null;
            if (typeof step?.text === 'string' && step.text && (step.state === 'todo' || step.state === 'doing' || step.state === 'done')) steps.push({ text: step.text, state: step.state });
        }
    }
    return {
        runId: run.runId,
        itemId: run.itemId,
        brickId: run.brickId,
        userId: run.userId,
        matrixUserId: typeof run.matrixUserId === 'string' && run.matrixUserId ? run.matrixUserId : null,
        kind: run.kind as DueRun['kind'],
        words: run.words,
        condition: typeof run.condition === 'string' && run.condition ? run.condition : null,
        outcome: typeof run.outcome === 'string' && run.outcome ? run.outcome : null,
        steps,
        statusLine: typeof run.statusLine === 'string' && run.statusLine ? run.statusLine : null,
        timeZone: run.timeZone,
        dueAt: run.dueAt,
        late: run.late === true,
        fresh: run.fresh === true,
        attempt: run.attempt,
        deliveredEventId: typeof run.deliveredEventId === 'string' && run.deliveredEventId ? run.deliveredEventId : null,
    };
}

/** One held notice of Orbit's answer, kept only when it has what saying it needs. */
export function heldNoticeOf(raw: unknown): HeldNotice | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const one = raw as Record<string, unknown>;
    const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
    if (!text(one.itemId) || !text(one.brickId) || !text(one.userId) || !text(one.words) || !text(one.resumesAt) || !text(one.waitId)) return null;
    if (one.kind !== 'reminder' && one.kind !== 'schedule' && one.kind !== 'watch' && one.kind !== 'goal') return null;
    return {
        itemId: one.itemId,
        brickId: one.brickId,
        userId: one.userId,
        matrixUserId: typeof one.matrixUserId === 'string' && one.matrixUserId ? one.matrixUserId : null,
        kind: one.kind,
        words: one.words,
        resumesAt: one.resumesAt,
        timeZone: typeof one.timeZone === 'string' && one.timeZone ? one.timeZone : null,
        waitId: one.waitId,
    };
}

/** The words of a reminder: its fixed text, and when it was due if it came late. Never a model's words. */
export function reminderText(run: Pick<DueRun, 'words' | 'late' | 'dueAt' | 'timeZone'>): string {
    const words = run.words.trim();
    if (!run.late) return `Reminder: ${words}`;
    return `Late (due ${clockTime(run.dueAt, run.timeZone)}): ${words}`;
}

function clockTime(iso: string, timeZone: string): string {
    const at = new Date(iso);
    try {
        return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(at);
    } catch {
        // A zone this server does not know: still said, in UTC, rather than not said
        return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(at) + ' UTC';
    }
}

/** The Matrix transaction id of a run's message: the same on every try of the run. */
export const transactionIdOfRun = (runId: string) => `brick-run:${runId}`;

const RESULT_MAX = 1000;
const ERROR_MAX = 300;
/** Runs on a model at once on this server (a model call takes a while, and a reminder never waits behind them). Infrastructure, not a product limit. */
const MODEL_RUNS_AT_ONCE = 3;

const FAILED_WORDS: Record<'no_chat' | 'not_allowed', string> = {
    no_chat: 'Brick could not find its chat with the person to say it in',
    not_allowed: 'The person may not message this Brick now',
};

/** A goal or task that waits for usage, said once: the check waits, nothing is lost, and when it carries on. */
export function heldText(notice: Pick<HeldNotice, 'words' | 'resumesAt' | 'timeZone'>): string {
    return `"${notice.words.trim()}" has to wait: goals and tasks have used their part of your usage for now. Nothing is lost, and it carries on at ${clockTime(notice.resumesAt, notice.timeZone ?? 'UTC')}. You can still chat with me as usual.`;
}

/** A run that did not work, said once to the person (Orbit says when): what it was, and why. */
export function failedText(run: Pick<DueRun, 'words'>, error: string): string {
    return `I couldn't do "${run.words.trim()}": ${error.trim().replace(/[.!?]+$/, '')}. I'll try again at the next time, or ask me any time.`;
}

export const transactionIdOfTold = (runId: string) => `brick-told:${runId}`;
export const transactionIdOfHeld = (itemId: string, waitId: string) => `brick-held:${itemId}:${waitId}`;

export class BrickRunner {
    private running = false;
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;
    /** Runs on a model that this server has in hand (Orbit may hand one out again while it is still being worked on: it is then left to the first). */
    private readonly inFlight = new Set<string>();
    private readonly modelRuns = new Set<Promise<void>>();
    private activeModelRuns = 0;
    private readonly waitingForSlot: Array<() => void> = [];

    constructor(
        private readonly api: BrickRunnerApi,
        private readonly speaker: BrickSpeaker,
        private readonly log: Pick<Console, 'warn'> = console,
        /** Runs watches, briefings and goals. Without it this server runs reminders only, and asks Orbit for nothing else. */
        private readonly model?: BrickTaskModel
    ) {}

    /** Asks Orbit every `everyMs` (nothing depends on exactly when). One after another: a slow try never overlaps the next. */
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

    /** Resolves when every run on a model that was started has ended (for a shutdown, and for tests). */
    async idle(): Promise<void> {
        while (this.modelRuns.size > 0) await Promise.allSettled([...this.modelRuns]);
    }

    /**
     * One round: claim what is due, run the reminders now, say what waits for usage, and set the runs on a model going (they do not hold the
     * round: a reminder in the next round never waits behind a model). Safe to call twice at once: the second does nothing.
     */
    async tick(): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            let work: { runs: DueRun[]; held: HeldNotice[] };
            try {
                work = await this.api.claimDue(this.model ? MODEL_KINDS : RUNNABLE_KINDS);
            } catch (error) {
                this.log.warn('[BrickRunner] Could not ask Orbit what is due:', error instanceof Error ? error.message : error);
                return 0;
            }
            let handled = 0;
            // Reminders first: fixed text, no model, and the one thing that is on time to the minute
            const ordered = [...work.runs].sort((a, b) => Number(b.kind === 'reminder') - Number(a.kind === 'reminder'));
            for (const run of ordered) {
                if (this.stopped) break;
                if (run.kind !== 'reminder') {
                    if (this.model) this.startModelRun(run);
                    // Without a model they are never asked for; one that arrives anyway is left alone, never reported as failed
                    continue;
                }
                try {
                    if (await this.runOne(run)) handled += 1;
                } catch (error) {
                    // One run that breaks never stops the ones behind it; Orbit hands it out again when its lease is over
                    this.log.warn(`[BrickRunner] A run (${run.runId}) did not finish:`, error instanceof Error ? error.message : error);
                }
            }
            for (const notice of work.held) {
                if (this.stopped) break;
                try {
                    await this.sayHeld(notice);
                } catch (error) {
                    this.log.warn(`[BrickRunner] Could not say that ${notice.itemId} waits:`, error instanceof Error ? error.message : error);
                }
            }
            return handled;
        } finally {
            this.running = false;
        }
    }

    // --- a reminder: fixed text ---------------------------------------------------------------------------------------------------------

    /** Returns whether the run was dealt with here (said and reported, or reported as failed). */
    private async runOne(run: DueRun): Promise<boolean> {
        const text = reminderText(run);
        let eventId = run.deliveredEventId;
        if (!eventId) {
            // The run may have been paused, finished, deleted or changed since it was claimed, or its Brick switched off or deleted
            const check = await this.api.checkRun(run.runId, run.attempt);
            if (!check.ok) return false;
            const said = await this.say(run, text, transactionIdOfRun(run.runId));
            if (said === 'left') return false;
            if (said === 'failed') return true;
            eventId = said;
        }
        await this.api.report(run.runId, { attempt: run.attempt, state: 'done', outcome: 'spoke', result: text.slice(0, RESULT_MAX) });
        return true;
    }

    /**
     * Says it in the owner's own chat under the run's own transaction id and keeps where it went. 'left' when it could not be told whether it
     * could be said (nothing is reported: the lease hands the run out again, and the same transaction id keeps it one message), 'failed' when
     * it never can be (reported failed), else the event id.
     */
    private async say(run: DueRun, text: string, transactionId: string, keep = true): Promise<string> {
        if (!run.matrixUserId) return this.fail(run, 'no_chat').then(() => 'failed');
        const spoke = await this.speaker.say(run.brickId, run.matrixUserId, text, transactionId);
        if ('eventId' in spoke) {
            // Right after the send and before the report; a crash between the two leaves the same transaction id to say it again as one message
            if (keep && !(await this.api.keepDelivered(run.runId, spoke.eventId))) {
                this.log.warn(`[BrickRunner] Orbit did not keep where run ${run.runId} spoke; it is reported all the same`);
            }
            return spoke.eventId;
        }
        if (spoke.reason === 'unsure') {
            this.log.warn(`[BrickRunner] Could not tell whether run ${run.runId} could be said just now; it is tried again when its lease is over`);
            return 'left';
        }
        await this.fail(run, spoke.reason);
        return 'failed';
    }

    private async fail(run: DueRun, reason: 'no_chat' | 'not_allowed'): Promise<boolean> {
        // A run that fails tells its person (Orbit says when); when the chat itself is what failed there is no way to tell them here, so
        // Orbit is not told it was told (it asks again at the next failure) and "Everything Brick did" shows it at once
        await this.api.report(run.runId, { attempt: run.attempt, state: 'failed', error: FAILED_WORDS[reason].slice(0, ERROR_MAX) });
        return true;
    }

    // --- a watch, a briefing or a goal: on a model ---------------------------------------------------------------------------------------

    private startModelRun(run: DueRun): void {
        // Handed out again while the first try is still at work: that one goes on, and this one is left alone
        if (this.inFlight.has(run.runId)) return;
        this.inFlight.add(run.runId);
        const work = (async () => {
            await this.waitForSlot();
            try {
                if (!this.stopped) await this.runWithModel(run);
            } catch (error) {
                this.log.warn(`[BrickRunner] A run (${run.runId}) did not finish:`, error instanceof Error ? error.message : error);
            } finally {
                this.releaseSlot();
                this.inFlight.delete(run.runId);
            }
        })();
        this.modelRuns.add(work);
        void work.finally(() => this.modelRuns.delete(work));
    }

    private async waitForSlot(): Promise<void> {
        if (this.activeModelRuns < MODEL_RUNS_AT_ONCE) {
            this.activeModelRuns += 1;
            return;
        }
        await new Promise<void>((resolve) => this.waitingForSlot.push(resolve));
    }

    private releaseSlot(): void {
        const next = this.waitingForSlot.shift();
        // The slot goes straight to the next one waiting
        if (next) next();
        else this.activeModelRuns -= 1;
    }

    private async runWithModel(run: DueRun): Promise<void> {
        if (!this.model) return;
        // Said before and handed out again: it is not said (or run) a second time
        if (run.deliveredEventId) {
            await this.api.report(run.runId, { attempt: run.attempt, state: 'done', outcome: 'spoke', result: 'Said in chat' });
            return;
        }
        // Whether the run may still go on: asked before the model starts, before each of its calls and tools, and before it speaks. A blip
        // in the asking says nothing, so it is treated as "not now" and the run is left unreported for its lease to hand out again.
        const permit = async (): Promise<boolean> => {
            try {
                return (await this.api.checkRun(run.runId, run.attempt)).ok;
            } catch {
                return false;
            }
        };
        if (!(await permit())) return;
        const outcome = await this.model.run(run, permit);
        if (outcome.kind === 'stopped' || outcome.kind === 'unsure') return;
        if (outcome.kind === 'failed') {
            await this.reportFailure(run, outcome.error);
            return;
        }
        const result = outcome.result;
        if (result.kind === 'cannot') {
            await this.reportFailure(run, result.reason);
            return;
        }
        if (result.kind === 'nothing_new') {
            await this.api.report(run.runId, { attempt: run.attempt, state: 'done', outcome: 'quiet', result: (result.progress.statusLine ?? 'Nothing new').slice(0, RESULT_MAX), ...(Object.keys(result.progress).length > 0 ? { progress: result.progress } : {}) });
            return;
        }
        // Something to say: nothing goes out for a run that was changed while the model worked
        if (!(await permit())) return;
        const said = await this.say(run, result.message, transactionIdOfRun(run.runId));
        if (said === 'left' || said === 'failed') return;
        const reached = result.kind === 'reached';
        await this.api.report(run.runId, {
            attempt: run.attempt,
            state: 'done',
            outcome: !reached && result.needsYou ? 'waiting' : 'spoke',
            // A goal that reached its outcome says what shows it; anything else, what was said
            result: (reached ? result.evidence : result.message).slice(0, RESULT_MAX),
            ...(reached ? { reached: true } : {}),
            ...(Object.keys(result.progress).length > 0 ? { progress: result.progress } : {}),
        });
    }

    /** A run that did not work: reported at once, and told to the person once when Orbit says so (it keeps the count). */
    private async reportFailure(run: DueRun, error: string): Promise<void> {
        const answer = await this.api.report(run.runId, { attempt: run.attempt, state: 'failed', error: error.slice(0, ERROR_MAX) });
        if (!answer?.tellPerson || !run.matrixUserId) return;
        const spoke = await this.speaker.say(run.brickId, run.matrixUserId, failedText(run, error), transactionIdOfTold(run.runId));
        // Kept as told only after it went out: a tell that did not is asked for again with the next failure
        if ('eventId' in spoke) await this.api.keepTold(run.runId);
    }

    // --- what waits for usage ---------------------------------------------------------------------------------------------------------------

    /** Said once for each wait; confirmed to Orbit only after it went out, so a lost answer is handed out again and a confirmed one never is. */
    private async sayHeld(notice: HeldNotice): Promise<void> {
        if (!notice.matrixUserId) return;
        const spoke = await this.speaker.say(notice.brickId, notice.matrixUserId, heldText(notice), transactionIdOfHeld(notice.itemId, notice.waitId));
        if ('eventId' in spoke) await this.api.keepHeldTold(notice.itemId, notice.waitId);
    }
}
