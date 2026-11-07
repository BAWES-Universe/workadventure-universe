// One spoken line, once, with no bubble (#1852): the bot page's "Hear <bot> say hello". The bot server asks over HTTP with the
// same provider settings a bubble would open with, and gets the audio back as one WAV file to play in the maker's browser. It
// goes through the same speech connector a bubble's reply does, so what the maker hears is what a person in a bubble hears
// (including a model that is served only over a WebSocket, such as eleven_v4_turbo), with the same reply cap and the same wait for
// the provider's next piece of audio. Nothing is kept: no lane, no session, and the key lives only in this call.
import { ConnectorRegistry, Secret, type SpeechSettings, isRejection } from './connectors.ts';
import { EXPRESSIONS, type Expression } from './protocol.ts';
import { FRAME_MS, TTS_FRAME_SAMPLES, TTS_RATE } from './audioFormat.ts';
import { ReplyStream } from './replyStream.ts';

/** The longest line a preview speaks, in characters. The bot server sends a short hello; anything longer is refused. */
export const MAX_PREVIEW_CHARACTERS = 1000;
/** The default for how long one preview may play, in seconds (`VOICE_MAX_PREVIEW_SECONDS`). */
export const DEFAULT_MAX_PREVIEW_SECONDS = 20;
/** The default for how many previews are made at once (`VOICE_MAX_PREVIEWS`). More are told to come back. */
export const DEFAULT_MAX_PREVIEWS = 8;

/** What the bot server asks for: the settings of `session.open`'s `speech`, and the words. */
export interface PreviewRequest {
    speech: { adapter: string; model: string; voiceId: string; key?: string; endpoint?: string; region?: string; language?: string };
    text: string;
    lang?: string;
    expression?: Expression;
    /** The longest the line may play, in seconds; the worker's own limit still applies. */
    maxSeconds?: number;
}

/** Why a preview did not become audio. `status`: the provider's HTTP status, when it answered with one. */
export type PreviewFailure =
    | { kind: 'bad_request'; message: string }
    | { kind: 'no_adapter' }
    | { kind: 'busy' }
    | { kind: 'provider'; status?: number; rejected: boolean };

export interface PreviewHost {
    connectors: ConnectorRegistry;
    /** The longest wait for the next piece of audio before the provider counts as failed, in milliseconds. */
    speechTimeoutMs: number;
    /** The longest any preview plays, in milliseconds. */
    maxPreviewMs: number;
    /** How many previews may be made at once. */
    maxPreviews: number;
    inc(counter: string, by?: number): void;
}

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number): boolean => value === undefined || isText(value, max);

/** The request as a typed value, or the reason it is not one. Nothing from it is ever put in the reason. */
export function readPreviewRequest(body: unknown): PreviewRequest | string {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'the request is not an object';
    const { speech, text, lang, expression, maxSeconds } = body as Record<string, unknown>;
    if (!isText(text, MAX_PREVIEW_CHARACTERS) || !text.trim()) return 'text is missing or too long';
    if (typeof speech !== 'object' || speech === null || Array.isArray(speech)) return 'speech is missing';
    const s = speech as Record<string, unknown>;
    if (!isText(s.adapter, 64) || !isText(s.model, 128) || !isText(s.voiceId, 256) || !optionalText(s.key, 4096)) return 'speech needs an adapter, a model and a voiceId, and its key, when it has one';
    if (!optionalText(s.endpoint, 2048) || !optionalText(s.region, 64) || !optionalText(s.language, 32)) return 'speech has a field that is not text';
    if (!optionalText(lang, 32)) return 'lang is not text';
    if (expression !== undefined && !EXPRESSIONS.includes(expression as Expression)) return 'expression is not one of the three';
    if (maxSeconds !== undefined && !(typeof maxSeconds === 'number' && Number.isFinite(maxSeconds) && maxSeconds > 0)) return 'maxSeconds is not a positive number';
    return {
        speech: { adapter: s.adapter, model: s.model, voiceId: s.voiceId, key: s.key as string | undefined, endpoint: s.endpoint as string | undefined, region: s.region as string | undefined, language: s.language as string | undefined },
        text,
        lang: lang as string | undefined,
        expression: expression as Expression | undefined,
        maxSeconds: maxSeconds as number | undefined,
    };
}

/** 24 kHz mono s16 as a WAV file. */
export function wavOf(pcm: Int16Array): Buffer {
    const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVEfmt ', 8, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(TTS_RATE, 24);
    header.writeUInt32LE(TTS_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

export class Previewer {
    private active = 0;

    constructor(private readonly host: PreviewHost) {}

    /** The line as audio. `signal`: the asker went away, so the provider call is closed. Rejects with a PreviewFailure. */
    async render(request: PreviewRequest, signal: AbortSignal): Promise<{ wav: Buffer; ms: number }> {
        const connector = this.host.connectors.speech(request.speech.adapter);
        if (!connector) throw { kind: 'no_adapter' } satisfies PreviewFailure;
        if (this.active >= this.host.maxPreviews) {
            this.host.inc('previews_refused');
            throw { kind: 'busy' } satisfies PreviewFailure;
        }
        this.active++;
        const stop = new AbortController();
        const onAbort = (): void => stop.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        try {
            const speech = request.speech;
            const settings: SpeechSettings = { adapter: speech.adapter, model: speech.model, voiceId: speech.voiceId, key: new Secret(speech.key ?? ''), endpoint: speech.endpoint, region: speech.region, language: speech.language };
            const maxMs = Math.min(request.maxSeconds ? request.maxSeconds * 1000 : this.host.maxPreviewMs, this.host.maxPreviewMs);
            const capSamples = Math.ceil(maxMs / FRAME_MS) * TTS_FRAME_SAMPLES;
            const stream = new ReplyStream(() => connector.speak({ text: request.text, settings, lang: request.lang ?? settings.language, expression: request.expression, signal: stop.signal }), {
                signal: stop.signal,
                capSamples,
                timeoutMs: this.host.speechTimeoutMs,
            });
            const frames: Int16Array[] = [];
            while (true) {
                const frame = stream.take();
                if (frame) {
                    frames.push(frame);
                    continue;
                }
                if (stream.ended) break;
                await stream.changed();
            }
            if (signal.aborted) throw { kind: 'provider', rejected: false } satisfies PreviewFailure;
            if (stream.failure !== undefined || stream.received === 0) {
                this.host.inc('previews_failed');
                const status = stream.failure?.status;
                throw { kind: 'provider', ...(status !== undefined ? { status } : {}), rejected: isRejection(status) } satisfies PreviewFailure;
            }
            const pcm = new Int16Array(frames.length * TTS_FRAME_SAMPLES);
            frames.forEach((frame, i) => pcm.set(frame, i * TTS_FRAME_SAMPLES));
            // The last frame is padded with silence to a whole frame, and the provider's last piece may run past the cap: the audio is what the provider made, up to the cap
            const samples = Math.min(stream.received, capSamples, pcm.length);
            this.host.inc('previews_made');
            this.host.inc('preview_ms', Math.round((samples / TTS_RATE) * 1000));
            return { wav: wavOf(pcm.subarray(0, samples)), ms: Math.round((samples / TTS_RATE) * 1000) };
        } finally {
            signal.removeEventListener('abort', onAbort);
            stop.abort();
            this.active--;
        }
    }
}
