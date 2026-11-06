/**
 * A bot's daily listening limit (#1859, Orbit #740): "minutes a day one bot listens for its name, all the people near it together".
 *
 * With several people in a bubble the worker sends everyone's microphone to the listening provider, but only what is said to the bot
 * is for it (see `VoiceCalls.hears`). The rest is group chatter that costs the key that pays for hearing and fills the provider's
 * live-stream limit. Orbit keeps each bot's seconds of that per day; this reports them and learns when the day's minutes are used.
 * Once they are, `VoiceCalls` stops taking the microphones of a group until the next day: the bot still answers typed lines and still
 * speaks, and a person alone with it is not affected (everything they say is for it). A spent budget is text, never a hard stop.
 *
 * Nothing here can stop a bot by accident: an Orbit that can't be asked, or an Orbit from before this, leaves the bot listening.
 */

/** What the bot server asks of Orbit. `AdminApiService` is the real one; tests give a fake. */
export interface ListeningOrbit {
    /** Adds seconds to the bot's day (0 only asks). Null when Orbit can't be asked or doesn't know the question. */
    reportVoiceListening(botId: string, input: { seconds: number }): Promise<{ spent: boolean; usedSeconds: number; limitSeconds: number; resetsAt: string } | null>;
}

/** Group chatter is reported once this much has gathered, or after FLUSH_AFTER_MS, whichever is first: one call per turn would be a call per sentence. */
const FLUSH_AT_MS = 15_000;
const FLUSH_AFTER_MS = 10_000;
/** What is kept to report again after a report that could not be made. More than this is dropped. */
const MAX_PENDING_MS = 10 * 60_000;
/** After a report that could not be made, the next try waits this long, then twice as long each time, to at most the cap. */
const RETRY_FIRST_MS = 30_000;
const RETRY_CAP_MS = 5 * 60_000;
/** A spent day is looked at again at most this often when a group forms, so a limit raised in Orbit lets the bot listen again. */
const RECHECK_MS = 60_000;

export class ListeningBudget {
    /** The day's minutes are used until this time (epoch ms); 0 when they are not. */
    private spentUntil = 0;
    private pendingMs = 0;
    private flushTimer: ReturnType<typeof setTimeout> | undefined;
    private resetTimer: ReturnType<typeof setTimeout> | undefined;
    private askedAt = 0;
    private reporting: Promise<void> | undefined;
    /** No report is tried before this time (epoch ms) after one failed: an Orbit that is down or from before this is not hammered. */
    private retryAt = 0;
    private retryMs = RETRY_FIRST_MS;
    private closed = false;

    constructor(
        private readonly botId: string,
        private readonly orbit: ListeningOrbit,
        /** Called whenever the budget goes from available to spent or back, so the relay can change what it listens to. */
        private readonly onChange: () => void,
        private readonly log: (message: string) => void = () => undefined,
        private readonly now: () => number = Date.now
    ) {}

    /** Are the day's minutes used? Not before the next day, once Orbit has said so. */
    isSpent(): boolean {
        return this.now() < this.spentUntil;
    }

    /** Group chatter the bot took in: reported soon, in one call for what gathers. */
    add(audioMs: number): void {
        if (this.closed || !Number.isFinite(audioMs) || audioMs <= 0) return;
        this.pendingMs = Math.min(MAX_PENDING_MS, this.pendingMs + audioMs);
        if (this.pendingMs >= FLUSH_AT_MS && this.now() >= this.retryAt) {
            void this.flush();
        } else {
            this.schedule(Math.max(FLUSH_AFTER_MS, this.retryAt - this.now()));
        }
    }

    /** Asks Orbit where the day stands, counting nothing: when a group forms, so a day already used (or a limit changed) is known before anyone talks. */
    async check(): Promise<void> {
        if (this.closed || (this.now() - this.askedAt < RECHECK_MS && this.pendingMs < 1000) || this.now() < this.retryAt) return;
        await this.flush();
    }

    /** Reports what has gathered (or only asks when nothing has). */
    flush(): Promise<void> {
        if (this.closed) return Promise.resolve();
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        // One report at a time: what gathers meanwhile goes in the next
        if (this.reporting) return this.reporting;
        this.reporting = this.report().then((ok) => {
            this.reporting = undefined;
            if (this.closed) return;
            if (ok) {
                this.retryMs = RETRY_FIRST_MS;
                // What gathered while the report was out: right away when it is a lot, else after the usual short wait
                if (this.pendingMs >= FLUSH_AT_MS) void this.flush();
                else if (this.pendingMs >= 1000) this.schedule(FLUSH_AFTER_MS);
            } else {
                // Not counted: tried again after a wait that grows, never in a loop
                this.retryAt = this.now() + this.retryMs;
                this.retryMs = Math.min(RETRY_CAP_MS, this.retryMs * 2);
                if (this.pendingMs >= 1000) this.schedule(this.retryAt - this.now());
            }
        });
        return this.reporting;
    }

    /** A report is made after this long, unless one is already waiting. */
    private schedule(delayMs: number): void {
        if (this.flushTimer || this.closed) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            void this.flush();
        }, delayMs);
        this.flushTimer.unref?.();
    }

    /** True when Orbit answered (the seconds are counted), false when it could not be asked or did not know the question. */
    private async report(): Promise<boolean> {
        const ms = this.pendingMs;
        // Whole seconds only: what is left over waits for more
        const seconds = Math.floor(ms / 1000);
        this.pendingMs -= seconds * 1000;
        this.askedAt = this.now();
        let answer: Awaited<ReturnType<ListeningOrbit['reportVoiceListening']>> = null;
        try {
            answer = await this.orbit.reportVoiceListening(this.botId, { seconds });
        } catch {
            answer = null;
        }
        if (!answer) {
            // Not counted: kept to report again, and the bot keeps listening
            this.pendingMs = Math.min(MAX_PENDING_MS, this.pendingMs + seconds * 1000);
            this.log('voice: could not report the daily listening, the bot keeps listening');
            return false;
        }
        const wasSpent = this.isSpent();
        this.spentUntil = answer.spent ? Date.parse(answer.resetsAt) : 0;
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }
        if (!this.closed && this.spentUntil > this.now()) {
            // The next day starts: the bot listens to groups again, without waiting for anyone to ask
            this.resetTimer = setTimeout(() => {
                this.resetTimer = undefined;
                this.spentUntil = 0;
                this.onChange();
            }, Math.min(this.spentUntil - this.now(), 2 ** 31 - 1));
            this.resetTimer.unref?.();
        }
        if (this.isSpent() !== wasSpent) this.onChange();
        return true;
    }

    /** The bot is going away: nothing more is reported or waited for. */
    shutdown(): void {
        this.closed = true;
        if (this.flushTimer) clearTimeout(this.flushTimer);
        if (this.resetTimer) clearTimeout(this.resetTimer);
        this.flushTimer = undefined;
        this.resetTimer = undefined;
    }
}
