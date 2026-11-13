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
 * Only reminders run here so far; the other kinds wait for the parts that run them (watches, briefings and goals use a model).
 */

/** A run Orbit handed out, as far as this part needs it (POST /api/bricks/items/due). */
export interface DueRun {
    runId: string;
    itemId: string;
    brickId: string;
    userId: string;
    /** The owner's chat (Matrix) id; null when they have none, and then nothing can be said. */
    chatId: string | null;
    kind: 'reminder' | 'schedule' | 'watch' | 'goal';
    words: string;
    timeZone: string;
    dueAt: string;
    /** A run that came after an outage: it says when it was due. */
    late: boolean;
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
}

/** What this part asks of Orbit. */
export interface BrickRunnerApi {
    /** The runs that fell due; throws when Orbit cannot be asked (nothing is lost: they are handed out again). */
    claimDue(): Promise<DueRun[]>;
    checkRun(runId: string, attempt: number): Promise<RunCheck>;
    /** Keeps the chat event the run's message got. Returns whether Orbit kept it. */
    keepDelivered(runId: string, eventId: string): Promise<boolean>;
    report(runId: string, report: RunReport): Promise<boolean>;
}

export type SpokeAnswer = { ok: true; eventId: string } | { ok: false; reason: 'no_chat' | 'not_allowed' | 'failed' };

/** Says something in a person's own chat with a Brick. */
export interface BrickSpeaker {
    say(brickId: string, chatId: string, text: string, transactionId: string): Promise<SpokeAnswer>;
}

/** One run of Orbit's answer, kept only when it has what a run needs. */
export function dueRunOf(raw: unknown): DueRun | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const run = raw as Record<string, unknown>;
    const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
    const kinds = ['reminder', 'schedule', 'watch', 'goal'];
    if (!text(run.runId) || !text(run.itemId) || !text(run.brickId) || !text(run.userId) || !text(run.words) || !text(run.timeZone) || !text(run.dueAt)) return null;
    if (typeof run.kind !== 'string' || !kinds.includes(run.kind) || typeof run.attempt !== 'number') return null;
    return {
        runId: run.runId,
        itemId: run.itemId,
        brickId: run.brickId,
        userId: run.userId,
        chatId: typeof run.chatId === 'string' && run.chatId ? run.chatId : null,
        kind: run.kind as DueRun['kind'],
        words: run.words,
        timeZone: run.timeZone,
        dueAt: run.dueAt,
        late: run.late === true,
        attempt: run.attempt,
        deliveredEventId: typeof run.deliveredEventId === 'string' && run.deliveredEventId ? run.deliveredEventId : null,
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

const FAILED_WORDS: Record<'no_chat' | 'not_allowed' | 'failed', string> = {
    no_chat: 'The person has no chat with this Brick to say it in',
    not_allowed: 'The person may not message this Brick now',
    failed: 'The message did not go out',
};

export class BrickRunner {
    private running = false;
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;

    constructor(
        private readonly api: BrickRunnerApi,
        private readonly speaker: BrickSpeaker,
        private readonly log: Pick<Console, 'warn'> = console
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

    /** One round: claim what is due and run it. Safe to call twice at once: the second does nothing. */
    async tick(): Promise<number> {
        if (this.running) return 0;
        this.running = true;
        try {
            let runs: DueRun[];
            try {
                runs = await this.api.claimDue();
            } catch (error) {
                this.log.warn('[BrickRunner] Could not ask Orbit what is due:', error instanceof Error ? error.message : error);
                return 0;
            }
            let handled = 0;
            for (const run of runs) {
                if (this.stopped) break;
                try {
                    if (await this.runOne(run)) handled += 1;
                } catch (error) {
                    // One run that breaks never stops the ones behind it; Orbit hands it out again when its lease is over
                    this.log.warn(`[BrickRunner] A run (${run.runId}) did not finish:`, error instanceof Error ? error.message : error);
                }
            }
            return handled;
        } finally {
            this.running = false;
        }
    }

    /** Returns whether the run was dealt with here (said and reported, or reported as failed). */
    private async runOne(run: DueRun): Promise<boolean> {
        if (run.kind !== 'reminder') {
            // Watches, briefings and goals need a model: they run in the part that has one. Left alone, never reported as failed
            return false;
        }
        const text = reminderText(run);
        let eventId = run.deliveredEventId;
        if (!eventId) {
            // The run may have been paused, finished, deleted or changed since it was claimed, or its Brick switched off or deleted
            const check = await this.api.checkRun(run.runId, run.attempt);
            if (!check.ok) return false;
            if (!run.chatId) return this.fail(run, 'no_chat');
            const spoke = await this.speaker.say(run.brickId, run.chatId, text, transactionIdOfRun(run.runId));
            if (!('eventId' in spoke)) return this.fail(run, spoke.reason);
            eventId = spoke.eventId;
            // Right after the send and before the report; a crash between the two leaves the same transaction id to say it again as one message
            if (!(await this.api.keepDelivered(run.runId, eventId))) {
                this.log.warn(`[BrickRunner] Orbit did not keep where run ${run.runId} spoke; it is reported all the same`);
            }
        }
        await this.api.report(run.runId, { attempt: run.attempt, state: 'done', outcome: 'spoke', result: text.slice(0, RESULT_MAX) });
        return true;
    }

    private async fail(run: DueRun, reason: 'no_chat' | 'not_allowed' | 'failed'): Promise<boolean> {
        // A reminder that fails tells its person on the first failure; when the chat itself is what failed there is no way to tell them
        // here, so Orbit is not told it was told (it asks again at the next failure) and "Everything Brick did" shows it at once
        await this.api.report(run.runId, { attempt: run.attempt, state: 'failed', error: FAILED_WORDS[reason].slice(0, ERROR_MAX) });
        return true;
    }
}
