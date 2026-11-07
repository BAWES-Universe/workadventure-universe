// Hearing over a WebSocket, one socket per stretch of speech. A company spec says how to open the socket, how audio and
// the end of it are sent, and how to read an answer; this file does the rest the same way for every company: holding audio
// while the socket opens, keeping the words heard so far, waiting for the last words, and saying why it failed.
import WebSocket from 'ws';
import { ProviderError, type RecognitionConnector, type RecognitionSettings } from '../connectors.ts';
import type { Recognizer, RecognizerEvents } from '../recognizer.ts';
import { answerStatus, failure, type CreditCheck } from './errors.ts';
import { pcmBytes } from './pcm.ts';
import type { SocketAddress } from './socketSpeech.ts';

/** What one answer from the company holds. */
export interface HearingMessage {
    /** Words that will not change: added to what was heard. */
    committed?: string;
    /** Words that may still change: they replace the last ones that could. */
    interim?: string;
    /** The company heard the person finish what they were saying. */
    endpoint?: boolean;
    /** The company sent the last words after the end of the audio. */
    finished?: boolean;
    /** The company accepted the setup and now takes audio (only read when the spec sets `readyFirst`). */
    ready?: boolean;
    error?: { status?: number };
}

export interface SocketHearingSpec {
    adapter: string;
    endpoint: string;
    /** Where to connect. May ask the company first (Gladia hands out a session address). */
    connect(settings: RecognitionSettings, base: string): SocketAddress | Promise<SocketAddress>;
    /** Messages sent once the socket opens, before any audio: usually the setup. */
    start?(settings: RecognitionSettings): (string | Uint8Array)[];
    /** The company answers the setup before it takes audio (Meta): audio is held until an answer says `ready`. */
    readyFirst?: boolean;
    /** Messages sent once the company says `ready`, before any audio (Mistral: the session's settings). */
    whenReady?(settings: RecognitionSettings): (string | Uint8Array)[];
    /** One piece of 16 kHz mono s16 audio as the company takes it. Default: the raw bytes, as a binary message. */
    frame?(pcm16k: Int16Array): string | Uint8Array;
    /** Messages that end the audio, after which the company sends the last words. */
    finish(settings: RecognitionSettings): (string | Uint8Array)[];
    read(data: Buffer, isBinary: boolean): HearingMessage | HearingMessage[] | undefined;
    /** How committed pieces join: with a space (whole words or phrases, the default) or as they are (tokens with their own spaces). */
    join?: 'words' | 'tokens';
    /** The company closes the socket after the last words instead of saying so. */
    closeIsFinished?: boolean;
    /** The company says why with the close itself (AssemblyAI: 1008 "Invalid API key"): what that close means, if anything. */
    closed?(code: number, reason: string): HearingMessage | undefined;
    /** Set when the company detects the end of speech itself: quiet this long still ends a stretch. */
    pauseMs?: number;
    /** How long the last words may take after finish(). Default 10 s. */
    finalTimeoutMs?: number;
    /**
     * The company answers the end of the audio with one more answer and never says "finished" (Sarvam answers a flush with one
     * transcript): the first words after finish() end the stretch, and with none within `quietMs`, it ends with what was heard.
     */
    lastAnswerAfterFinish?: { quietMs: number };
    outOfCredit?: CreditCheck;
}

/** Audio held while the socket opens. Past this the oldest goes: a socket that slow is failing anyway. */
const MAX_PENDING_MS = 10_000;
export const DEFAULT_FINAL_TIMEOUT_MS = 10_000;

/** A hearing connector made from a spec. */
export function socketHearing(spec: SocketHearingSpec): RecognitionConnector {
    return { listen: (settings, events) => new SocketStream(spec, settings, events) };
}

class SocketStream implements Recognizer {
    private ws?: WebSocket;
    private pending: (string | Uint8Array)[] = [];
    private pendingMs = 0;
    private committed = '';
    private interim = '';
    private lastShown = '';
    private finishing = false;
    private done = false;
    private endpointed = false;
    /** The socket is open and the company takes audio. */
    private accepting = false;
    private timer?: NodeJS.Timeout;
    readonly pauseMs?: number;

    constructor(private readonly spec: SocketHearingSpec, private readonly settings: RecognitionSettings, private readonly events: RecognizerEvents) {
        this.pauseMs = spec.pauseMs;
        const base = (settings.endpoint || spec.endpoint).replace(/\/+$/, '');
        let address: SocketAddress | Promise<SocketAddress>;
        try {
            address = spec.connect(settings, base);
        } catch (error) {
            address = Promise.reject(error);
        }
        Promise.resolve(address)
            .then((resolved) => this.open(resolved))
            .catch((error: unknown) => this.fail(error instanceof ProviderError ? error : failure(spec.adapter, 'could not be reached')));
    }

    push(pcm16k: Int16Array): void {
        if (this.done || this.finishing || pcm16k.length === 0) return;
        let message: string | Uint8Array;
        try {
            message = this.spec.frame ? this.spec.frame(pcm16k) : pcmBytes(pcm16k);
        } catch {
            return this.fail(failure(this.spec.adapter, 'audio could not be prepared'));
        }
        if (this.accepting && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(message);
            return;
        }
        // Copied: the caller may reuse its buffer
        this.pending.push(typeof message === 'string' ? message : Uint8Array.from(message));
        this.pendingMs += pcm16k.length / 16;
        while (this.pendingMs > MAX_PENDING_MS && this.pending.length > 1) {
            const dropped = this.pending.shift()!;
            this.pendingMs -= (typeof dropped === 'string' ? (dropped.length * 3) / 4 : dropped.length) / 32;
        }
    }

    finish(): void {
        if (this.done || this.finishing) return;
        this.finishing = true;
        if (this.accepting && this.ws?.readyState === WebSocket.OPEN) this.sendFinish();
        const last = this.spec.lastAnswerAfterFinish;
        this.timer = last
            ? setTimeout(() => this.end(), last.quietMs)
            : setTimeout(() => this.fail(failure(this.spec.adapter, 'took too long for the last words')), this.spec.finalTimeoutMs ?? DEFAULT_FINAL_TIMEOUT_MS);
        this.timer.unref?.();
    }

    close(): void {
        if (this.done) return;
        this.done = true;
        this.stop();
    }

    private open(address: SocketAddress): void {
        if (this.done) return;
        let ws: WebSocket;
        try {
            // Throws at once on a bad address or a header value it can't send (a key pasted with a line break)
            ws = new WebSocket(address.url, address.protocols, { headers: address.headers });
        } catch {
            return this.fail(failure(this.spec.adapter, 'could not be reached'));
        }
        this.ws = ws;
        ws.on('open', () => {
            if (this.done) return;
            try {
                for (const message of this.spec.start?.(this.settings) ?? []) ws.send(message);
            } catch {
                return this.fail(failure(this.spec.adapter, 'could not be sent the audio'));
            }
            if (!this.spec.readyFirst) this.accept();
        });
        ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
            // Nothing the company sends may throw out of here: a socket handler that throws takes the whole worker down
            try {
                const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
                this.answer(this.spec.read(buffer, isBinary));
            } catch {
                this.fail(failure(this.spec.adapter, 'sent an answer that could not be read'));
            }
        });
        // Refused before the stream started (a wrong key answers 401 here)
        ws.on('unexpected-response', (_req, res) => {
            let body = '';
            res.on('data', (d: Buffer) => {
                if (body.length < 4096) body += d.toString('utf8');
            });
            res.on('end', () => this.fail(failure(this.spec.adapter, 'refused the connection', answerStatus(res.statusCode ?? 0, body, this.spec.outOfCredit))));
            res.on('error', () => this.fail(failure(this.spec.adapter, 'refused the connection', res.statusCode)));
        });
        ws.on('error', () => this.fail(failure(this.spec.adapter, 'connection error')));
        ws.on('close', (code: number, reason: Buffer) => {
            let told: HearingMessage | undefined;
            try {
                told = this.spec.closed?.(code, reason.toString('utf8'));
            } catch {
                told = undefined;
            }
            if (told) this.answer(told);
            if (this.done) return;
            if (this.spec.closeIsFinished && this.finishing) return this.end();
            this.fail(failure(this.spec.adapter, 'closed the stream before the last words'));
        });
    }

    /** Sends the audio held so far, and the end of it when that already came; from now on audio goes straight out. */
    private accept(): void {
        if (this.accepting || this.done) return;
        this.accepting = true;
        try {
            if (this.spec.readyFirst) for (const message of this.spec.whenReady?.(this.settings) ?? []) this.ws?.send(message);
            for (const message of this.pending) this.ws?.send(message);
            this.pending = [];
            this.pendingMs = 0;
            if (this.finishing) this.sendFinish();
        } catch {
            this.fail(failure(this.spec.adapter, 'could not be sent the audio'));
        }
    }

    private sendFinish(): void {
        for (const message of this.spec.finish(this.settings)) this.ws?.send(message);
    }

    private answer(answer: HearingMessage | HearingMessage[] | undefined): void {
        if (this.done || !answer) return;
        for (const message of Array.isArray(answer) ? answer : [answer]) {
            if (this.done) return;
            if (message.error) return this.fail(failure(this.spec.adapter, 'answered with an error', message.error.status));
            if (message.ready) this.accept();
            if (message.committed) {
                const glue = this.spec.join === 'tokens' || !this.committed ? '' : ' ';
                this.committed += glue + message.committed;
                this.interim = '';
            }
            if (message.interim !== undefined) this.interim = message.interim;
            if (message.finished) return this.end();
            const heard = this.heard();
            if (heard && heard !== this.lastShown) {
                this.lastShown = heard;
                this.events.partial(heard);
            }
            // Said once; the stretch then ends with finish()
            if (message.endpoint && !this.endpointed && !this.finishing) {
                this.endpointed = true;
                this.events.endpoint?.();
            }
            if (this.finishing && this.spec.lastAnswerAfterFinish && (message.committed !== undefined || message.interim !== undefined)) return this.end();
        }
    }

    private heard(): string {
        const glue = this.spec.join === 'tokens' ? '' : ' ';
        return (this.committed + (this.interim ? glue + this.interim : '')).replace(/\s+/g, ' ').trim();
    }

    private end(): void {
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
        const ws = this.ws;
        if (!ws) return;
        ws.removeAllListeners();
        ws.on('error', () => undefined);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
    }
}
