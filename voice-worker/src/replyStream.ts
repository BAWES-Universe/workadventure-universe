// One spoken reply on its way in: audio from a speech connector, taken as it arrives and handed out a 20 ms frame at a
// time. It reads ahead of playback (providers send faster than real time) but never past what the reply may play, so a
// long reply cannot fill memory. It ends when the provider is done, fails, goes quiet for too long, or is aborted.
import { FRAME_MS, TTS_FRAME_SAMPLES } from './audioFormat.ts';
import { ProviderError, statusOf } from './connectors.ts';

export interface ReplyStreamOptions {
    /** Aborting stops reading and lets the connector close its provider call. */
    signal: AbortSignal;
    /** No more audio is read once this many samples have come in: the reply cannot play longer than that. */
    capSamples: number;
    /** The longest wait for the next piece of audio before the provider counts as failed. */
    timeoutMs: number;
}

export class ReplyStream {
    private readonly chunks: Int16Array[] = [];
    private offset = 0;
    private buffered = 0;
    private waiter?: () => void;
    /** Samples that have come in. */
    received = 0;
    /** No more audio is coming (finished, failed, timed out, aborted or capped). */
    ended = false;
    /** The provider call failed; `status` is its HTTP status when it had one. */
    failure?: { status?: number };

    constructor(open: () => AsyncIterable<Int16Array>, private readonly options: ReplyStreamOptions) {
        void this.pump(open);
    }

    get receivedMs(): number {
        return (this.received / TTS_FRAME_SAMPLES) * FRAME_MS;
    }

    /** The next 20 ms frame, the last one padded with silence; undefined when no whole frame has come in yet (or the reply is used up). */
    take(): Int16Array | undefined {
        if (this.buffered === 0 || (this.buffered < TTS_FRAME_SAMPLES && !this.ended)) return undefined;
        const frame = new Int16Array(TTS_FRAME_SAMPLES);
        let filled = 0;
        while (filled < TTS_FRAME_SAMPLES && this.chunks.length) {
            const chunk = this.chunks[0];
            const n = Math.min(TTS_FRAME_SAMPLES - filled, chunk.length - this.offset);
            frame.set(chunk.subarray(this.offset, this.offset + n), filled);
            filled += n;
            this.offset += n;
            if (this.offset >= chunk.length) {
                this.chunks.shift();
                this.offset = 0;
            }
        }
        this.buffered -= filled;
        return frame;
    }

    /** Settles when something changed: audio came in, the reply ended, or `nudge()` was called. */
    changed(): Promise<void> {
        return new Promise((resolve) => (this.waiter = resolve));
    }

    nudge(): void {
        const waiter = this.waiter;
        this.waiter = undefined;
        waiter?.();
    }

    private async pump(open: () => AsyncIterable<Int16Array>): Promise<void> {
        let iterator: AsyncIterator<Int16Array> | undefined;
        try {
            iterator = open()[Symbol.asyncIterator]();
            while (!this.options.signal.aborted && this.received < this.options.capSamples) {
                const next = await this.within(iterator);
                if (next.done) break;
                if (this.options.signal.aborted) break;
                if (next.value.length === 0) continue;
                this.chunks.push(next.value);
                this.buffered += next.value.length;
                this.received += next.value.length;
                this.nudge();
            }
        } catch (error) {
            // A connector that throws because it was told to stop (an aborted request) has not failed
            if (this.options.signal.aborted) return;
            const status = statusOf(error);
            this.failure = status === undefined ? {} : { status };
        } finally {
            this.ended = true;
            // The provider call is closed; a generator stuck on a slow provider finishes when its signal fires
            void Promise.resolve(iterator?.return?.()).catch(() => undefined);
            this.nudge();
        }
    }

    /** The next piece of audio, or done when aborted, or an error when the provider is too slow. */
    private within(iterator: AsyncIterator<Int16Array>): Promise<IteratorResult<Int16Array>> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new ProviderError('no audio in time')), this.options.timeoutMs);
            const aborted = () => resolve({ done: true, value: undefined });
            this.options.signal.addEventListener('abort', aborted, { once: true });
            iterator.next().then(resolve, reject).finally(() => {
                clearTimeout(timer);
                this.options.signal.removeEventListener('abort', aborted);
            });
        });
    }
}
