// An internal second listener, OFF unless the worker is started with it (see config.ts). It runs a speech detector beside
// today's volume gate and COUNTS what the detector says. By itself it decides nothing:
//   - nothing here sends a message, stops the voice, opens a recognizer or touches an allowance; this file has no way to
//   - a session may ask it (`confirm`, `heard`) for its view of one person; only the interruption control of a bot named
//     for the owner rollout does (yieldControl.ts), and whenever it cannot tell, the answer is today's rule
//   - a failure, an overload, a late answer or a dropped frame only moves a counter
//   - it is given only audio the session was already allowed to hear, after the session has handled it, and it keeps its
//     own copy, so it cannot change what the session heard
// When off, nothing in this file runs and the detector's runtime is never loaded.
//
// What it may hold, and for how long, is bounded in every state, a stuck detector included:
//   - audio waits at most `maxAgeMs` (by the clock, whether or not more audio arrives), at most `maxQueuedMsPerStream`
//     per person and `maxQueuedMsTotal` in all; an answer for audio older than `maxAgeMs` is thrown away
//   - one call to the detector is in the air at a time for the whole worker; it carries one window from each person who
//     has one waiting (up to `maxBatch`). A call not answered within `inferenceTimeoutMs` switches the observer off until
//     the worker restarts: a call cannot be taken back, so no second one is ever started beside it
//   - the line for the detector holds each person at most once, and nobody who is no longer watched
// When a person is no longer heard (left, muted, a mode that does not listen, a newer path, the voice stopped, the
// session over) their waiting audio is thrown away at once, and an answer the detector gives afterwards for audio it
// was already working on is thrown away too: never counted, never the state of whoever is heard next. Audio missing in
// the middle, whether the network lost it or the observer itself had to skip it, starts the person afresh.
import type { Counters } from './counters.ts';
import type { InputFrame } from './transport.ts';

/** The detector takes 512 samples (32 ms at 16 kHz) at a time, with the 64 samples before them. */
export const WINDOW = 512;
export const CONTEXT = 64;
export const STATE = 2 * 1 * 128;
const RATE = 16000;
const WINDOW_MS = 32;
/** This much audio missing in one go (lost on the way, or skipped here) and what was heard before must not colour what comes next. */
const GAP_RESET_MS = 100;
/** The detector's firing and today's gate count as agreeing when they come within this of each other for the same person. */
const AGREE_MS = 600;
/**
 * Asked to confirm: how often a waiting question checks that the detector keeps up with this person. Audio of theirs
 * given to it (at least FALLBACK_AUDIO_MS) with no answer for any of it in this time means it is falling behind,
 * and today's behaviour applies. Well inside the 2 s inference timeout, which is for watching only.
 */
const FALLBACK_CHECK_MS = 300;
/**
 * Asked to confirm: an answer counts toward a decision only for audio that arrived at most this long before it. An older
 * one (the detector was slow even once) is today's rule for that question, at once; it is still counted, as watching.
 */
export const DECISION_FRESH_MS = 300;
const FALLBACK_AUDIO_MS = 96;
const EMPTY = new Float32Array(0);

/**
 * What the detector last made of one person. `ageMs`: how long ago the newest audio it answered for arrived. `quietMs`:
 * how long (in their audio) it has heard no speech. `speech`: it hears speech now. `stream`: which unbroken run of their
 * audio this is: it changes whenever audio went missing, waited too long, overflowed or failed, so the same number twice
 * means every bit of their audio in between was answered, unless `droppedMs` grew. `droppedMs`: audio missing within
 * this run, in all, whether lost on the way or skipped by the observer itself; it only grows.
 */
export interface Heard {
    ageMs: number;
    quietMs: number;
    speech: boolean;
    stream: number;
    droppedMs: number;
}

/** Which way the audio came: a person's own peer connection, or the bubble's LiveKit room. */
export type ObserverPath = 'lane' | 'room';

/** The detector itself, however it is run. `input` is CONTEXT + WINDOW samples in -1..1; `state` is what the last call returned. */
export interface DetectorModel {
    run(input: Float32Array, state: Float32Array): Promise<{ probability: number; state: Float32Array }>;
    /**
     * Several people's next windows in one call, each with its own state, answered in the same order. Never two windows of
     * one person. Without it, windows go one by one.
     */
    runMany?(windows: { input: Float32Array; state: Float32Array }[]): Promise<{ probability: number; state: Float32Array }[]>;
    release?(): Promise<void>;
}
export type DetectorLoader = () => Promise<DetectorModel>;

/** What a session holds: where its permitted audio is copied to, and how it says someone is no longer heard. Nothing here throws or waits. */
export interface SessionObserver {
    /** One frame of permitted audio. */
    frame(frame: InputFrame, path?: ObserverPath): void;
    /** These people are no longer heard on these paths: their waiting audio and any late answer are thrown away. */
    drop(match: (participantId: string, epoch: number) => boolean): void;
    /** Today's gate decided this person is speaking (and whether that stopped the bot's voice): counted beside the detector's own firings. */
    baseline(participantId: string, stoppedTheVoice: boolean): void;
    /**
     * Today's gate heard something loud enough from this person to count as speaking. `go` is called once the detector
     * also hears speech from them, at once if it already does, and never if it does not (a fan, typing, a knock) or once
     * they are no longer heard. Whenever it cannot tell (not loaded, switched off, not watching this person, falling
     * behind) `go` is called promptly with `fallback` true, which is today's behaviour. The returned function says
     * nothing more is waited for: after it, `go` is never called, however late an answer comes. `go` is called at most once.
     */
    confirm(participantId: string, epoch: number, go: (fallback: boolean) => void): () => void;
    /**
     * What the detector last made of this person on this path, or undefined when it is not watching them now. `ageMs`:
     * how long ago the newest audio it answered for arrived (fresh evidence is young); `quietMs`: how long it has heard
     * no speech from them; `speech`: it hears speech now.
     */
    heard(participantId: string, epoch: number): Heard | undefined;
    /** The session is over. For good: nothing given to this handle afterwards is taken. */
    close(): void;
}

export interface SpeechObserverSettings {
    load: DetectorLoader;
    /** How long audio may wait, by the clock; an answer for a window whose oldest audio is older than this is thrown away. Default 400 ms. */
    maxAgeMs?: number;
    /** One person's audio waiting for the detector, beyond which all of it is thrown away and they start afresh. Default 400 ms. */
    maxQueuedMsPerStream?: number;
    /** Everyone's audio waiting for the detector, beyond which new audio is not taken (a bound on memory: 16 s is half a megabyte). Default 16000 ms. */
    maxQueuedMsTotal?: number;
    /** People watched at once; more are not watched. Default 64. */
    maxStreams?: number;
    /** Failures in a row after which the observer switches itself off until the worker restarts. Default 5. */
    maxFailures?: number;
    /** People judged in one call to the detector, when it can take several (`runMany`). Default 32. */
    maxBatch?: number;
    /** A call to the detector not answered by then switches the observer off until the worker restarts. Default 2000 ms. */
    inferenceTimeoutMs?: number;
    /** A detector not loaded by then leaves the observer off. Default 15000 ms. */
    loadTimeoutMs?: number;
    /** The longest closing the worker waits for the detector. Default 2000 ms. */
    disposeTimeoutMs?: number;
    /** Each answer that is kept (tests and measuring): a probability and how long the audio waited, never the audio. */
    onVerdict?(verdict: { sessionId: string; participantId: string; epoch: number; probability: number; ageMs: number }): void;
}
export interface SpeechObserverOptions extends SpeechObserverSettings {
    counters: Counters;
}

/** The rule being watched: speech probability at or above ON for MIN_MS, dips of up to GAP_MS forgiven; it can fire again after REARM_MS without speech. */
const ON = 0.5;
const MIN_MS = 64;
const GAP_MS = 96;
const OFF = 0.35;
const REARM_MS = 1800;

/**
 * Why a person's stream ended. revoked: no longer heard. overflow: more waiting than the limits allow. expired: waited too
 * long. idle: their audio stopped, leaving less than one window, which waited too long. failed: the detector failed or
 * the observer went off. reset: audio was lost on the way.
 */
type Ended = 'revoked' | 'overflow' | 'expired' | 'idle' | 'failed' | 'reset';

/** One session's handle. */
interface Owner {
    id: number;
    sessionId: string;
    closed: boolean;
    botSpeaking?: () => boolean;
    /** When the bot was last seen speaking. */
    spokeAt: number;
    /** Per person: which path they are on, and the last unmatched firing and gate decision. At most `maxStreams` people. */
    marks: Map<string, { path: ObserverPath; epoch: number; firingAt: number; baselineAt: number }>;
    /** Per person: today's gate heard them, and the detector has not heard speech from them yet. */
    pending: Map<string, Pending>;
}

/** A gate decision waiting on the detector. */
interface Pending {
    epoch: number;
    go: (fallback: boolean) => void;
    /** Their audio given to the observer, and their windows answered, since the last look. */
    offeredMs: number;
    answered: number;
    timer?: NodeJS.Timeout;
}

let streamSerials = 0;

class Stream {
    state = new Float32Array(STATE);
    context = new Float32Array(CONTEXT);
    /** Audio waiting, oldest first, and how far into the first piece the next sample is. */
    readonly waiting: { pcm: Int16Array; at: number }[] = [];
    offset = 0;
    samples = 0;
    /** In the line for the detector. */
    lined = false;
    /** Set once it is no longer watched: anything still to come back for it is thrown away. */
    ended?: Ended;
    /** Audio of theirs the observer itself had to skip since the last piece it took. */
    missingMs = 0;
    /** When the newest audio of the last answer kept arrived. */
    answeredAt = -Infinity;
    /** Audio missing within this run, lost on the way or skipped here (less than GAP_RESET_MS at a time, or it would have ended the run). Only grows. */
    droppedMs = 0;
    readonly serial = ++streamSerials;
    // The rule
    evidence = 0;
    gap = 0;
    armed = true;
    quiet = 0;

    constructor(readonly key: string, readonly owner: Owner, readonly participantId: string, readonly epoch: number, readonly path: ObserverPath) {}

    /** The next window with its context, and when the oldest and the newest audio in it arrived. */
    take(): { input: Float32Array; oldestAt: number; newestAt: number } {
        const input = new Float32Array(CONTEXT + WINDOW);
        input.set(this.context);
        let filled = 0;
        const oldestAt = this.waiting[0].at;
        let newestAt = oldestAt;
        while (filled < WINDOW) {
            const head = this.waiting[0];
            const n = Math.min(WINDOW - filled, head.pcm.length - this.offset);
            for (let i = 0; i < n; i++) input[CONTEXT + filled + i] = head.pcm[this.offset + i] / 32768;
            filled += n;
            this.offset += n;
            newestAt = head.at;
            if (this.offset === head.pcm.length) {
                this.waiting.shift();
                this.offset = 0;
            }
        }
        this.samples -= WINDOW;
        return { input, oldestAt, newestAt };
    }

    /** True when the rule fires on this answer. */
    judge(probability: number): boolean {
        if (probability >= ON) {
            this.evidence += WINDOW_MS;
            this.gap = 0;
            this.quiet = 0;
            if (this.armed && this.evidence >= MIN_MS) {
                this.armed = false;
                return true;
            }
            return false;
        }
        this.gap += WINDOW_MS;
        if (this.gap > GAP_MS) this.evidence = 0;
        this.quiet = probability < OFF ? this.quiet + WINDOW_MS : 0;
        if (!this.armed && this.quiet >= REARM_MS) this.armed = true;
        return false;
    }
}

type Outcome<T> = { kind: 'ok'; value: T } | { kind: 'error' } | { kind: 'late' };

export class SpeechObserver {
    private readonly streams = new Map<string, Stream>();
    private readonly owners = new Set<Owner>();
    private sessions = 0;
    /** Streams with a whole window waiting, in turn. Only streams still watched, each at most once: never more than `maxStreams`. */
    private readonly line: Stream[] = [];
    private queuedSamples = 0;
    private model?: DetectorModel;
    private readonly loading: Promise<void>;
    private pumping = false;
    private pumped: Promise<void> = Promise.resolve();
    /** The call to the detector that is in the air, if any; it settles when the detector answers, however late. */
    private outstanding?: Promise<void>;
    private failures = 0;
    /** on: working. off: switched itself off (could not load, failed too often, or did not answer in time). closed: the worker is closing. */
    private status: 'on' | 'off' | 'closed' = 'on';
    private inFlight = 0;
    private sweepTimer?: NodeJS.Timeout;
    private readonly maxAge: number;
    private readonly maxStream: number;
    private readonly maxTotal: number;
    private readonly maxStreams: number;
    private readonly maxFailures: number;
    private readonly maxBatch: number;
    private readonly inferenceTimeout: number;
    private readonly loadTimeout: number;
    private readonly disposeTimeout: number;

    constructor(private readonly options: SpeechObserverOptions) {
        this.maxAge = options.maxAgeMs ?? 400;
        this.maxStream = Math.round(((options.maxQueuedMsPerStream ?? 400) * RATE) / 1000);
        this.maxTotal = Math.round(((options.maxQueuedMsTotal ?? 16000) * RATE) / 1000);
        this.maxStreams = options.maxStreams ?? 64;
        this.maxFailures = options.maxFailures ?? 5;
        this.maxBatch = Math.max(1, options.maxBatch ?? 32);
        this.inferenceTimeout = options.inferenceTimeoutMs ?? 2000;
        this.loadTimeout = options.loadTimeoutMs ?? 15000;
        this.disposeTimeout = options.disposeTimeoutMs ?? 2000;
        // Loaded when the worker starts, so the first person heard does not wait for it
        this.loading = this.load();
    }

    /** Waits for `work`, but no longer than `ms`. The work itself cannot be stopped; `late` only says it was not waited for. */
    private within<T>(work: Promise<T>, ms: number): Promise<Outcome<T>> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ kind: 'late' }), ms);
            timer.unref?.();
            work.then(
                (value) => {
                    clearTimeout(timer);
                    resolve({ kind: 'ok', value });
                },
                () => {
                    clearTimeout(timer);
                    resolve({ kind: 'error' });
                }
            );
        });
    }

    private async letGo(model: DetectorModel): Promise<void> {
        try {
            await model.release?.();
        } catch {
            // Nothing depends on it
        }
    }

    private async load(): Promise<void> {
        const loaded = (async () => this.options.load())();
        const outcome = await this.within(loaded, this.loadTimeout);
        if (outcome.kind === 'ok') {
            if (this.status !== 'on') {
                await this.letGo(outcome.value);
                return;
            }
            this.model = outcome.value;
            this.options.counters.inc('observer_loaded');
            this.start();
            return;
        }
        if (outcome.kind === 'late') {
            this.options.counters.inc('observer_load_timed_out');
            // Whatever it loads in the end is let go at once
            loaded.then(
                (model) => void this.letGo(model),
                () => undefined
            );
        }
        this.switchOff('observer_unavailable');
    }

    /** Resolves once the detector is loaded or has failed to (tests and measuring). */
    ready(): Promise<void> {
        return this.loading;
    }

    private switchOff(counter: string): void {
        if (this.status !== 'on') return;
        this.status = 'off';
        this.options.counters.inc(counter);
        // Whoever was waiting on the detector is decided as today, and so is everyone after this
        for (const owner of this.owners) for (const participantId of [...owner.pending.keys()]) this.decide(owner, participantId, 'observer_decide_fallback');
        this.clear('failed');
        if (this.outstanding) void this.outstanding.then(() => this.release());
        else void this.release();
    }

    /** Lets the detector go. Only ever called when no call to it is in the air. */
    private async release(): Promise<void> {
        const model = this.model;
        if (!model || this.outstanding) return;
        this.model = undefined;
        await this.letGo(model);
    }

    /** Everything held for everyone goes: waiting audio, state, the line. */
    private clear(reason: Ended): void {
        for (const stream of [...this.streams.values()]) this.end(stream, reason);
        this.streams.clear();
        this.line.length = 0;
        this.queuedSamples = 0;
        for (const owner of this.owners) {
            owner.marks.clear();
            for (const participantId of [...owner.pending.keys()]) this.forgetPending(owner, participantId);
        }
        clearTimeout(this.sweepTimer);
        this.sweepTimer = undefined;
    }

    /**
     * One per session. Two sessions never share anything here, even if two bot servers gave them the same id.
     * `botSpeaking` is only read, to count how much was observed while the bot was talking.
     */
    session(sessionId: string, about: { botSpeaking?: () => boolean } = {}): SessionObserver {
        const owner: Owner = { id: ++this.sessions, sessionId, closed: false, botSpeaking: about.botSpeaking, spokeAt: -Infinity, marks: new Map(), pending: new Map() };
        this.owners.add(owner);
        const c = this.options.counters;
        const mine = (): Stream[] => [...this.streams.values()].filter((stream) => stream.owner === owner);
        return {
            frame: (frame, path = 'lane') => {
                if (owner.closed) {
                    c.inc('observer_refused_closed');
                    return;
                }
                try {
                    this.take(owner, frame, path);
                } catch {
                    c.inc('observer_errors');
                }
            },
            drop: (match) => {
                if (owner.closed) return;
                try {
                    for (const stream of mine()) if (match(stream.participantId, stream.epoch)) this.end(stream, 'revoked');
                    for (const [participantId, mark] of [...owner.marks]) if (match(participantId, mark.epoch)) owner.marks.delete(participantId);
                    // No longer heard: nothing of theirs is acted on
                    for (const [participantId, pending] of [...owner.pending]) if (match(participantId, pending.epoch)) this.forgetPending(owner, participantId);
                } catch {
                    c.inc('observer_errors');
                }
            },
            baseline: (participantId, stoppedTheVoice) => {
                if (owner.closed || this.status !== 'on') return;
                try {
                    this.gateSpoke(owner, participantId, stoppedTheVoice);
                } catch {
                    c.inc('observer_errors');
                }
            },
            confirm: (participantId, epoch, go) => {
                let once = false;
                const call = (fallback: boolean): void => {
                    if (once) return;
                    once = true;
                    try {
                        go(fallback);
                    } catch {
                        c.inc('observer_errors');
                    }
                };
                try {
                    const cancel = this.ask(owner, participantId, epoch, call);
                    return () => {
                        once = true;
                        cancel();
                    };
                } catch {
                    c.inc('observer_errors');
                    c.inc('observer_decide_fallback');
                    call(true);
                    return () => undefined;
                }
            },
            heard: (participantId, epoch) => {
                if (owner.closed || this.status !== 'on' || !this.model) return undefined;
                const stream = this.streams.get(`${owner.id}\n${participantId}`);
                if (!stream || stream.ended || stream.epoch !== epoch || stream.answeredAt === -Infinity) return undefined;
                return { ageMs: performance.now() - stream.answeredAt, quietMs: stream.quiet, speech: stream.evidence >= MIN_MS, stream: stream.serial, droppedMs: stream.droppedMs };
            },
            close: () => {
                if (owner.closed) return;
                // Closed first, so nothing that arrives while the rest of the session shuts down is taken
                owner.closed = true;
                for (const participantId of [...owner.pending.keys()]) this.forgetPending(owner, participantId);
                for (const stream of mine()) this.end(stream, 'revoked');
                owner.marks.clear();
                this.owners.delete(owner);
            },
        };
    }

    /**
     * Deciding: today's gate heard this person. `go` at once when the detector already hears speech from them, or cannot
     * tell; otherwise once it does. Returns how to say the stretch is over.
     */
    private ask(owner: Owner, participantId: string, epoch: number, go: (fallback: boolean) => void): () => void {
        const c = this.options.counters;
        c.inc('observer_decide_asked');
        const stream = this.streams.get(`${owner.id}\n${participantId}`);
        // Not able to tell: not loaded, switched off, closing, or not watching this person (beyond the limit, or their audio
        // was just started afresh): today's behaviour
        if (owner.closed || this.status !== 'on' || !this.model || !stream || stream.ended || stream.epoch !== epoch) {
            c.inc('observer_decide_fallback');
            go(true);
            return () => undefined;
        }
        // Speech heard already, and recently enough to decide on
        if (stream.evidence >= MIN_MS && performance.now() - stream.answeredAt <= DECISION_FRESH_MS) {
            c.inc('observer_decide_confirmed');
            c.inc('observer_decide_at_once');
            go(false);
            return () => undefined;
        }
        this.forgetPending(owner, participantId);
        const pending: Pending = { epoch, go, offeredMs: 0, answered: 0 };
        owner.pending.set(participantId, pending);
        this.checkLater(owner, participantId, pending);
        return () => {
            if (owner.pending.get(participantId) !== pending) return;
            // No longer waited for, and the detector never heard speech: today's gate alone would have stopped the bot here
            c.inc('observer_decide_held');
            try {
                if (owner.botSpeaking?.() === true || performance.now() - owner.spokeAt <= AGREE_MS) c.inc('observer_decide_held_bot_speaking');
            } catch {
                c.inc('observer_errors');
            }
            this.forgetPending(owner, participantId);
        };
    }

    /** Every FALLBACK_CHECK_MS while it waits: audio of theirs given, and none of it answered, is the detector falling behind. */
    private checkLater(owner: Owner, participantId: string, pending: Pending): void {
        pending.timer = setTimeout(() => {
            if (owner.pending.get(participantId) !== pending) return;
            if (pending.offeredMs >= FALLBACK_AUDIO_MS && pending.answered === 0) {
                this.decide(owner, participantId, 'observer_decide_fallback_slow');
                return;
            }
            pending.offeredMs = 0;
            pending.answered = 0;
            this.checkLater(owner, participantId, pending);
        }, FALLBACK_CHECK_MS);
        pending.timer.unref?.();
    }

    /** Says go for a waiting decision, once, and counts why. */
    private decide(owner: Owner, participantId: string, counter: string): void {
        const pending = owner.pending.get(participantId);
        if (!pending) return;
        this.forgetPending(owner, participantId);
        this.options.counters.inc(counter);
        const fallback = counter.startsWith('observer_decide_fallback');
        if (counter.startsWith('observer_decide_fallback_')) this.options.counters.inc('observer_decide_fallback');
        pending.go(fallback);
    }

    private forgetPending(owner: Owner, participantId: string): void {
        const pending = owner.pending.get(participantId);
        if (!pending) return;
        clearTimeout(pending.timer);
        owner.pending.delete(participantId);
    }

    /** Stops watching a stream: its waiting audio goes at once and is counted under why, and it leaves the line. */
    private end(stream: Stream, reason: Ended): void {
        if (stream.ended) return;
        stream.ended = reason;
        const c = this.options.counters;
        if (stream.samples > 0) c.inc(`observer_${reason}_ms`, stream.samples / 16);
        this.queuedSamples -= stream.samples;
        stream.samples = 0;
        stream.offset = 0;
        stream.waiting.length = 0;
        // Let go of, not wiped: a call in the air may still be reading the arrays it was handed
        stream.state = EMPTY;
        stream.context = EMPTY;
        if (stream.lined) {
            stream.lined = false;
            const at = this.line.indexOf(stream);
            if (at >= 0) this.line.splice(at, 1);
        }
        if (this.streams.get(stream.key) === stream) this.streams.delete(stream.key);
        c.inc('observer_streams_ended');
        // Dropped because the detector could not keep up, or failed: a decision waiting on it is made as today. Not
        // heard any more (revoked): nothing. Their audio paused (idle) or was lost on the way (reset): their next audio
        // starts a new stream, which goes on deciding.
        if ((reason === 'expired' || reason === 'overflow' || reason === 'failed') && stream.owner.pending.get(stream.participantId)?.epoch === stream.epoch) {
            this.decide(stream.owner, stream.participantId, 'observer_decide_fallback_behind');
        }
    }

    private take(owner: Owner, frame: InputFrame, path: ObserverPath): void {
        if (this.status !== 'on') return;
        const c = this.options.counters;
        const length = frame.pcm16k.length;
        if (length === 0) return;
        const ms = length / 16;
        const now = performance.now();
        c.inc('observer_offered_ms', ms);
        c.inc(`observer_offered_ms_${path}`, ms);
        const pending = owner.pending.get(frame.participantId);
        if (pending && pending.epoch === frame.epoch) pending.offeredMs += ms;
        const mark = owner.marks.get(frame.participantId);
        if (mark) {
            mark.path = path;
            mark.epoch = Math.max(mark.epoch, frame.epoch);
        } else if (owner.marks.size < this.maxStreams) {
            owner.marks.set(frame.participantId, { path, epoch: frame.epoch, firingAt: -Infinity, baselineAt: -Infinity });
        }
        const key = `${owner.id}\n${frame.participantId}`;
        let stream = this.streams.get(key);
        if (stream && frame.epoch < stream.epoch) {
            c.inc('observer_stale_dropped');
            return;
        }
        // A newer path, or audio known to be missing: what was heard before must not colour what comes next
        if (stream && frame.epoch > stream.epoch) {
            this.end(stream, 'revoked');
            stream = undefined;
        }
        if (stream && frame.droppedMs >= GAP_RESET_MS) {
            this.end(stream, 'reset');
            stream = undefined;
        }
        if (stream) stream.droppedMs += frame.droppedMs;
        // Audio that has waited too long is not worth an answer: it goes, and they start afresh
        if (stream && stream.waiting.length > 0 && now - stream.waiting[0].at > this.maxAge) {
            this.end(stream, stream.samples < WINDOW ? 'idle' : 'expired');
            stream = undefined;
        }
        // One piece longer than a person may have waiting is not taken at all
        if (length > this.maxStream) {
            c.inc('observer_overflow_ms', ms);
            c.inc('observer_overloads');
            if (stream) this.end(stream, 'overflow');
            return;
        }
        if (this.queuedSamples + length > this.maxTotal) {
            c.inc('observer_overflow_ms', ms);
            c.inc('observer_overloads');
            // Skipped here, so missing for this person just as if the network had lost it. It counts toward droppedMs
            // too, which only grows: a skip shorter than the reset (missingMs, cleared by the next piece taken) must still
            // show to anyone checking that every bit of this run was answered (the interruption control's recovery)
            if (stream) {
                stream.missingMs += ms;
                stream.droppedMs += ms;
                if (stream.missingMs >= GAP_RESET_MS) this.end(stream, 'overflow');
            }
            return;
        }
        if (stream && stream.samples + length > this.maxStream) {
            // More of this person's audio waiting than is worth an answer: all of it goes, and they start afresh
            c.inc('observer_overloads');
            this.end(stream, 'overflow');
            stream = undefined;
        }
        if (!stream) {
            if (this.streams.size >= this.maxStreams) {
                c.inc('observer_overflow_ms', ms);
                c.inc('observer_streams_refused');
                return;
            }
            stream = new Stream(key, owner, frame.participantId, frame.epoch, path);
            this.streams.set(key, stream);
            c.inc('observer_streams');
            c.max('observer_peak_streams', this.streams.size);
        }
        stream.missingMs = 0;
        // Its own copy: the transport may reuse its buffer, and nothing here may alter what the session was given
        stream.waiting.push({ pcm: frame.pcm16k.slice(), at: now });
        stream.samples += length;
        this.queuedSamples += length;
        c.max('observer_peak_queued_ms', Math.round(this.queuedSamples / 16));
        if (stream.samples >= WINDOW && !stream.lined) {
            stream.lined = true;
            this.line.push(stream);
            c.max('observer_peak_line', this.line.length);
        }
        this.start();
        this.watch();
    }

    /** While anything waits, a timer set for the moment the oldest of it has waited too long: audio expires by the clock even if no more arrives. */
    private watch(): void {
        if (this.sweepTimer || this.status !== 'on' || this.queuedSamples <= 0) return;
        const now = performance.now();
        let due = Infinity;
        for (const stream of this.streams.values()) if (stream.waiting.length > 0) due = Math.min(due, stream.waiting[0].at + this.maxAge - now);
        if (due === Infinity) return;
        this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            this.sweep();
        }, Math.max(1, Math.ceil(due) + 1));
        this.sweepTimer.unref?.();
    }

    private sweep(): void {
        if (this.status !== 'on') return;
        const now = performance.now();
        for (const stream of [...this.streams.values()]) if (stream.waiting.length > 0 && now - stream.waiting[0].at > this.maxAge) this.end(stream, stream.samples < WINDOW ? 'idle' : 'expired');
        this.watch();
    }

    private start(): void {
        if (this.status === 'on' && this.model && !this.pumping && this.line.length > 0) this.pumped = this.pump();
    }

    /**
     * One call at a time for the whole worker, so the detector never uses more than one core. A call carries one window
     * from each person in the line, in turn; a person with more audio waiting goes to the back of the line for the next call.
     */
    private async pump(): Promise<void> {
        if (this.pumping || !this.model) return;
        this.pumping = true;
        const c = this.options.counters;
        try {
            while (this.status === 'on' && this.model) {
                const model = this.model;
                const most = model.runMany ? this.maxBatch : 1;
                const batch: { stream: Stream; input: Float32Array; oldestAt: number; newestAt: number; state: Float32Array }[] = [];
                const started = performance.now();
                while (batch.length < most) {
                    const stream = this.line.shift();
                    if (!stream) break;
                    stream.lined = false;
                    if (stream.ended || stream.samples < WINDOW) continue;
                    // Waited too long already: not sent to the detector at all
                    if (started - stream.waiting[0].at > this.maxAge) {
                        this.end(stream, 'expired');
                        continue;
                    }
                    const { input, oldestAt, newestAt } = stream.take();
                    this.queuedSamples -= WINDOW;
                    batch.push({ stream, input, oldestAt, newestAt, state: stream.state });
                }
                if (batch.length === 0) break;
                const n = batch.length;
                const call = (async () => (n > 1 && model.runMany ? model.runMany(batch.map(({ input, state }) => ({ input, state }))) : [await model.run(batch[0].input, batch[0].state)]))();
                const settled: Promise<void> = call
                    .then(
                        () => undefined,
                        () => undefined
                    )
                    .then(() => {
                        if (this.outstanding === settled) this.outstanding = undefined;
                    });
                this.outstanding = settled;
                this.inFlight += n;
                const outcome = await this.within(call, this.inferenceTimeout);
                this.inFlight -= n;
                const now = performance.now();
                if (outcome.kind === 'late') {
                    // The detector did not answer in time. The call cannot be taken back, so nothing more is ever sent
                    // beside it: the observer is off until the worker restarts, and holds nothing but that one call.
                    c.inc('observer_windows_failed', n);
                    if (this.status === 'on') {
                        c.inc('observer_timed_out');
                        this.switchOff('observer_gave_up');
                    }
                    break;
                }
                if (outcome.kind === 'error' || outcome.value.length !== n) {
                    c.inc('observer_errors');
                    c.inc('observer_windows_failed', n);
                    // What these people's next windows would build on is gone: they start afresh with their next audio
                    for (const { stream } of batch) this.end(stream, 'failed');
                    if (++this.failures >= this.maxFailures) this.switchOff('observer_gave_up');
                    continue;
                }
                const results = outcome.value;
                c.inc('observer_calls');
                c.inc('observer_windows_completed', n);
                c.max('observer_peak_batch', n);
                c.inc('observer_run_us', Math.round((now - started) * 1000));
                c.max('observer_max_run_ms', Math.ceil(now - started));
                this.failures = 0;
                for (let i = 0; i < n; i++) {
                    const { stream, input, oldestAt, newestAt } = batch[i];
                    const result = results[i];
                    if (stream.ended) {
                        // Answered after the person stopped being heard (revoked), or after their stream was started
                        // afresh for another reason (stale): thrown away either way
                        c.inc(stream.ended === 'revoked' ? 'observer_windows_revoked' : 'observer_windows_stale');
                        continue;
                    }
                    if (now - oldestAt > this.maxAge) {
                        // Too old to be worth anything: not kept, not counted as an answer, and they start afresh
                        c.inc('observer_windows_expired');
                        this.end(stream, 'expired');
                        continue;
                    }
                    // A copy: the runtime may hand back memory it reuses
                    stream.state = Float32Array.from(result.state);
                    stream.context = input.slice(WINDOW);
                    stream.answeredAt = newestAt;
                    const ageMs = now - newestAt;
                    c.inc('observer_windows_accepted');
                    c.inc(`observer_accepted_ms_${stream.path}`, WINDOW_MS);
                    c.max('observer_max_age_ms', Math.ceil(ageMs));
                    c.inc('observer_age_ms', Math.round(ageMs));
                    c.max('observer_max_oldest_age_ms', Math.ceil(now - oldestAt));
                    let botSpeaking = false;
                    try {
                        botSpeaking = stream.owner.botSpeaking?.() === true;
                    } catch {
                        c.inc('observer_errors');
                    }
                    if (botSpeaking) {
                        stream.owner.spokeAt = now;
                        c.inc('observer_accepted_ms_bot_speaking', WINDOW_MS);
                    }
                    if (result.probability >= ON) c.inc('observer_speech_windows');
                    if (stream.judge(result.probability)) this.fired(stream, now);
                    const pending = stream.owner.pending.get(stream.participantId);
                    if (pending && pending.epoch === stream.epoch) {
                        // Too slow for a decision, even once: today's rule for this question, at once
                        if (ageMs > DECISION_FRESH_MS) this.decide(stream.owner, stream.participantId, 'observer_decide_fallback_stale');
                        else {
                            pending.answered++;
                            if (stream.evidence >= MIN_MS) this.decide(stream.owner, stream.participantId, 'observer_decide_confirmed');
                        }
                    }
                    try {
                        this.options.onVerdict?.({ sessionId: stream.owner.sessionId, participantId: stream.participantId, epoch: stream.epoch, probability: result.probability, ageMs });
                    } catch {
                        c.inc('observer_errors');
                    }
                    // More of theirs waiting: back of the line, behind anyone who joined it meanwhile
                    if (!stream.ended && stream.samples >= WINDOW && !stream.lined) {
                        stream.lined = true;
                        this.line.push(stream);
                    }
                }
            }
        } finally {
            this.pumping = false;
        }
    }

    /** The rule fired for this person: counted, by path, while the bot was talking, and against today's gate. Numbers only. */
    private fired(stream: Stream, now: number): void {
        const c = this.options.counters;
        c.inc('observer_firings');
        c.inc(`observer_firings_${stream.path}`);
        if (now - stream.owner.spokeAt <= AGREE_MS) c.inc('observer_firings_bot_speaking');
        const mark = stream.owner.marks.get(stream.participantId);
        if (!mark) return;
        if (now - mark.baselineAt <= AGREE_MS) {
            mark.baselineAt = -Infinity;
            c.inc('observer_agree');
            c.inc(`observer_agree_${stream.path}`);
        } else {
            mark.firingAt = now;
        }
    }

    /** Today's gate decided this person is speaking. Counted only for people the observer has been given audio of. */
    private gateSpoke(owner: Owner, participantId: string, stoppedTheVoice: boolean): void {
        const mark = owner.marks.get(participantId);
        if (!mark) return;
        const c = this.options.counters;
        const now = performance.now();
        c.inc('observer_baseline');
        c.inc(`observer_baseline_${mark.path}`);
        if (stoppedTheVoice) {
            owner.spokeAt = now;
            c.inc('observer_baseline_stops');
        }
        if (now - mark.firingAt <= AGREE_MS) {
            mark.firingAt = -Infinity;
            c.inc('observer_agree');
            c.inc(`observer_agree_${mark.path}`);
        } else {
            mark.baselineAt = now;
        }
    }

    /** Where it stands, for /stats: numbers only. */
    stats(): { status: string; streams: number; queuedMs: number; inFlight: number; lined: number; callOut: boolean } {
        return {
            status: this.model || this.status !== 'on' ? this.status : 'loading',
            streams: this.streams.size,
            queuedMs: Math.round(this.queuedSamples / 16),
            inFlight: this.inFlight,
            lined: this.line.length,
            callOut: this.outstanding !== undefined,
        };
    }

    /**
     * The worker is closing: everything waiting is thrown away at once. Closing then waits no longer than
     * `disposeTimeoutMs` in all: for loading, for a call still in the air, and for the detector to be let go, together
     * under one limit, not one after the other. What is not done by then carries on by itself, in the same order: the
     * detector is let go only once no call to it is in the air, and only once. Nothing new is sent to it after closing
     * began. The process is on its way out either way.
     */
    async dispose(): Promise<void> {
        if (this.status === 'closed') return;
        this.status = 'closed';
        this.clear('revoked');
        this.owners.clear();
        const cleanup = (async () => {
            await Promise.allSettled([this.loading, this.pumped]);
            while (this.outstanding) await this.outstanding;
            await this.release();
        })();
        await this.within(cleanup, this.disposeTimeout);
    }
}
