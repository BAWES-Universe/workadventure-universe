/**
 * Voice inside the Universe AI allowance (#1669). A spoken reply comes out of the same 5-hour window as a text reply, with some
 * replies kept for text and few for a guest; Orbit holds the numbers (its voice limits) and does the counting. This asks it, just
 * before a reply that Universe AI pays for is said, and turns "no" into one line and a paused button (see VoiceCalls).
 *
 * Nothing here can make a reply cost twice: Orbit counts a reply once under its turn id. Anything but a clear "yes" or "no" (Orbit
 * can't be asked, an Orbit from before) leaves the reply in text, so nothing is spoken on Universe AI's account unasked.
 */
import type { SpeechTurn } from './BotSpeech';

/**
 * Why Orbit did not let funded speech go ahead (billing consensus v2, P3; Orbit docs/speech-admission-contract.md, section 2). Five reasons, kept apart
 * because each one needs a different line: `person` is the person's own allowance, `budget` and `provider` are Universe's (no blame, no date),
 * `hold` is something set aside that will be let go (waiting helps), `capacity` is full right now.
 */
export type StoppedBy = 'person' | 'budget' | 'hold' | 'provider' | 'capacity';
export const STOPPED_BY: readonly StoppedBy[] = ['person', 'budget', 'hold', 'provider', 'capacity'];

/** What Orbit set aside for one reply (contract version 2): the amounts the receipt echoes back, and the longest the reply may be. */
export interface Admission {
    rateVersion: number;
    admittedSeconds: number;
    admittedMicros: number;
    /** The enforceable longest reply, in seconds: the game stops the reply at it. */
    maxSeconds?: number;
    provider?: string;
}

/** Why a turn was not let through, as the gate keeps it until it is read (see `TurnGate.stopOf`). */
export interface SpeechStop {
    by: StoppedBy;
    /** When it comes back, as an ISO time, when Orbit said (an allowance's end). Never a date for a budget or a provider. */
    resetsAt?: string;
    /** Waiting helps this long (seconds), when Orbit could tell. */
    retryAfterSeconds?: number;
}

/** What Orbit answered to "may this reply be spoken". `admission` is the version 2 answer; an Orbit from before sends none and no `stoppedBy`. */
export type AllowanceYes = { allowed: true; left?: number; resetsAt?: string; admission?: Admission };
export type AllowanceRefusal = { allowed: false; resetsAt?: string; stoppedBy?: StoppedBy; retryAfterSeconds?: number };
export type AllowanceAnswer = AllowanceYes | AllowanceRefusal;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isoTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

/** What Orbit set aside for a reply, from its answer. Undefined for an Orbit from before, or an answer that is not in the agreed shape (the reply is then counted the old way). */
export function parseAdmission(value: unknown): Admission | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const o = value as Record<string, unknown>;
    if (o.contract !== 2 || !finite(o.rateVersion) || !finite(o.admittedSeconds) || !finite(o.admittedMicros) || o.admittedSeconds < 0 || o.admittedMicros < 0) return undefined;
    return {
        rateVersion: o.rateVersion,
        admittedSeconds: o.admittedSeconds,
        admittedMicros: o.admittedMicros,
        ...(finite(o.maxSeconds) && o.maxSeconds > 0 ? { maxSeconds: o.maxSeconds } : {}),
        ...(typeof o.provider === 'string' && o.provider ? { provider: o.provider.slice(0, 80) } : {}),
    };
}

/** Orbit's answer to "may this reply be spoken", in the shapes of its contract. Null for anything else: the reply stays in text. */
export function parseAllowance(body: unknown): AllowanceAnswer | null {
    if (!body || typeof body !== 'object') return null;
    const o = body as Record<string, unknown>;
    if (o.allowed === true) {
        // What is left comes with a yes from an Orbit that counts it; an Orbit from before sends only the yes
        const left = finite(o.left) && Number.isInteger(o.left) && o.left >= 0 ? o.left : undefined;
        const resetsAt = isoTime(o.resetsAt) ? o.resetsAt : undefined;
        const admission = parseAdmission(o.admission);
        return { allowed: true, ...(left === undefined ? {} : { left, resetsAt }), ...(admission ? { admission } : {}) };
    }
    if (o.allowed !== false) return null;
    const stoppedBy = STOPPED_BY.find((by) => by === o.stoppedBy);
    // An Orbit from before names no reason and always gives the end of the window; one that names a reason may leave the date out (a budget has none)
    if (!stoppedBy && !isoTime(o.resetsAt)) return null;
    return {
        allowed: false,
        ...(isoTime(o.resetsAt) ? { resetsAt: o.resetsAt } : {}),
        ...(stoppedBy ? { stoppedBy } : {}),
        ...(finite(o.retryAfterSeconds) && o.retryAfterSeconds >= 0 ? { retryAfterSeconds: Math.ceil(o.retryAfterSeconds) } : {}),
    };
}

/** What the bot server asks of Orbit. `AdminApiService` is the real one; tests give a fake. */
export interface AllowanceOrbit {
    /**
     * Null when Orbit can't be asked or doesn't know the question. `left` and `resetsAt` come with a yes from an Orbit that counts what is
     * left (the spoken replies still possible after this one, and when the person's window ends); an Orbit from before sends neither.
     * `model` is the speaking model, when the bot knows it: Orbit prices the reply with it.
     */
    checkVoiceAllowance(botId: string, input: { userId: string; isGuest: boolean; turnId: string; model?: string }): Promise<AllowanceAnswer | null>;
    /**
     * How many spoken replies a person has left, counting nothing (for the Voice menu before the first spoken reply). `left` is null when
     * Orbit can't name the person; `resetsAt` is null while no window is running. Null when Orbit can't be asked or is from before this.
     */
    voiceRepliesLeft?(botId: string, input: { userId: string; isGuest: boolean }): Promise<{ left: number | null; resetsAt: string | null } | null>;
    /** Gives back a reply that was counted and then never spoken. True: it was given back. False: nothing was counted under that id. Null: could not be done (Orbit down, an Orbit from before). */
    releaseVoiceReply(botId: string, input: { turnId: string }): Promise<boolean | null>;
}

/** The person a reply is for, as Orbit counts people: their id as the game gave it, and whether they are a guest. */
export interface Talker {
    userId: string;
    isGuest: boolean;
}

export type SpeakVerdict = 'yes' | 'no' | 'unknown';

/** What a person has left, to say in their Voice menu (#1669): spoken replies, and when more come, as an ISO time (none while no window runs). */
export interface RepliesLeft {
    count: number;
    resetsAt?: string;
}

/** What the relay needs to settle a turn that Universe AI would pay for. */
export interface TurnGate {
    /** The person's id (their uuid) when the bot knows who the turn is for. */
    personOf(turn: SpeechTurn): string | undefined;
    /** May this reply be spoken? `unknown`: it could not be settled, so it stays in text and nobody is told voice is paused. */
    mayUniverseAiSpeak(turn: SpeechTurn): Promise<SpeakVerdict>;
    /** What Orbit's answer for this turn said the person has left, when it said (an Orbit from before does not). Read right after `mayUniverseAiSpeak`. */
    leftOf?(turn: SpeechTurn): RepliesLeft | undefined;
    /** Why a turn that was answered `no` was stopped, when Orbit said which of the five (an Orbit from before says none: the person's own allowance). Read right after `mayUniverseAiSpeak`. */
    stopOf?(turn: SpeechTurn): SpeechStop | undefined;
    /** What Orbit set aside for an admitted reply (version 2), kept until the reply's receipt is written. Undefined: Orbit counted it the old way. */
    admissionOf?(turnId: string): Admission | undefined;
    /** The reply's receipt was written (or the reply was given back): what was kept for it is let go. */
    settled?(turnId: string): void;
    /** The speaking model asked about, so Orbit prices the reply with it. */
    model?: string;
    /** What a person has left, asked of Orbit with nothing counted: when they arrive, and after a reply was given back. Null when it can't be told. */
    leftForPlayer?(playerId: number): Promise<RepliesLeft | null>;
    /** A reply that was allowed will not be spoken after all: whatever was counted for it is given back. Never throws, never needs waiting for. True: a counted reply was given back. */
    release(turn: SpeechTurn): Promise<boolean>;
}

/** Giving a reply back is tried this many times, with these pauses between (it is safe to repeat: Orbit gives back at most once). */
const RELEASE_PAUSES_MS = [1000, 5000];
const MAX_COUNTED = 500;
const MAX_LEFT_KEPT = 200;
const MAX_ADMISSIONS_KEPT = 500;

export class OrbitTurnGate implements TurnGate {
    /** Replies this bot server was told "yes" for: only these can have been counted, so only these are given back. */
    private readonly counted = new Set<string>();
    /** What Orbit's answer for a turn said was left, until it is read. */
    private readonly leftByTurn = new Map<string, RepliesLeft>();
    /** Why Orbit stopped a turn, until it is read. */
    private readonly stopByTurn = new Map<string, SpeechStop>();
    /** What Orbit set aside for each admitted reply: the receipt of that reply echoes it. Oldest first out. */
    private readonly admissions = new Map<string, Admission>();
    /** The speaking model of the bot now, sent with every question so Orbit prices the reply with it. */
    model?: string;

    constructor(
        private readonly botId: string,
        private readonly orbit: AllowanceOrbit,
        /** Who a player id is, as the behavior learnt it. Null while it isn't known (nobody to count). */
        private readonly talker: (playerId: number) => Talker | null,
        private readonly log: (message: string) => void = () => undefined,
        private readonly pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.())
    ) {}

    personOf(turn: SpeechTurn): string | undefined {
        return this.who(turn)?.userId;
    }

    async mayUniverseAiSpeak(turn: SpeechTurn): Promise<SpeakVerdict> {
        const who = this.who(turn);
        // Nobody Orbit could count: it never stops anyone it can't name either
        if (!who) return 'yes';
        const answer = await this.orbit.checkVoiceAllowance(this.botId, {
            userId: who.userId,
            isGuest: who.isGuest,
            turnId: turn.turnId,
            ...(this.model ? { model: this.model } : {}),
        });
        if (!answer) {
            this.log('voice: could not settle the allowance, this reply stays in text');
            return 'unknown';
        }
        const refusal = answer.allowed ? undefined : (answer as AllowanceRefusal);
        // What is left is the person's own allowance: a stop that is Universe's (budget, provider) or a wait (hold, capacity) says nothing about it
        this.rememberLeft(
            turn.turnId,
            refusal
                ? refusal.stoppedBy === undefined || refusal.stoppedBy === 'person'
                    ? { count: 0, resetsAt: refusal.resetsAt }
                    : undefined
                : typeof (answer as AllowanceYes).left === 'number'
                  ? { count: (answer as AllowanceYes).left, resetsAt: (answer as AllowanceYes).resetsAt }
                  : undefined
        );
        if (refusal) {
            // An Orbit from before names no reason: its only stop was the person's own allowance
            this.stopByTurn.set(turn.turnId, {
                by: refusal.stoppedBy ?? 'person',
                ...(refusal.stoppedBy === undefined || refusal.stoppedBy === 'person' ? { resetsAt: refusal.resetsAt } : {}),
                ...(typeof refusal.retryAfterSeconds === 'number' ? { retryAfterSeconds: refusal.retryAfterSeconds } : {}),
            });
            for (const oldest of this.stopByTurn.keys()) {
                if (this.stopByTurn.size <= MAX_LEFT_KEPT) break;
                this.stopByTurn.delete(oldest);
            }
            return 'no';
        }
        const admission = (answer as AllowanceYes).admission;
        if (admission) {
            this.admissions.set(turn.turnId, admission);
            for (const oldest of this.admissions.keys()) {
                if (this.admissions.size <= MAX_ADMISSIONS_KEPT) break;
                this.admissions.delete(oldest);
            }
        }
        this.counted.add(turn.turnId);
        for (const oldest of this.counted) {
            if (this.counted.size <= MAX_COUNTED) break;
            this.counted.delete(oldest);
        }
        return 'yes';
    }

    leftOf(turn: SpeechTurn): RepliesLeft | undefined {
        const left = this.leftByTurn.get(turn.turnId);
        this.leftByTurn.delete(turn.turnId);
        return left;
    }

    stopOf(turn: SpeechTurn): SpeechStop | undefined {
        const stop = this.stopByTurn.get(turn.turnId);
        this.stopByTurn.delete(turn.turnId);
        return stop;
    }

    admissionOf(turnId: string): Admission | undefined {
        return this.admissions.get(turnId);
    }

    settled(turnId: string): void {
        this.admissions.delete(turnId);
    }

    async leftForPlayer(playerId: number): Promise<RepliesLeft | null> {
        const who = this.talker(playerId);
        if (!who || !this.orbit.voiceRepliesLeft) return null;
        try {
            const answer = await this.orbit.voiceRepliesLeft(this.botId, { userId: who.userId, isGuest: who.isGuest });
            if (!answer || typeof answer.left !== 'number') return null;
            return { count: answer.left, resetsAt: answer.resetsAt ?? undefined };
        } catch {
            return null;
        }
    }

    private rememberLeft(turnId: string, left: RepliesLeft | undefined): void {
        if (!left) return;
        this.leftByTurn.set(turnId, left);
        for (const oldest of this.leftByTurn.keys()) {
            if (this.leftByTurn.size <= MAX_LEFT_KEPT) break;
            this.leftByTurn.delete(oldest);
        }
    }

    async release(turn: SpeechTurn): Promise<boolean> {
        // Never counted here (text, a bot whose voice the maker pays for, nobody to count): nothing to give back
        if (!this.counted.delete(turn.turnId)) return false;
        // A reply that is given back has no receipt to write
        this.admissions.delete(turn.turnId);
        try {
            for (let attempt = 0; ; attempt++) {
                const result = await this.orbit.releaseVoiceReply(this.botId, { turnId: turn.turnId });
                if (result !== null) return result;
                if (attempt >= RELEASE_PAUSES_MS.length) break;
                await this.pause(RELEASE_PAUSES_MS[attempt]);
            }
            this.log('voice: could not give back a spoken reply that was never heard');
        } catch {
            this.log('voice: could not give back a spoken reply that was never heard');
        }
        return false;
    }

    private who(turn: SpeechTurn): Talker | null {
        return turn.playerId === undefined ? null : this.talker(turn.playerId);
    }
}
