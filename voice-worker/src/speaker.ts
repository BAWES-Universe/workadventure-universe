// Plays committed bot segments, one at a time, in real time, to every lane that plays audio. Speech is fake until
// speaking lands. Each 20 ms frame is made when it is due, so nothing is buffered ahead and a stop is immediate.
import type { Encoder } from '@evan/opus';
import { Up2 } from './dsp.ts';
import { FRAME_MS } from './audioFormat.ts';
import { newOpusEncoder } from './opus.ts';
import type { Counters } from './counters.ts';
import type { PlaybackProgress, PlaybackReason } from './protocol.ts';
import type { FakeSpeech } from './fakeSpeech.ts';
import type { OutputFrame, OutputTarget } from './transport.ts';

/** Segments waiting behind the current one. More than this are refused. */
export const MAX_QUEUED_SEGMENTS = 16;

interface Segment {
    id: string;
    text: string;
    totalMs: number;
    playedMs: number;
    /** False once any frame had nobody to hear it. */
    deliveredAll: boolean;
}

export interface SpeakerHost {
    counters: Counters;
    speech: FakeSpeech;
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
    private stopped = false;
    private readonly encoder: Encoder = newOpusEncoder(32000);
    private readonly done: Promise<void>;

    constructor(private readonly host: SpeakerHost) {
        this.done = this.run();
    }

    get speaking(): boolean {
        return this.current !== undefined;
    }

    enqueue(id: string, text: string): void {
        if (!this.host.active() || this.queue.length >= MAX_QUEUED_SEGMENTS) {
            this.host.counters.inc('say_rejected');
            this.host.progress({ segmentId: id, playedMs: 0, totalMs: 0, finished: true, interrupted: false, reason: 'rejected' });
            return;
        }
        this.queue.push({ id, text, totalMs: 0, playedMs: 0, deliveredAll: true });
        this.wake?.();
    }

    retract(id: string): void {
        const index = this.queue.findIndex((s) => s.id === id);
        if (index >= 0) {
            this.queue.splice(index, 1);
            this.host.progress({ segmentId: id, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'retract' });
        } else if (this.current?.id === id) {
            this.cancel = 'retract';
            for (const target of this.host.targets()) target.clear?.();
        }
    }

    /** Stops what is playing and drops what is queued. */
    stopAll(reason: PlaybackReason): void {
        if (this.current) this.cancel = reason;
        for (const target of this.host.targets()) target.clear?.();
        for (const segment of this.queue.splice(0)) {
            this.host.progress({ segmentId: segment.id, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason });
        }
    }

    async shutdown(): Promise<void> {
        this.stopped = true;
        this.cancel = 'voice_stop';
        this.wake?.();
        await this.done;
    }

    private async run(): Promise<void> {
        const { counters, speech } = this.host;
        while (!this.stopped) {
            if (!this.queue.length) await new Promise<void>((resolve) => (this.wake = resolve));
            this.wake = undefined;
            const segment = this.queue.shift();
            if (!segment || this.stopped) continue;
            this.current = segment;
            this.cancel = undefined;
            const pcm = speech.synth(segment.text);
            segment.totalMs = (pcm.length / speech.frameSamples) * FRAME_MS;
            counters.inc('tts_generated_ms', segment.totalMs);
            counters.inc('segments_started');
            const up = new Up2();
            const startedAt = performance.now();
            let frame = 0;
            let lastProgress = startedAt;
            let reason: PlaybackReason = 'completed';
            for (let offset = 0; offset < pcm.length; offset += speech.frameSamples) {
                if (this.cancel || !this.host.active()) {
                    reason = this.cancel ?? 'voice_stop';
                    break;
                }
                const listeners = this.host.targets().filter((t) => t.plays());
                if (listeners.length) {
                    const pcm24k = pcm.subarray(offset, offset + speech.frameSamples);
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
                    this.host.progress({ segmentId: segment.id, playedMs: segment.playedMs, totalMs: segment.totalMs, finished: false, interrupted: false });
                }
                const wait = startedAt + frame * FRAME_MS - performance.now();
                if (wait > 0) await sleep(wait);
            }
            const interrupted = reason !== 'completed';
            this.current = undefined;
            if (interrupted) {
                counters.inc('segments_cancelled');
                counters.inc('tts_cancelled_ms', segment.totalMs - segment.playedMs);
            } else {
                counters.inc('segments_completed');
                if (!segment.deliveredAll) reason = 'lane_loss';
            }
            counters.inc('tts_played_ms', segment.playedMs);
            this.host.progress({ segmentId: segment.id, playedMs: segment.playedMs, totalMs: segment.totalMs, finished: true, interrupted, reason });
        }
    }
}
