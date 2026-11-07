// Hearing by upload, for companies with no live stream: the stretch of speech is held in memory, and when the person pauses
// it is sent as one WAV file and the words come back in the answer. Nothing shows while the person speaks, and the words
// come a little later than with a stream. The audio is dropped as soon as the answer comes, and never kept.
import { type RecognitionConnector, type RecognitionSettings } from '../connectors.ts';
import type { Recognizer, RecognizerEvents } from '../recognizer.ts';
import { answerStatus, readSome, type CreditCheck } from './errors.ts';
import type { HttpCall } from './httpSpeech.ts';
import { wavFile } from './pcm.ts';

export const HEARING_RATE = 16_000;
/** The longest stretch sent. Recognition.ts ends a stretch long before this; it only bounds memory. */
export const DEFAULT_MAX_UPLOAD_SECONDS = 120;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

export interface UploadHearingSpec {
    adapter: string;
    endpoint: string;
    /** The request that sends this WAV file (16 kHz mono s16). */
    request(settings: RecognitionSettings, wav: Uint8Array, base: string): HttpCall;
    /** The words in the company's answer. */
    read(answer: unknown): string;
    outOfCredit?: CreditCheck;
    maxSeconds?: number;
    timeoutMs?: number;
}

/** A hearing connector made from a spec. */
export function uploadHearing(spec: UploadHearingSpec): RecognitionConnector {
    return { listen: (settings, events) => new UploadStretch(spec, settings, events) };
}

class UploadStretch implements Recognizer {
    private chunks: Int16Array[] = [];
    private samples = 0;
    private finishing = false;
    private done = false;
    private readonly abort = new AbortController();
    private timer?: NodeJS.Timeout;

    constructor(private readonly spec: UploadHearingSpec, private readonly settings: RecognitionSettings, private readonly events: RecognizerEvents) {}

    push(pcm16k: Int16Array): void {
        if (this.done || this.finishing) return;
        const room = (this.spec.maxSeconds ?? DEFAULT_MAX_UPLOAD_SECONDS) * HEARING_RATE - this.samples;
        if (room <= 0) return;
        // Copied: the caller may reuse its buffer
        const piece = pcm16k.slice(0, room);
        this.chunks.push(piece);
        this.samples += piece.length;
    }

    finish(): void {
        if (this.done || this.finishing) return;
        this.finishing = true;
        if (this.samples === 0) return this.end('');
        const all = new Int16Array(this.samples);
        let at = 0;
        for (const chunk of this.chunks) {
            all.set(chunk, at);
            at += chunk.length;
        }
        this.chunks = [];
        // Stopping aborts the call
        this.timer = setTimeout(() => this.fail(undefined), this.spec.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS);
        this.timer.unref?.();
        void this.send(wavFile(all, HEARING_RATE));
    }

    close(): void {
        if (this.done) return;
        this.done = true;
        this.stop();
    }

    private async send(wav: Uint8Array): Promise<void> {
        const base = (this.settings.endpoint || this.spec.endpoint).replace(/\/+$/, '');
        let call: HttpCall;
        try {
            call = this.spec.request(this.settings, wav, base);
        } catch (error) {
            return this.fail(error instanceof Error && error.name === 'ProviderError' ? (error as { status?: number }).status : undefined);
        }
        const url = /^[a-z]+:\/\//i.test(call.url) ? call.url : `${base}${call.url.startsWith('/') ? '' : '/'}${call.url}`;
        let response: Response;
        try {
            response = await fetch(url, { method: call.method ?? 'POST', headers: call.headers, body: call.body, signal: this.abort.signal, redirect: 'manual' });
        } catch {
            return this.fail(undefined);
        }
        if (!response.ok) {
            const body = await readSome(response.body);
            return this.fail(answerStatus(response.status, body, this.spec.outOfCredit));
        }
        let text: string;
        try {
            text = this.spec.read(await response.json());
        } catch {
            return this.fail(undefined);
        }
        this.end(typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '');
    }

    private end(text: string): void {
        if (this.done) return;
        this.done = true;
        this.stop();
        this.events.final(text);
    }

    private fail(status: number | undefined): void {
        if (this.done) return;
        this.done = true;
        this.stop();
        this.events.failed('', status === undefined ? undefined : { status });
    }

    private stop(): void {
        clearTimeout(this.timer);
        this.chunks = [];
        if (!this.abort.signal.aborted) this.abort.abort();
    }
}
