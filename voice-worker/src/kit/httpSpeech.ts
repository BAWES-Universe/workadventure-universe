// Speaking over one streamed HTTP request per reply. A company spec says where to send the reply and where the audio is
// in the answer; this file does the rest the same way for every company: the call, aborting it when the reply is no longer
// wanted, turning bytes into 24 kHz samples, and saying why a call failed.
import { type SpeechConnector, type SpeechRequest } from '../connectors.ts';
import { answerStatus, failure, readSome, type CreditCheck } from './errors.ts';
import { decodeAudioText, PcmReader, Resampler } from './pcm.ts';

/** The worker plays speech at this rate. */
export const SPEECH_RATE = 24_000;

export interface HttpCall {
    /** The full address, or a path that is joined to the base address. */
    url: string;
    method?: 'POST' | 'GET';
    headers: Record<string, string>;
    body?: string | Uint8Array | FormData;
}

/** The answer is the audio itself: raw little-endian s16 PCM. */
export interface RawAudio {
    kind: 'raw';
    sampleRate: number;
    /** The company may put a WAV header first (its docs don't say): skipped rather than played as a click. */
    mayStartWithWav?: boolean;
}

/** What one line (or server-sent event) of a text answer holds. */
export interface AudioFrame {
    /** Audio as text, in the spec's encoding. */
    audio?: string;
    /** The company says the reply is complete. */
    done?: boolean;
    /** The company reports a failure inside the stream. */
    error?: { status?: number };
}

/** The answer is text, one JSON object per line (newline-delimited JSON or server-sent events), each holding audio as text. */
export interface FramedAudio {
    kind: 'lines';
    sampleRate: number;
    encoding: 'base64' | 'hex';
    /** The samples inside: s16 (the default) or 32-bit floats from -1 to 1 (Mistral), both little-endian. */
    samples?: 's16' | 'f32';
    /** The first audio may be a WAV file: its header is skipped. */
    mayStartWithWav?: boolean;
    /** Reads one message; for server-sent events, `event` is the name its `event:` line gave, when it had one. */
    read(message: unknown, event?: string): AudioFrame | undefined;
}

export interface HttpSpeechSpec {
    adapter: string;
    /** The company's address, used when the provider names none. */
    endpoint: string;
    call(request: SpeechRequest, base: string): HttpCall;
    audio: RawAudio | FramedAudio;
    outOfCredit?: CreditCheck;
}

/** Turns little-endian 32-bit float samples into s16 bytes, keeping a sample split across two pieces for the next one. */
export class Float32ToS16 {
    private carry = new Uint8Array(0);

    take(bytes: Uint8Array): Uint8Array {
        const all = new Uint8Array(this.carry.length + bytes.length);
        all.set(this.carry);
        all.set(bytes, this.carry.length);
        const whole = all.length - (all.length % 4);
        this.carry = all.slice(whole);
        const view = new DataView(all.buffer, all.byteOffset, whole);
        const out = new Uint8Array((whole / 4) * 2);
        const outView = new DataView(out.buffer);
        for (let i = 0; i < whole / 4; i += 1) {
            const value = view.getFloat32(i * 4, true);
            const clamped = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
            outView.setInt16(i * 2, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
        }
        return out;
    }
}

/** A speaking connector made from a spec. */
export function httpSpeech(spec: HttpSpeechSpec): SpeechConnector {
    return {
        speak: (request) => speakOverHttp(spec, request),
    };
}

async function* speakOverHttp(spec: HttpSpeechSpec, request: SpeechRequest): AsyncGenerator<Int16Array> {
    const base = (request.settings.endpoint || spec.endpoint).replace(/\/+$/, '');
    const call = spec.call(request, base);
    const url = /^[a-z]+:\/\//i.test(call.url) ? call.url : `${base}${call.url.startsWith('/') ? '' : '/'}${call.url}`;

    let response: Response;
    try {
        response = await fetch(url, { method: call.method ?? 'POST', headers: call.headers, body: call.body, signal: request.signal, redirect: 'manual' });
    } catch {
        if (request.signal.aborted) return;
        throw failure(spec.adapter, 'could not be reached');
    }
    if (!response.ok || !response.body) {
        const body = await readSome(response.body);
        throw failure(spec.adapter, 'refused the reply', answerStatus(response.status, body, spec.outOfCredit));
    }

    const reader = new PcmReader({ skipWavHeader: spec.audio.mayStartWithWav === true });
    const resampler = spec.audio.sampleRate === SPEECH_RATE ? undefined : new Resampler(spec.audio.sampleRate, SPEECH_RATE);
    const out = (samples: Int16Array | undefined): Int16Array | undefined => {
        if (!samples || samples.length === 0) return undefined;
        const ready = resampler ? resampler.process(samples) : samples;
        return ready.length > 0 ? ready : undefined;
    };

    try {
        if (spec.audio.kind === 'raw') {
            for await (const piece of response.body as AsyncIterable<Uint8Array>) {
                if (request.signal.aborted) return;
                const samples = out(reader.take(piece));
                if (samples) yield samples;
            }
        } else {
            const framed = spec.audio;
            const floats = framed.samples === 'f32' ? new Float32ToS16() : undefined;
            let text = '';
            const decoder = new TextDecoder();
            let finished = false;
            // The name an `event:` line gave the server-sent event now arriving; a blank line ends that event
            let eventName: string | undefined;
            const handle = function* (line: string): Generator<Int16Array> {
                const named = /^event:\s?(.*)$/.exec(line.trim());
                if (named) {
                    eventName = named[1].trim() || undefined;
                    return;
                }
                const trimmed = line.replace(/^data:\s?/, '').trim();
                if (!trimmed) eventName = undefined;
                if (!trimmed || trimmed.startsWith(':') || trimmed === '[DONE]' || /^(id|retry):/.test(trimmed)) return;
                let message: unknown;
                try {
                    message = JSON.parse(trimmed);
                } catch {
                    return;
                }
                const frame = framed.read(message, eventName);
                if (!frame) return;
                if (frame.error) throw failure(spec.adapter, 'reported an error in the reply', frame.error.status);
                if (frame.audio) {
                    const bytes = decodeAudioText(frame.audio, framed.encoding);
                    const samples = out(reader.take(floats ? floats.take(bytes) : bytes));
                    if (samples) yield samples;
                }
                if (frame.done) finished = true;
            };
            for await (const piece of response.body as AsyncIterable<Uint8Array>) {
                if (request.signal.aborted) return;
                text += decoder.decode(piece, { stream: true });
                const lines = text.split(/\r?\n/);
                text = lines.pop() ?? '';
                for (const line of lines) {
                    yield* handle(line);
                    if (finished) break;
                }
                if (finished) break;
            }
            if (!finished && text) yield* handle(text);
        }
        const rest = out(reader.flush());
        if (rest) yield rest;
    } catch (error) {
        if (request.signal.aborted) return;
        if (error instanceof Error && error.name === 'ProviderError') throw error;
        throw failure(spec.adapter, 'stream dropped');
    } finally {
        await response.body?.cancel().catch(() => undefined);
    }
}
