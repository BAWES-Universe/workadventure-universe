// An internal second listener, OFF unless the worker is started with it (see config.ts). It runs a speech detector beside
// today's volume gate and only COUNTS what the detector says. It decides nothing:
//   - nothing here sends a message, stops the voice, opens a recognizer or touches an allowance; this file has no way to
//   - a failure, an overload, a late answer or a dropped frame only moves a counter
//   - it is given only audio the session was already allowed to hear, after the session has handled it, and it keeps its
//     own copy, so it cannot change what the session heard
// When off, nothing in this file runs and the detector's runtime is never loaded.
//
// Audio is held only while it waits its turn: at most `maxQueuedMsPerStream` per person and `maxQueuedMsTotal` in all.
// One call to the detector is in the air at a time for the whole worker; it carries one window from each person who has
// one waiting (up to `maxBatch`), so twenty people cost one call, not twenty.
// When a person is no longer heard (left, muted, a mode that does not listen, a newer path, the voice stopped) their
// waiting audio is thrown away at once, and an answer the detector gives afterwards for audio it was already working on
// is thrown away too: it is never counted and never becomes the state of whoever is heard next.
import type { Counters } from './counters.ts';
import type { InputFrame } from './transport.ts';

/** The detector takes 512 samples (32 ms at 16 kHz) at a time, with the 64 samples before them. */
export const WINDOW = 512;
export const CONTEXT = 64;
export const STATE = 2 * 1 * 128;
const RATE = 16000;
const WINDOW_MS = 32;

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

/** What a session holds: where its permitted audio is copied to, and how it says someone is no longer heard. */
export interface SessionObserver {
    /** One frame of permitted audio. Never throws, never waits. */
    frame(frame: InputFrame): void;
    /** These people are no longer heard on these paths: their waiting audio and any late answer are thrown away. */
    drop(match: (participantId: string, epoch: number) => boolean): void;
    /** The session is over. */
    close(): void;
}

export interface SpeechObserverSettings {
    load: DetectorLoader;
    /** One person's audio waiting for the detector, beyond which all of it is thrown away and they start afresh. Default 400 ms. */
    maxQueuedMsPerStream?: number;
    /** Everyone's audio waiting for the detector, beyond which new audio is not taken (a bound on memory: 16 s is half a megabyte). Default 16000 ms. */
    maxQueuedMsTotal?: number;
    /** People judged in one call to the detector, when it can take several (`runMany`). Default 32. */
    maxBatch?: number;
    /** People watched at once; more are not watched. Default 64. */
    maxStreams?: number;
    /** Failures in a row after which the observer switches itself off until the worker restarts. Default 5. */
    maxFailures?: number;
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

class Stream {
    state = new Float32Array(STATE);
    context = new Float32Array(CONTEXT);
    /** Audio waiting, oldest first, and how far into the first piece the next sample is. */
    readonly waiting: { pcm: Int16Array; at: number }[] = [];
    offset = 0;
    samples = 0;
    /** In the line for the detector. */
    lined = false;
    /** No longer heard: anything still to come back for it is thrown away. */
    dead = false;
    // The rule
    evidence = 0;
    gap = 0;
    armed = true;
    quiet = 0;

    constructor(readonly key: string, readonly sessionId: string, readonly participantId: string, readonly epoch: number) {}

    /** The next window with its context, and when the newest audio in it arrived. */
    take(): { input: Float32Array; arrivedAt: number } {
        const input = new Float32Array(CONTEXT + WINDOW);
        input.set(this.context);
        let filled = 0;
        let arrivedAt = 0;
        while (filled < WINDOW) {
            const head = this.waiting[0];
            const n = Math.min(WINDOW - filled, head.pcm.length - this.offset);
            for (let i = 0; i < n; i++) input[CONTEXT + filled + i] = head.pcm[this.offset + i] / 32768;
            filled += n;
            this.offset += n;
            arrivedAt = head.at;
            if (this.offset === head.pcm.length) {
                this.waiting.shift();
                this.offset = 0;
            }
        }
        this.samples -= WINDOW;
        return { input, arrivedAt };
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

export class SpeechObserver {
    private readonly streams = new Map<string, Stream>();
    private sessions = 0;
    /** Streams with a whole window waiting, in turn. */
    private readonly line: Stream[] = [];
    private queuedSamples = 0;
    private model?: DetectorModel;
    private loading?: Promise<void>;
    private pumping = false;
    private pumped: Promise<void> = Promise.resolve();
    private failures = 0;
    /** on: working. off: switched itself off (could not load, or failed too often). closed: the worker is closing. */
    private status: 'on' | 'off' | 'closed' = 'on';
    private inFlight = 0;
    private readonly maxStream: number;
    private readonly maxTotal: number;
    private readonly maxStreams: number;
    private readonly maxFailures: number;
    private readonly maxBatch: number;

    constructor(private readonly options: SpeechObserverOptions) {
        this.maxStream = Math.round(((options.maxQueuedMsPerStream ?? 400) * RATE) / 1000);
        this.maxTotal = Math.round(((options.maxQueuedMsTotal ?? 16000) * RATE) / 1000);
        this.maxStreams = options.maxStreams ?? 64;
        this.maxFailures = options.maxFailures ?? 5;
        this.maxBatch = Math.max(1, options.maxBatch ?? 32);
        // Loaded when the worker starts, so the first person heard does not wait for it
        this.loading = this.load();
    }

    private async load(): Promise<void> {
        try {
            const model = await this.options.load();
            if (this.status === 'closed') {
                await model.release?.();
                return;
            }
            this.model = model;
            this.options.counters.inc('observer_loaded');
            this.start();
        } catch {
            this.switchOff('observer_unavailable');
        }
    }

    /** Resolves once the detector is loaded or has failed to (tests and measuring). */
    ready(): Promise<void> {
        return this.loading ?? Promise.resolve();
    }

    private switchOff(counter: string): void {
        if (this.status !== 'on') return;
        this.status = 'off';
        this.options.counters.inc(counter);
        this.clear();
    }

    private clear(): void {
        for (const stream of this.streams.values()) stream.dead = true;
        this.streams.clear();
        this.line.length = 0;
        this.queuedSamples = 0;
    }

    /** One per session. Two sessions never share anything here, even if two bot servers gave them the same id. */
    session(sessionId: string): SessionObserver {
        const owner = ++this.sessions;
        return {
            frame: (frame) => {
                try {
                    this.take(owner, sessionId, frame);
                } catch {
                    this.options.counters.inc('observer_errors');
                }
            },
            drop: (match) => {
                for (const stream of [...this.streams.values()]) {
                    if (stream.key.startsWith(`${owner}\n`) && match(stream.participantId, stream.epoch)) this.kill(stream);
                }
            },
            close: () => {
                for (const stream of [...this.streams.values()]) if (stream.key.startsWith(`${owner}\n`)) this.kill(stream);
            },
        };
    }

    private kill(stream: Stream): void {
        const key = stream.key;
        stream.dead = true;
        this.queuedSamples -= stream.samples;
        stream.samples = 0;
        stream.waiting.length = 0;
        if (this.streams.get(key) === stream) this.streams.delete(key);
        this.options.counters.inc('observer_streams_ended');
    }

    private take(owner: number, sessionId: string, frame: InputFrame): void {
        if (this.status !== 'on') return;
        const c = this.options.counters;
        const length = frame.pcm16k.length;
        if (length === 0) return;
        const ms = length / 16;
        const key = `${owner}\n${frame.participantId}`;
        let stream = this.streams.get(key);
        if (stream && frame.epoch < stream.epoch) {
            c.inc('observer_stale_dropped');
            return;
        }
        // A newer path, or audio known to be missing: what was heard before must not colour what comes next
        if (stream && (frame.epoch > stream.epoch || frame.droppedMs >= 100)) {
            this.kill(stream);
            stream = undefined;
        }
        if (!stream) {
            if (this.streams.size >= this.maxStreams) {
                c.inc('observer_dropped_ms', ms);
                c.inc('observer_streams_refused');
                return;
            }
            stream = new Stream(key, sessionId, frame.participantId, frame.epoch);
            this.streams.set(key, stream);
            c.inc('observer_streams');
            c.max('observer_peak_streams', this.streams.size);
        }
        if (this.queuedSamples + length > this.maxTotal) {
            c.inc('observer_dropped_ms', ms);
            c.inc('observer_overloads');
            return;
        }
        if (stream.samples + length > this.maxStream) {
            // This person's audio is waiting too long to be worth an answer: all of it goes, and they start afresh
            c.inc('observer_dropped_ms', stream.samples / 16);
            c.inc('observer_overloads');
            this.kill(stream);
            stream = new Stream(key, sessionId, frame.participantId, frame.epoch);
            this.streams.set(key, stream);
        }
        // Its own copy: the transport may reuse its buffer, and nothing here may alter what the session was given
        stream.waiting.push({ pcm: frame.pcm16k.slice(), at: performance.now() });
        stream.samples += length;
        this.queuedSamples += length;
        c.max('observer_peak_queued_ms', Math.round(this.queuedSamples / 16));
        if (stream.samples >= WINDOW && !stream.lined) {
            stream.lined = true;
            this.line.push(stream);
        }
        this.start();
    }

    private start(): void {
        if (this.model && !this.pumping && this.line.length > 0) this.pumped = this.pump();
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
                const batch: { stream: Stream; input: Float32Array; arrivedAt: number; state: Float32Array }[] = [];
                while (batch.length < most) {
                    const stream = this.line.shift();
                    if (!stream) break;
                    stream.lined = false;
                    if (stream.dead || stream.samples < WINDOW) continue;
                    const { input, arrivedAt } = stream.take();
                    this.queuedSamples -= WINDOW;
                    batch.push({ stream, input, arrivedAt, state: stream.state });
                }
                if (batch.length === 0) break;
                const started = performance.now();
                let results: { probability: number; state: Float32Array }[] | undefined;
                this.inFlight += batch.length;
                try {
                    results = batch.length > 1 && model.runMany ? await model.runMany(batch.map(({ input, state }) => ({ input, state }))) : [await model.run(batch[0].input, batch[0].state)];
                    if (results.length !== batch.length) throw new Error('the detector answered for a different number of people');
                } catch {
                    results = undefined;
                } finally {
                    this.inFlight -= batch.length;
                }
                const now = performance.now();
                if (!results) {
                    c.inc('observer_errors');
                    // What these people's next windows would build on is gone: they start afresh with their next audio
                    for (const { stream } of batch) if (!stream.dead) this.kill(stream);
                    if (++this.failures >= this.maxFailures) this.switchOff('observer_gave_up');
                    continue;
                }
                c.inc('observer_calls');
                c.inc('observer_windows', batch.length);
                c.max('observer_peak_batch', batch.length);
                c.inc('observer_run_us', Math.round((now - started) * 1000));
                c.max('observer_max_run_ms', Math.ceil(now - started));
                this.failures = 0;
                for (let i = 0; i < batch.length; i++) {
                    const { stream, input, arrivedAt } = batch[i];
                    const result = results[i];
                    if (stream.dead || this.status !== 'on') {
                        // Answered after the person stopped being heard: thrown away
                        c.inc('observer_late_discarded');
                        continue;
                    }
                    // A copy: the runtime may hand back memory it reuses
                    stream.state = Float32Array.from(result.state);
                    stream.context = input.slice(WINDOW);
                    const ageMs = now - arrivedAt;
                    c.max('observer_max_age_ms', Math.ceil(ageMs));
                    c.inc('observer_age_ms', Math.round(ageMs));
                    if (result.probability >= ON) c.inc('observer_speech_windows');
                    if (stream.judge(result.probability)) c.inc('observer_firings');
                    try {
                        this.options.onVerdict?.({ sessionId: stream.sessionId, participantId: stream.participantId, epoch: stream.epoch, probability: result.probability, ageMs });
                    } catch {
                        c.inc('observer_errors');
                    }
                    // More of theirs waiting: back of the line, behind anyone who joined it meanwhile
                    if (!stream.dead && stream.samples >= WINDOW && !stream.lined) {
                        stream.lined = true;
                        this.line.push(stream);
                    }
                }
            }
        } finally {
            this.pumping = false;
        }
    }

    /** Where it stands, for /stats: numbers only. */
    stats(): { status: string; streams: number; queuedMs: number; inFlight: number } {
        return { status: this.model || this.status !== 'on' ? this.status : 'loading', streams: this.streams.size, queuedMs: Math.round(this.queuedSamples / 16), inFlight: this.inFlight };
    }

    /** The worker is closing: everything waiting is thrown away and the detector is let go. */
    async dispose(): Promise<void> {
        if (this.status === 'closed') return;
        this.status = 'closed';
        this.clear();
        await this.loading?.catch(() => undefined);
        // A window the detector is working on is waited for (and then thrown away) before the detector is let go
        await this.pumped.catch(() => undefined);
        const model = this.model;
        this.model = undefined;
        try {
            await model?.release?.();
        } catch {
            // Closing anyway
        }
    }
}
