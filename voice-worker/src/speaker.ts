// Plays committed bot segments, one at a time, in real time, to every lane that plays audio. The audio comes from the
// bubble's speech connector as a stream: the first frame plays as soon as the first chunk arrives, not when the whole
// reply is made. Each 20 ms frame is sent when it is due, so a stop is immediate and the provider call is closed with it.
import type { Encoder } from '@evan/opus';
import { Up2 } from './dsp.ts';
import { FRAME_MS, TTS_FRAME_SAMPLES } from './audioFormat.ts';
import { newOpusEncoder } from './opus.ts';
import type { Counters } from './counters.ts';
import type { PlaybackProgress, PlaybackReason } from './protocol.ts';
import { type ProviderReporter, type Voice } from './connectors.ts';
import { ReplyStream } from './replyStream.ts';
import type { OutputFrame, OutputTarget } from './transport.ts';

/** Segments waiting behind the current one. More than this are refused. */
export const MAX_QUEUED_SEGMENTS = 16;

interface Segment {
    id: string;
    text: string;
    lang?: string;
    /** Audio the provider has made so far; the whole reply once it is done. */
    totalMs: number;
    playedMs: number;
    /** The longest this reply may play. */
    maxMs: number;
    /** False once any frame had nobody to hear it. */
    deliveredAll: boolean;
}

export interface SpeakerHost {
    counters: Counters;
    /** This bubble's speech connector. */
    voice: Voice;
    /** Told once per reply how the provider did. Absent for the built-in test engine. */
    provider?: ProviderReporter;
    /** The longest any reply may play, whatever the bot server asks. */
    maxReplyMs: number;
    /** The longest wait for the next piece of audio before the provider counts as failed. */
    speechTimeoutMs: number;
    targets(): OutputTarget[];
    /** False once voice is stopped for the session. */
    active(): boolean;
    progress(message: Omit<PlaybackProgress, 'type' | 'sessionId' | 'ts'>): void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class Speaker {
    private readonly queue: Segment[] = [];
    private current?: Segment;
    private cancel?: PlaybackReason;
    private wake?: () => void;
    private abort?: AbortController;
    private stream?: ReplyStream;
    private stopped = false;
    private readonly encoder: Encoder = newOpusEncoder(32000);
    private readonly done: Promise<void>;

    constructor(private readonly host: SpeakerHost) {
        this.done = this.run();
    }

    get speaking(): boolean {
        return this.current !== undefined;
    }

    enqueue(id: string, text: string, maxMs?: number, lang?: string): void {
        if (!this.host.active() || this.queue.length >= MAX_QUEUED_SEGMENTS) {
            this.host.counters.inc('say_rejected');
            this.host.progress({ segmentId: id, playedMs: 0, totalMs: 0, finished: true, interrupted: false, reason: 'rejected' });
            return;
        }
        this.queue.push({ id, text, lang, totalMs: 0, playedMs: 0, maxMs: Math.min(maxMs ?? this.host.maxReplyMs, this.host.maxReplyMs), deliveredAll: true });
        this.wake?.();
    }

    retract(id: string): void {
        const index = this.queue.findIndex((s) => s.id === id);
        if (index >= 0) {
            this.queue.splice(index, 1);
            this.host.progress({ segmentId: id, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'retract' });
        } else if (this.current?.id === id) {
            this.halt('retract');
            for (const target of this.host.targets()) target.clear?.();
        }
    }

    /**
     * A person spoke over the bot: what is playing stops within a frame, what is queued is dropped, and nothing resumes.
     * Local, with no round trip to the bot server. False when the bot was not saying anything.
     */
    bargeIn(): boolean {
        if (!this.current && !this.queue.length) return false;
        this.host.counters.inc('barge_ins');
        this.stopAll('barge_in');
        return true;
    }

    /** Stops what is playing and drops what is queued. */
    stopAll(reason: PlaybackReason): void {
        if (this.current) this.halt(reason);
        for (const target of this.host.targets()) target.clear?.();
        for (const segment of this.queue.splice(0)) {
            this.host.progress({ segmentId: segment.id, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason });
        }
    }

    async shutdown(): Promise<void> {
        this.stopped = true;
        this.halt('voice_stop');
        this.wake?.();
        await this.done;
    }

    /** Cancels the reply being played: its audio stops within a frame and the provider call is closed. */
    private halt(reason: PlaybackReason): void {
        this.cancel = reason;
        this.abort?.abort();
        this.stream?.nudge();
    }

    private async run(): Promise<void> {
        while (!this.stopped) {
            if (!this.queue.length) await new Promise<void>((resolve) => (this.wake = resolve));
            this.wake = undefined;
            const segment = this.queue.shift();
            if (!segment || this.stopped) continue;
            this.current = segment;
            this.cancel = undefined;
            await this.play(segment);
            this.current = undefined;
        }
    }

    private async play(segment: Segment): Promise<void> {
        const { counters, provider } = this.host;
        const abort = (this.abort = new AbortController());
        // The provider is read ahead of playback, but never further than this reply may play
        const stream = (this.stream = new ReplyStream(() => this.host.voice.speak({ text: segment.text, lang: segment.lang, signal: abort.signal }), {
            signal: abort.signal,
            capSamples: Math.ceil(segment.maxMs / FRAME_MS) * TTS_FRAME_SAMPLES,
            timeoutMs: this.host.speechTimeoutMs,
        }));
        const up = new Up2();
        let started = false;
        let startedAt = 0;
        let frame = 0;
        let lastProgress = 0;
        let reason: PlaybackReason = 'completed';
        while (true) {
            if (this.cancel || !this.host.active()) {
                reason = this.cancel ?? 'voice_stop';
                break;
            }
            if (frame * FRAME_MS >= segment.maxMs) {
                reason = 'limit';
                break;
            }
            const pcm24k = stream.take();
            if (!pcm24k) {
                if (stream.ended) break;
                // The provider has not sent the next frame yet: time stands still for the reply until it does
                const waitedFrom = performance.now();
                await stream.changed();
                if (started) startedAt += performance.now() - waitedFrom;
                continue;
            }
            if (!started) {
                started = true;
                startedAt = lastProgress = performance.now();
                counters.inc('segments_started');
            }
            const listeners = this.host.targets().filter((t) => t.plays());
            if (listeners.length) {
                let opus: Buffer | undefined;
                const out: OutputFrame = { pcm24k, opus: () => (opus ??= Buffer.from(this.encoder.encode(up.process(pcm24k)))) };
                for (const listener of listeners) listener.sendFrame(out);
                segment.playedMs += FRAME_MS;
            } else {
                segment.deliveredAll = false;
            }
            frame++;
            if (performance.now() - lastProgress > 500) {
                lastProgress = performance.now();
                this.host.progress({ segmentId: segment.id, playedMs: segment.playedMs, ...(stream.ended ? { totalMs: stream.receivedMs } : {}), finished: false, interrupted: false });
            }
            const wait = startedAt + frame * FRAME_MS - performance.now();
            if (wait > 0) await sleep(wait);
        }
        segment.totalMs = stream.receivedMs;
        // The provider's own failure, once it has no more audio to give: a reply that never made any is a failure too
        const failed = stream.failure !== undefined || (reason === 'completed' && stream.received === 0);
        if (failed && reason === 'completed') reason = 'provider';
        // One report per reply: it failed, or it worked (it made audio, even if the reply was cut off), or it was cancelled before any
        if (failed) {
            counters.inc('tts_failed');
            provider?.failed(stream.failure?.status);
        } else if (stream.received > 0 || reason === 'completed') {
            provider?.ok();
        }
        abort.abort();
        this.abort = this.stream = undefined;
        const interrupted = reason !== 'completed';
        counters.inc('tts_generated_ms', segment.totalMs);
        if (interrupted) {
            if (started) counters.inc('segments_cancelled');
            counters.inc('tts_cancelled_ms', Math.max(0, segment.totalMs - segment.playedMs));
        } else {
            counters.inc('segments_completed');
            if (!segment.deliveredAll) reason = 'lane_loss';
        }
        counters.inc('tts_played_ms', segment.playedMs);
        this.host.progress({ segmentId: segment.id, playedMs: segment.playedMs, totalMs: segment.totalMs, finished: true, interrupted, reason });
    }
}
