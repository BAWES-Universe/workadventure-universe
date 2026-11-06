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
        if (!Number.isFinite(audioMs) || audioMs <= 0) return;
        this.pendingMs = Math.min(MAX_PENDING_MS, this.pendingMs + audioMs);
        if (this.pendingMs >= FLUSH_AT_MS) {
            void this.flush();
        } else if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => void this.flush(), FLUSH_AFTER_MS);
            this.flushTimer.unref?.();
        }
    }

    /** Asks Orbit where the day stands, counting nothing: when a group forms, so a day already used (or a limit changed) is known before anyone talks. */
    async check(): Promise<void> {
        if (this.now() - this.askedAt < RECHECK_MS && !this.pendingMs) return;
        await this.flush();
    }

    /** Reports what has gathered (or only asks when nothing has). */
    flush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        // One report at a time: what gathers meanwhile goes in the next
        if (this.reporting) return this.reporting;
        this.reporting = this.report().finally(() => {
            this.reporting = undefined;
            if (this.pendingMs >= FLUSH_AT_MS) void this.flush();
        });
        return this.reporting;
    }

    private async report(): Promise<void> {
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
            return;
        }
        const wasSpent = this.isSpent();
        this.spentUntil = answer.spent ? Date.parse(answer.resetsAt) : 0;
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }
        if (this.spentUntil > this.now()) {
            // The next day starts: the bot listens to groups again, without waiting for anyone to ask
            this.resetTimer = setTimeout(() => {
                this.resetTimer = undefined;
                this.spentUntil = 0;
                this.onChange();
            }, Math.min(this.spentUntil - this.now(), 2 ** 31 - 1));
            this.resetTimer.unref?.();
        }
        if (this.isSpent() !== wasSpent) this.onChange();
    }

    /** The bot is going away: nothing more is reported or waited for. */
    shutdown(): void {
        if (this.flushTimer) clearTimeout(this.flushTimer);
        if (this.resetTimer) clearTimeout(this.resetTimer);
        this.flushTimer = undefined;
        this.resetTimer = undefined;
    }
}
