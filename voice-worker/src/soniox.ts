// Hearing with Soniox (#1748): one real-time WebSocket stream per stretch of speech. The key goes in the Authorization
// header of that one connection and nowhere else. Words arrive as tokens: final ones are kept, the rest are replaced by
// the next answer, so what the person said so far is the final tokens followed by the latest non-final ones.
import WebSocket from 'ws';
import { ProviderError, type RecognitionConnector, type RecognitionSettings } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { termsWithin } from './terms.ts';

export const SONIOX_ADAPTER = 'soniox';
export const SONIOX_ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';
/** How long the last words may take after the person paused, before the stream counts as failed. */
export const DEFAULT_SONIOX_FINAL_TIMEOUT_MS = 10_000;
/** Audio held while the connection opens. Past this the oldest goes: a stream that slow is failing anyway. */
const MAX_PENDING_MS = 10_000;

/** The current real-time model (https://docs.soniox.com/stt/models). */
export const SONIOX_CURRENT_MODEL = 'stt-rt-v6';
/**
 * Real-time models Soniox has retired or deprecated: stt-rt-v5 is removed on 15 Dec 2026 (stt-rt-v4 is its alias), and
 * the older ones are already served by their successors. A profile that still names one listens with the current model,
 * as Soniox's own upgrade notes say to.
 */
export const SONIOX_SUPERSEDED = new Set(['stt-rt-v5', 'stt-rt-v4', 'stt-rt-v3', 'stt-rt-preview', 'stt-rt-preview-v2', 'stt-rt-preview-v1']);

/** The model a stream is opened with: the profile's, or the current one when Soniox has retired it. */
export const currentSonioxModel = (model: string): string => (SONIOX_SUPERSEDED.has(model) ? SONIOX_CURRENT_MODEL : model);

/**
 * Soniox's own end-of-speech detection (https://docs.soniox.com/stt/rt/endpoint-detection), with the starting point it
 * recommends for voice AI: it hears that the person finished from what they said and how, so a bot answers a finished
 * sentence at once and waits through a mid-sentence pause. MAX_ENDPOINT_DELAY_MS is the most it waits after speech ends.
 */
export const MAX_ENDPOINT_DELAY_MS = 1500;
const ENDPOINT_TUNING = { endpoint_latency_adjustment_level: 2, endpoint_sensitivity: 0.3 };
/** The sensitivity and latency settings are taken from stt-rt-v5 on. */
const takesEndpointTuning = (model: string): boolean => Number(/^stt-rt-v(\d+)$/.exec(model)?.[1] ?? 0) >= 5;
/** Quiet that still ends a stretch when Soniox has not said so: its longest wait, and a little for the answer to arrive. */
export const SONIOX_FALLBACK_PAUSE_MS = MAX_ENDPOINT_DELAY_MS + 300;
/** Soniox takes at most 8,000 tokens (about 10,000 characters) of context (https://docs.soniox.com/stt/concepts/context); names are far under it. */
const MAX_TERMS_CHARS = 1000;

export interface SonioxOptions {
    finalTimeoutMs?: number;
}

interface SonioxToken {
    text?: unknown;
    is_final?: unknown;
}

interface SonioxAnswer {
    tokens?: unknown;
    finished?: unknown;
    error_code?: unknown;
}

/** Control tokens such as "<end>" or "<fin>" are not words. */
const isWord = (text: string): boolean => !/^<[a-z_]+>$/.test(text.trim());

export class SonioxRecognition implements RecognitionConnector {
    constructor(private readonly options: SonioxOptions = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return new SonioxStream(settings, events, this.options.finalTimeoutMs ?? DEFAULT_SONIOX_FINAL_TIMEOUT_MS);
    }
}

class SonioxStream implements Recognizer {
    private readonly ws: WebSocket;
    private pending: Buffer[] = [];
    private pendingMs = 0;
    private finalText = '';
    private liveText = '';
    private lastShown = '';
    private finishing = false;
    private done = false;
    private timer?: NodeJS.Timeout;
    private endpointed = false;
    readonly pauseMs = SONIOX_FALLBACK_PAUSE_MS;

    constructor(settings: RecognitionSettings, private readonly events: RecognizerEvents, private readonly finalTimeoutMs: number) {
        this.ws = new WebSocket(settings.endpoint || SONIOX_ENDPOINT, { headers: { Authorization: `Bearer ${settings.key.reveal()}` } });
        // The names as they are when this stretch of speech opens
        const terms = termsWithin(settings.terms ?? [], MAX_TERMS_CHARS);
        this.ws.on('open', () => {
            const model = currentSonioxModel(settings.model);
            const config: Record<string, unknown> = {
                model,
                audio_format: 's16le',
                sample_rate: 16000,
                num_channels: 1,
                enable_endpoint_detection: true,
                max_endpoint_delay_ms: MAX_ENDPOINT_DELAY_MS,
                ...(takesEndpointTuning(model) ? ENDPOINT_TUNING : {}),
            };
            // Names to expect, spelled as listed: "Nora" said in Arabic is written "Nora", not "نورا" (https://docs.soniox.com/stt/concepts/context)
            if (terms.length) config.context = { terms };
            // Soniox takes plain language codes ("ar"), not regional ones ("ar-KW")
            if (settings.language) config.language_hints = [settings.language.split(/[-_]/)[0].toLowerCase()];
            this.ws.send(JSON.stringify(config));
            for (const chunk of this.pending) this.ws.send(chunk);
            this.pending = [];
            this.pendingMs = 0;
            if (this.finishing) this.ws.send('');
        });
        this.ws.on('message', (data, isBinary) => {
            if (isBinary) return;
            // Nothing Soniox sends may throw out of here: a socket handler that throws takes the whole worker down
            try {
                this.answer(data.toString());
            } catch {
                this.fail(new ProviderError('soniox sent an answer that could not be read'));
            }
        });
        // Refused before the stream started (a wrong key answers 401 here)
        this.ws.on('unexpected-response', (_req, res) => {
            this.fail(new ProviderError('soniox refused the connection', res.statusCode));
            res.resume();
            this.ws.terminate();
        });
        this.ws.on('error', () => this.fail(new ProviderError('soniox connection error')));
        this.ws.on('close', () => this.fail(new ProviderError('soniox closed the stream before the last words')));
    }

    push(pcm16k: Int16Array): void {
        if (this.done || this.finishing) return;
        const chunk = Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(chunk);
            return;
        }
        // Copied: the caller may reuse its buffer
        this.pending.push(Buffer.from(chunk));
        this.pendingMs += pcm16k.length / 16;
        while (this.pendingMs > MAX_PENDING_MS && this.pending.length > 1) this.pendingMs -= this.pending.shift()!.length / 32;
    }

    finish(): void {
        if (this.done || this.finishing) return;
        this.finishing = true;
        // An empty text frame ends the audio: Soniox sends the last words, then `finished`
        if (this.ws.readyState === WebSocket.OPEN) this.ws.send('');
        this.timer = setTimeout(() => this.fail(new ProviderError('soniox took too long for the last words')), this.finalTimeoutMs);
        this.timer.unref?.();
    }

    close(): void {
        if (this.done) return;
        this.done = true;
        this.stop();
    }

    private answer(raw: string): void {
        if (this.done) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        // Anything but an object is not an answer: skipped like a line that is not JSON
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
        const message = parsed as SonioxAnswer;
        if (typeof message.error_code === 'number') {
            this.fail(new ProviderError('soniox answered with an error', message.error_code));
            return;
        }
        let live = '';
        let ended = false;
        const tokens: unknown[] = Array.isArray(message.tokens) ? message.tokens : [];
        for (const item of tokens) {
            if (typeof item !== 'object' || item === null) continue;
            const token = item as SonioxToken;
            if (typeof token.text !== 'string') continue;
            if (token.text.trim() === '<end>') ended = true;
            if (!isWord(token.text)) continue;
            if (token.is_final === true) this.finalText += token.text;
            else live += token.text;
        }
        this.liveText = live;
        if (message.finished === true) {
            this.done = true;
            this.stop();
            this.events.final(this.heard());
            return;
        }
        const heard = this.heard();
        if (heard && heard !== this.lastShown) {
            this.lastShown = heard;
            this.events.partial(heard);
        }
        // Soniox heard the person finish: every word before it is final. Said once; the stretch then ends with finish()
        if (ended && !this.endpointed && !this.finishing) {
            this.endpointed = true;
            this.events.endpoint?.();
        }
    }

    private heard(): string {
        return (this.finalText + this.liveText).replace(/\s+/g, ' ').trim();
    }

    private fail(error: ProviderError): void {
        if (this.done) return;
        this.done = true;
        this.stop();
        this.events.failed(this.heard(), error.status === undefined ? undefined : { status: error.status });
    }

    private stop(): void {
        clearTimeout(this.timer);
        this.pending = [];
        this.ws.removeAllListeners('close');
        this.ws.on('error', () => undefined);
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    }
}
