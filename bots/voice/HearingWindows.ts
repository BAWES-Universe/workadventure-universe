/**
 * Live hearing on Universe's account is admitted in windows (billing consensus v2, 6.3 point 2; Orbit docs/speech-admission-contract.md, section 4).
 *
 * Orbit sets a stretch of hearing aside for a person ("a window": `admittedSeconds` at the hearing rate), and the game keeps hearing them for
 * that long. Before the window is used up it asks for the next one, in the background, so the call never waits for Orbit: nothing is asked
 * per audio frame and nothing here sits in the path of audio. If the next window is refused the game stops taking that person's microphone
 * for Universe's account at the end of the window it has, and says why (`onRefused`, with Orbit's reason). A person's own key pays for its own
 * hearing and never comes here.
 *
 * What a window held is settled by the hearing events themselves (each carries its `windowId`, see VoiceMeter) and by a release when the
 * person's hearing ends. An Orbit that cannot be asked is not a refusal: hearing goes on, as it did before windows existed, and the question is
 * asked again later. An Orbit from before windows (no such route) is told once and never asked again by this process.
 */
import type { SpeechStop, StoppedBy } from './VoiceAllowance';
import { STOPPED_BY } from './VoiceAllowance';

/** A window Orbit admitted. */
export interface HearingWindowGrant {
    allowed: true;
    windowId: string;
    rateVersion?: number;
    provider?: string;
    /** Seconds of hearing set aside for this window. */
    admittedSeconds: number;
    /** The next window is asked for once this many seconds of this one have passed. */
    renewAfterSeconds: number;
    admittedMicros?: number;
}

export type HearingWindowRefusal = { allowed: false; resetsAt?: string; stoppedBy: StoppedBy; retryAfterSeconds?: number };
export type HearingWindowAnswer = HearingWindowGrant | HearingWindowRefusal;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Orbit's answer to a window request, in the contract's shapes. Null for anything else (Orbit could not be understood: not a refusal). */
export function parseHearingWindow(body: unknown, windowId: string): HearingWindowAnswer | null {
    if (!body || typeof body !== 'object') return null;
    const o = body as Record<string, unknown>;
    if (o.allowed === true) {
        if (!finite(o.admittedSeconds) || o.admittedSeconds <= 0) return null;
        const renew = finite(o.renewAfterSeconds) && o.renewAfterSeconds > 0 ? o.renewAfterSeconds : o.admittedSeconds / 2;
        return {
            allowed: true,
            windowId: typeof o.windowId === 'string' && o.windowId ? o.windowId : windowId,
            ...(finite(o.rateVersion) ? { rateVersion: o.rateVersion } : {}),
            ...(typeof o.provider === 'string' && o.provider ? { provider: o.provider.slice(0, 80) } : {}),
            admittedSeconds: o.admittedSeconds,
            // Never later than the window itself: the next one is asked for before this one is used up
            renewAfterSeconds: Math.min(renew, o.admittedSeconds),
            ...(finite(o.admittedMicros) ? { admittedMicros: o.admittedMicros } : {}),
        };
    }
    if (o.allowed !== false) return null;
    const stoppedBy = STOPPED_BY.find((by) => by === o.stoppedBy);
    if (!stoppedBy) return null;
    return {
        allowed: false,
        stoppedBy,
        ...(typeof o.resetsAt === 'string' && !Number.isNaN(Date.parse(o.resetsAt)) ? { resetsAt: o.resetsAt } : {}),
        ...(finite(o.retryAfterSeconds) && o.retryAfterSeconds >= 0 ? { retryAfterSeconds: Math.ceil(o.retryAfterSeconds) } : {}),
    };
}

/** What the bot server asks of Orbit. `AdminApiService` is the real one; tests give a fake. */
export interface HearingOrbit {
    /** `unsupported`: an Orbit from before windows. Null: Orbit could not be asked (not a refusal). */
    admitHearingWindow(
        botId: string,
        input: { userId: string; isGuest: boolean; windowId: string; model?: string }
    ): Promise<HearingWindowAnswer | 'unsupported' | null>;
    /** True when this call closed it, false when it was closed already. Null when it could not be done. */
    releaseHearingWindow(botId: string, input: { windowId: string }): Promise<boolean | null>;
}

/** Who a window is for, as Orbit counts people. */
export interface HearingWho {
    userId: string;
    isGuest: boolean;
}

interface Window {
    id: string;
    /** When this window began to count (epoch ms): for the one in use, when it was taken into use. */
    startedAt: number;
    admittedMs: number;
    renewAfterMs: number;
}

interface Hearing {
    who: HearingWho;
    model?: string;
    /** The window hearing is using now. */
    current?: Window;
    /** The next window, already admitted, taken into use when the current one is used up. */
    next?: Window;
    /** The last refusal, kept until the window in use is over. */
    refused?: SpeechStop;
    /** A request is out. */
    asking: boolean;
    /** The wait after a request Orbit could not answer, growing each time. */
    retryMs: number;
    timer?: ReturnType<typeof setTimeout>;
    endTimer?: ReturnType<typeof setTimeout>;
    closed: boolean;
}

/** After a request Orbit could not answer: asked again after this long, then twice as long each time, to the cap. Not a limit on anyone. */
const RETRY_FIRST_MS = 10_000;
const RETRY_CAP_MS = 5 * 60_000;
/** A hold or full capacity says waiting helps but not how long: asked again after this many seconds. */
const WAIT_DEFAULT_SECONDS = 5;
/** What is released is tried again once, after this long (a release is safe to send twice). */
const RELEASE_RETRY_MS = 5_000;
/** No timer is set shorter than this: a window that says it renews at once does not make a loop. */
const MIN_TIMER_MS = 1_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

export class HearingWindows {
    private readonly hearings = new Map<string, Hearing>();
    private unsupported = false;
    private counter = 0;
    /** Tells one process's windows from another's after a restart: a window id is unique for the bot, ever. */
    private readonly run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

    constructor(
        private readonly botId: string,
        private readonly orbit: HearingOrbit,
        /**
         * Hearing for this person must stop: the window in use is over and the next was refused. `stop.by` says which of the five reasons. Called once;
         * hearing for the person starts again with a new `start`.
         */
        private readonly onRefused: (key: string, stop: SpeechStop) => void,
        private readonly log: (message: string) => void = () => undefined,
        private readonly now: () => number = Date.now
    ) {}

    /** Whether hearing is admitted in windows at all: an Orbit from before has none, and hearing then goes as it always did. */
    get active(): boolean {
        return !this.unsupported;
    }

    /** The person's hearing begins (their microphone is taken for Universe's account). Asking is in the background; the call is never held. Safe to repeat. */
    start(key: string, who: HearingWho, model?: string): void {
        if (this.unsupported || this.hearings.has(key)) return;
        const hearing: Hearing = { who, ...(model ? { model } : {}), asking: false, retryMs: RETRY_FIRST_MS, closed: false };
        this.hearings.set(key, hearing);
        void this.ask(key, hearing);
    }

    /** The person's hearing ended (they left, or their microphone is no longer taken): what the windows did not use is given back. Safe to repeat. */
    stop(key: string): void {
        const hearing = this.hearings.get(key);
        if (!hearing) return;
        this.close(key, hearing);
    }

    /** The people whose hearing is being admitted now, as the keys `start` was given. */
    keys(): string[] {
        return [...this.hearings.keys()];
    }

    /** The window the person's hearing is counted under now, for the events that report what was heard. Undefined while none is admitted. */
    windowOf(key: string): string | undefined {
        return this.hearings.get(key)?.current?.id;
    }

    /** The bot is going away: every window is given back, nothing is asked again. */
    shutdown(): void {
        for (const [key, hearing] of [...this.hearings]) this.close(key, hearing);
    }

    private newId(): string {
        return `${this.botId}:${this.run}:${++this.counter}`.slice(0, 120);
    }

    private close(key: string, hearing: Hearing): void {
        hearing.closed = true;
        clearTimeout(hearing.timer);
        clearTimeout(hearing.endTimer);
        if (this.hearings.get(key) === hearing) this.hearings.delete(key);
        for (const window of [hearing.current, hearing.next]) if (window) void this.release(window.id, 0);
        hearing.current = hearing.next = undefined;
    }

    private async release(windowId: string, attempt: number): Promise<void> {
        let result: boolean | null = null;
        try {
            result = await this.orbit.releaseHearingWindow(this.botId, { windowId });
        } catch {
            result = null;
        }
        if (result === null && attempt < 1) {
            const timer = setTimeout(() => void this.release(windowId, attempt + 1), RELEASE_RETRY_MS);
            timer.unref?.();
        }
    }

    /** Asks for the next window (or the first). One request at a time per person. */
    private async ask(key: string, hearing: Hearing): Promise<void> {
        if (hearing.closed || hearing.asking || this.unsupported) return;
        hearing.asking = true;
        const windowId = this.newId();
        let answer: Awaited<ReturnType<HearingOrbit['admitHearingWindow']>> = null;
        try {
            answer = await this.orbit.admitHearingWindow(this.botId, { userId: hearing.who.userId, isGuest: hearing.who.isGuest, windowId, ...(hearing.model ? { model: hearing.model } : {}) });
        } catch {
            answer = null;
        }
        hearing.asking = false;
        if (hearing.closed) {
            // The hearing ended while Orbit was being asked: a window it did admit is given back at once
            if (answer && answer !== 'unsupported' && answer.allowed) void this.release((answer as HearingWindowGrant).windowId, 0);
            return;
        }
        if (answer === 'unsupported') {
            this.unsupported = true;
            this.log('voice: this Orbit has no windows of hearing, hearing goes on as before');
            this.close(key, hearing);
            return;
        }
        if (!answer) {
            // Not a refusal: hearing carries on, and Orbit is asked again later
            this.log('voice: could not ask for a window of hearing, hearing carries on');
            this.schedule(key, hearing, hearing.retryMs);
            hearing.retryMs = Math.min(RETRY_CAP_MS, hearing.retryMs * 2);
            return;
        }
        hearing.retryMs = RETRY_FIRST_MS;
        if (answer.allowed) {
            const grant = answer as HearingWindowGrant;
            hearing.refused = undefined;
            const window: Window = { id: grant.windowId, startedAt: 0, admittedMs: Math.max(MIN_TIMER_MS, grant.admittedSeconds * 1000), renewAfterMs: Math.max(MIN_TIMER_MS, grant.renewAfterSeconds * 1000) };
            if (!hearing.current) this.use(key, hearing, window);
            else hearing.next = window;
            return;
        }
        const no = answer as HearingWindowRefusal;
        const stop: SpeechStop = { by: no.stoppedBy, ...(no.resetsAt ? { resetsAt: no.resetsAt } : {}), ...(no.retryAfterSeconds !== undefined ? { retryAfterSeconds: no.retryAfterSeconds } : {}) };
        hearing.refused = stop;
        // Nothing admitted yet: there is no window to finish, so hearing for Universe's account stops now
        if (!hearing.current) {
            this.refuse(key, hearing, stop);
            return;
        }
        // Waiting helps: asked again before the window in use is over. Anything else is final for this window
        if (stop.by === 'hold' || stop.by === 'capacity') {
            const left = hearing.current.startedAt + hearing.current.admittedMs - this.now();
            const wait = (stop.retryAfterSeconds ?? WAIT_DEFAULT_SECONDS) * 1000;
            if (wait < left) this.schedule(key, hearing, wait);
        }
    }

    /** A window is taken into use: it counts from now, and the next is asked for once `renewAfterMs` of it has passed. */
    private use(key: string, hearing: Hearing, window: Window): void {
        window.startedAt = this.now();
        hearing.current = window;
        hearing.next = undefined;
        clearTimeout(hearing.timer);
        clearTimeout(hearing.endTimer);
        this.schedule(key, hearing, window.renewAfterMs);
        const endTimer = setTimeout(() => this.over(key, hearing, window), Math.min(window.admittedMs, MAX_TIMER_MS));
        endTimer.unref?.();
        hearing.endTimer = endTimer;
    }

    /** The window in use is used up: the next is taken into use, or hearing for Universe's account stops when it was refused. */
    private over(key: string, hearing: Hearing, window: Window): void {
        if (hearing.closed || hearing.current !== window) return;
        // What was not used of it is given back; what was heard stays counted by its events
        void this.release(window.id, 0);
        if (hearing.next) {
            this.use(key, hearing, hearing.next);
            return;
        }
        hearing.current = undefined;
        if (hearing.refused) {
            this.refuse(key, hearing, hearing.refused);
            return;
        }
        // No answer yet (Orbit slow or down): hearing goes on, as it did before windows, and the next is asked for now
        void this.ask(key, hearing);
    }

    private refuse(key: string, hearing: Hearing, stop: SpeechStop): void {
        this.close(key, hearing);
        try {
            this.onRefused(key, stop);
        } catch (error) {
            this.log(`voice: could not stop hearing after a refused window (${error instanceof Error ? error.message : 'error'})`);
        }
    }

    private schedule(key: string, hearing: Hearing, delayMs: number): void {
        if (hearing.closed) return;
        clearTimeout(hearing.timer);
        const timer = setTimeout(() => void this.ask(key, hearing), Math.min(Math.max(delayMs, MIN_TIMER_MS), MAX_TIMER_MS));
        timer.unref?.();
        hearing.timer = timer;
    }
}
