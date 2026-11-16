/**
 * What a live voice call uses goes into Orbit's books (0.5.0 spend caps, gap F4): the seconds the bot heard a person talk and the seconds
 * of its own voice that were played. Until now only voice notes were booked, so the Voice row of the Costs page missed every live call.
 *
 * The worker already says both, so nothing is measured here: `user.turn` carries the audio the hearing provider took (`audioMs`, whatever
 * came of the words) and a finished `playback.progress` carries how much of a reply was played (`playedMs`). Each is one event, written by
 * Orbit once under its key (a retry is a "duplicate" and adds nothing), against the person it was for and the one who paid: a person's own
 * key (Orbit says which person, never this server) or Universe AI. Seconds are rounded up. A price is never made up here: Orbit has none for
 * speech, so a cost is written as not known, never as 0.
 *
 * Nothing here can stop or slow a call: events gather and go in one request after a short wait, a request that fails is tried again after a
 * wait that grows, and what cannot be sent in the end is dropped with one line in the log. The caps that already hold voice back are the
 * Universe AI reply allowance and the bot's listening limit (see VoiceAllowance, VoiceListening).
 */

/** Who a stretch of hearing or a spoken reply was for, as Orbit counts people. */
export interface VoiceWho {
    userId: string;
    isGuest: boolean;
}

export interface VoiceUse {
    part: 'hearing' | 'speaking';
    /** Makes it counted once: the same for a retry of one stretch of hearing or one reply, different for any other. */
    key: string;
    /** Audio taken by the hearing, or played of the reply, in milliseconds. Nothing is booked for 0. */
    ms: number;
    /** Null when the bot does not know who it was for (a greeting it made on its own): Orbit then names the Brick's maker, or nobody for a room bot. */
    who: VoiceWho | null;
    /** A person's own key paid for this part (true), or Universe AI did (false). */
    owner: boolean;
}

/** One event as Orbit's POST /api/meter/events takes it. */
export interface SpeechEvent {
    eventId: string;
    kind: 'speech';
    pool: 'chat';
    botId: string;
    occurredAt: string;
    userId?: string;
    isGuest?: boolean;
    payerKind: 'person' | 'universe';
    route: 'own-key' | 'universe-ai';
    quantity: number;
    unit: 'second';
    costMicros: null;
    basis: 'paid_by_other' | 'unknown';
    detail: { part: 'hearing' | 'speaking'; source: 'call'; ms: number };
}

/** What the bot server asks of Orbit. `AdminApiService` is the real one; tests give a fake. True: Orbit answered, so nothing is kept to send again. */
export interface MeterOrbit {
    recordMeterEvents(events: SpeechEvent[]): Promise<boolean>;
}

/** The most events Orbit takes in one request. */
const MAX_PER_REQUEST = 100;
/** Events go after this long, or at once when this many have gathered. */
const FLUSH_AFTER_MS = 5_000;
const FLUSH_AT = 50;
/** What is kept to send again after a request that failed. More than this is dropped, the oldest first. */
const MAX_PENDING = 1000;
const RETRY_FIRST_MS = 15_000;
const RETRY_CAP_MS = 5 * 60_000;

export class VoiceMeter {
    private pending: SpeechEvent[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    private sending: Promise<void> | undefined;
    private retryAt = 0;
    private retryMs = RETRY_FIRST_MS;
    private dropped = 0;
    private closed = false;

    constructor(
        private readonly botId: string,
        private readonly orbit: MeterOrbit,
        private readonly log: (message: string) => void = () => undefined,
        /**
         * Told apart from every earlier run of this server: stretches of hearing and replies are numbered from 1 again after a restart, so
         * without this a new run's first turn would be taken for the old run's and counted as nothing.
         */
        private readonly run: string = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        private readonly now: () => number = Date.now
    ) {}

    /** Books one use. Never throws, never waits. */
    add(use: VoiceUse): void {
        if (this.closed || !Number.isFinite(use.ms) || use.ms <= 0) return;
        const seconds = Math.ceil(use.ms / 1000);
        this.pending.push({
            eventId: `speech:call:${this.botId}:${this.run}:${use.part}:${use.key}`.slice(0, 255),
            kind: 'speech',
            pool: 'chat',
            botId: this.botId,
            occurredAt: new Date(this.now()).toISOString(),
            ...(use.who ? { userId: use.who.userId, isGuest: use.who.isGuest } : {}),
            payerKind: use.owner ? 'person' : 'universe',
            route: use.owner ? 'own-key' : 'universe-ai',
            quantity: seconds,
            unit: 'second',
            costMicros: null,
            basis: use.owner ? 'paid_by_other' : 'unknown',
            detail: { part: use.part, source: 'call', ms: Math.round(use.ms) },
        });
        if (this.pending.length > MAX_PENDING) {
            this.dropped += this.pending.length - MAX_PENDING;
            this.pending = this.pending.slice(-MAX_PENDING);
        }
        if (this.pending.length >= FLUSH_AT && this.now() >= this.retryAt) void this.flush();
        else this.schedule(Math.max(FLUSH_AFTER_MS, this.retryAt - this.now()));
    }

    /** Sends what has gathered. One request at a time: what gathers meanwhile goes in the next. */
    flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.sending) return this.sending;
        if (this.pending.length === 0) return Promise.resolve();
        this.sending = this.send().finally(() => {
            this.sending = undefined;
            if (this.closed || this.pending.length === 0) return;
            if (this.now() < this.retryAt) this.schedule(this.retryAt - this.now());
            else if (this.pending.length >= FLUSH_AT) void this.flush();
            else this.schedule(FLUSH_AFTER_MS);
        });
        return this.sending;
    }

    /** The bot is switched off: what gathered is sent once more, and nothing is booked after. */
    async shutdown(): Promise<void> {
        await this.flush().catch(() => undefined);
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.pending = [];
    }

    private schedule(delayMs: number): void {
        if (this.timer || this.closed) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            if (this.now() < this.retryAt) this.schedule(this.retryAt - this.now());
            else void this.flush();
        }, delayMs);
        this.timer.unref?.();
    }

    private async send(): Promise<void> {
        const batch = this.pending.slice(0, MAX_PER_REQUEST);
        let ok = false;
        try {
            ok = await this.orbit.recordMeterEvents(batch);
        } catch {
            ok = false;
        }
        if (ok) {
            // Only what was sent leaves: events that gathered meanwhile are still to go
            this.pending = this.pending.slice(batch.length);
            this.retryMs = RETRY_FIRST_MS;
            return;
        }
        // Orbit could not be asked: the same events go again after a wait that grows, and a call is never held up for it
        this.retryAt = this.now() + this.retryMs;
        this.retryMs = Math.min(RETRY_CAP_MS, this.retryMs * 2);
        this.log(this.dropped > 0 ? `voice: could not book the call's usage, ${this.dropped} uses were dropped` : 'voice: could not book the call\'s usage, trying again');
    }
}
