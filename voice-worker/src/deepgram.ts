// Hearing with Deepgram (#1748): one real-time WebSocket stream per stretch of speech. The key goes in the Authorization
// header of that one connection and nowhere else. Deepgram answers in segments: a segment that is not final is replaced by
// the next answer, a final one is kept, so what the person said so far is the final segments followed by the latest guess.
import WebSocket from 'ws';
import { ProviderError, type RecognitionConnector, type RecognitionSettings } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { termsWithin } from './terms.ts';

export const DEEPGRAM_ADAPTER = 'deepgram';
export const DEEPGRAM_ENDPOINT = 'wss://api.deepgram.com/v1/listen';
/** Used when the profile names no model. */
export const DEFAULT_DEEPGRAM_MODEL = 'nova-3';
/** How long the last words may take after the person paused, before the stream counts as failed. */
export const DEFAULT_DEEPGRAM_FINAL_TIMEOUT_MS = 10_000;
/** Audio held while the connection opens. Past this the oldest goes: a stream that slow is failing anyway. */
const MAX_PENDING_MS = 10_000;

/** Deepgram takes 500 tokens of key terms in all (https://developers.deepgram.com/docs/keyterm), and a stream over it is refused. A name is a few tokens: this keeps well under. */
const MAX_KEYTERM_CHARS = 200;
/** How long a model and language Deepgram refused key terms for are connected to without them. */
const KEYTERM_REFUSED_MS = 60 * 60 * 1000;

export interface DeepgramOptions {
    finalTimeoutMs?: number;
}

interface DeepgramAnswer {
    type?: unknown;
    is_final?: unknown;
    channel?: { alternatives?: unknown };
}

export class DeepgramRecognition implements RecognitionConnector {
    /** Model and language Deepgram answered 400 to when key terms were sent, and when that was: they connect without for a while. */
    private readonly keytermRefused = new Map<string, number>();

    constructor(private readonly options: DeepgramOptions = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        const kind = `${settings.model || DEFAULT_DEEPGRAM_MODEL}|${settings.language ?? ''}`;
        const refusedAt = this.keytermRefused.get(kind);
        const refused = refusedAt !== undefined && Date.now() - refusedAt < KEYTERM_REFUSED_MS;
        const keyterms = refused ? [] : keytermsFor(settings);
        return new DeepgramStream(settings, events, this.options.finalTimeoutMs ?? DEFAULT_DEEPGRAM_FINAL_TIMEOUT_MS, keyterms, () => this.keytermRefused.set(kind, Date.now()));
    }
}

/**
 * The names to send as key terms: only Nova-3 takes them (an older model has a different feature and is refused), and only
 * as many as fit. The bot's own name comes first.
 */
export function keytermsFor(settings: RecognitionSettings): string[] {
    const model = settings.model || DEFAULT_DEEPGRAM_MODEL;
    return /^nova-3\b/.test(model) ? termsWithin(settings.terms ?? [], MAX_KEYTERM_CHARS) : [];
}

/** The address of one stream: 16 kHz mono s16le, guesses on, and no cutting by Deepgram (the worker decides where speech ends). */
function streamUrl(settings: RecognitionSettings, keyterms: readonly string[]): string {
    const url = new URL(settings.endpoint || DEEPGRAM_ENDPOINT);
    const query = url.searchParams;
    const model = settings.model || DEFAULT_DEEPGRAM_MODEL;
    query.set('model', model);
    query.set('encoding', 'linear16');
    query.set('sample_rate', '16000');
    query.set('channels', '1');
    query.set('interim_results', 'true');
    query.set('endpointing', 'false');
    query.set('smart_format', 'true');
    // What the person says is not used to train Deepgram's models (https://developers.deepgram.com/trust-security/your-data)
    query.set('mip_opt_out', 'true');
    // A fixed language is sent as the profile has it ("ar-KW"). A profile that follows the person listens in every language
    // the model knows: left out, Deepgram would hear English only (its default is "en"); "multi" also follows a person who
    // switches language mid-sentence (https://developers.deepgram.com/docs/language)
    const language = settings.language || followLanguage(model);
    if (language) query.set('language', language);
    // Names to expect, one parameter each (Nova-3, https://developers.deepgram.com/docs/keyterm)
    for (const keyterm of keyterms) query.append('keyterm', keyterm);
    return url.toString();
}

/** "multi" for the models that hear several languages in one stream (Nova-3 and Nova-2); an older model keeps Deepgram's default. */
export function followLanguage(model: string): string | undefined {
    return /^nova-[23]\b/.test(model) ? 'multi' : undefined;
}

class DeepgramStream implements Recognizer {
    private ws!: WebSocket;
    private pending: Buffer[] = [];
    private pendingMs = 0;
    private finalText = '';
    private liveText = '';
    private lastShown = '';
    private finishing = false;
    private done = false;
    private timer?: NodeJS.Timeout;

    constructor(
        private readonly settings: RecognitionSettings,
        private readonly events: RecognizerEvents,
        private readonly finalTimeoutMs: number,
        keyterms: readonly string[] = [],
        private readonly onKeytermRefused: () => void = () => undefined
    ) {
        this.connect(keyterms);
    }

    private connect(keyterms: readonly string[]): void {
        const ws = (this.ws = new WebSocket(streamUrl(this.settings, keyterms), { headers: { Authorization: `Token ${this.settings.key.reveal()}` } }));
        ws.on('open', () => {
            for (const chunk of this.pending) ws.send(chunk);
            this.pending = [];
            this.pendingMs = 0;
            if (this.finishing) this.endAudio();
        });
        ws.on('message', (data, isBinary) => {
            if (isBinary) return;
            // Nothing Deepgram sends may throw out of here: a socket handler that throws takes the whole worker down
            try {
                this.answer(data.toString());
            } catch {
                this.fail(new ProviderError('deepgram sent an answer that could not be read'));
            }
        });
        // Refused before the stream started (a wrong key answers 401 here)
        ws.on('unexpected-response', (_req, res) => {
            res.resume();
            ws.terminate();
            // A model that does not take key terms answers 400 to them. The audio is still held, so the stretch is opened again
            // without them rather than lost, and the next ones skip them for a while
            if (res.statusCode === 400 && keyterms.length > 0 && !this.done) {
                ws.removeAllListeners();
                ws.on('error', () => undefined);
                this.onKeytermRefused();
                this.connect([]);
                return;
            }
            this.fail(new ProviderError('deepgram refused the connection', res.statusCode));
        });
        ws.on('error', () => this.fail(new ProviderError('deepgram connection error')));
        // After the audio ended, Deepgram sends the last words and closes the stream normally
        ws.on('close', (code) => {
            if (this.finishing && code === 1000) this.complete();
            else this.fail(new ProviderError('deepgram closed the stream before the last words'));
        });
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
        if (this.ws.readyState === WebSocket.OPEN) this.endAudio();
        this.timer = setTimeout(() => this.fail(new ProviderError('deepgram took too long for the last words')), this.finalTimeoutMs);
        this.timer.unref?.();
    }

    close(): void {
        if (this.done) return;
        this.done = true;
        this.stop();
    }

    /** Deepgram answers CloseStream with the last words, then Metadata, then closes the stream. */
    private endAudio(): void {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
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
        const message = parsed as DeepgramAnswer;
        if (message.type === 'Error') {
            this.fail(new ProviderError('deepgram answered with an error'));
            return;
        }
        // Metadata is the last thing Deepgram sends once the audio has ended
        if (message.type === 'Metadata') {
            if (this.finishing) this.complete();
            return;
        }
        if (message.type !== 'Results') return;
        const alternatives: unknown[] = Array.isArray(message.channel?.alternatives) ? (message.channel.alternatives as unknown[]) : [];
        const first = alternatives[0];
        const transcript = typeof first === 'object' && first !== null ? (first as { transcript?: unknown }).transcript : undefined;
        if (typeof transcript !== 'string') return;
        const text = transcript.trim();
        if (message.is_final === true) {
            if (text) this.finalText = `${this.finalText} ${text}`;
            this.liveText = '';
        } else {
            this.liveText = text;
        }
        const heard = this.heard();
        // A guess revised to nothing is shown too, so the stretch does not keep words Deepgram has taken back
        if (heard !== this.lastShown) {
            this.lastShown = heard;
            this.events.partial(heard);
        }
    }

    private heard(): string {
        return `${this.finalText} ${this.liveText}`.replace(/\s+/g, ' ').trim();
    }

    private complete(): void {
        if (this.done) return;
        this.done = true;
        this.stop();
        this.events.final(this.heard());
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
