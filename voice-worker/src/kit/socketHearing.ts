// Hearing over a WebSocket, one socket per stretch of speech. A company spec says how to open the socket, how audio and
// the end of it are sent, and how to read an answer; this file does the rest the same way for every company: holding audio
// while the socket opens, keeping the words heard so far, waiting for the last words, and saying why it failed.
import WebSocket from 'ws';
import { ProviderError, type RecognitionConnector, type RecognitionSettings } from '../connectors.ts';
import type { Recognizer, RecognizerEvents } from '../recognizer.ts';
import { answerStatus, failure, type CreditCheck } from './errors.ts';
import { pcmBytes } from './pcm.ts';
import { letGo, type SocketAddress } from './socketSpeech.ts';

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
    /**
     * From the company's own speech detection (Sarvam's VAD signals): it heard speech start, or it answered speech it heard. With
     * `lastAnswerAfterFinish`, a stretch finished once every start it reported has its answer waits `settleMs`, not `quietMs`.
     */
    speech?: 'started' | 'answered';
    error?: { status?: number };
}

export interface SocketHearingSpec {
    adapter: string;
    endpoint: string;
    /** Where to connect. May ask the company first (Gladia hands out a session address). */
    connect(settings: RecognitionSettings, base: string): SocketAddress | Promise<SocketAddress>;
    /** Messages sent once the socket opens, before any audio: usually the setup. */
    start?(settings: RecognitionSettings): (string | Uint8Array)[];
    /**
     * Set when the company must answer the setup before it takes audio (Google's setupComplete): audio and the end of it wait for
     * the first answer this says yes to. That answer is not read as words.
     */
    ready?(data: Buffer, isBinary: boolean): boolean;
    /** Messages sent once the company is ready, before the audio held meanwhile (Google: the start of the person's speech). */
    afterReady?(settings: RecognitionSettings): (string | Uint8Array)[];
    /**
     * The company answers the setup before it takes audio, in an answer read like any other (Meta): audio is held until a read
     * answer says `ready`.
     */
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
    /**
     * Words can still come after `finished` (Google sends its transcription apart from the end of its turn): the stretch then ends
     * once nothing more has come for this long.
     */
    settleMs?: number;
    /** How long the last words may take after finish(). Default 10 s. */
    finalTimeoutMs?: number;
    /**
     * The company answers the end of the audio with one more answer and never says "finished" (Sarvam answers a flush with one
     * transcript): words after finish() end the stretch once `settleMs` (default 300 ms) pass with no more, so an earlier
     * segment's words still in flight don't cut off the last ones; with none within `quietMs`, it ends with what was heard.
     */
    lastAnswerAfterFinish?: { quietMs: number; settleMs?: number };
    /** Messages sent before the socket is let go, while it is still open (Ultravox: hang up the call). */
    goodbye?(): (string | Uint8Array)[];
    outOfCredit?: CreditCheck;
    /**
     * Opens something other than a WebSocket that behaves like one (NVIDIA: a gRPC call, src/kit/grpc.ts GrpcSocket): it emits
     * open, message, close and error, and has send, terminate and readyState.
     */
    transport?(address: SocketAddress): WebSocket;
}

/** Audio held while the socket opens. Past this the oldest goes: a socket that slow is failing anyway. */
const MAX_PENDING_MS = 10_000;
export const DEFAULT_FINAL_TIMEOUT_MS = 10_000;
/** With `lastAnswerAfterFinish`, how long after the latest words the stretch ends. */
const DEFAULT_SETTLE_MS = 300;

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
    private settling = false;
    /** The socket is open and the company takes audio (with `spec.ready` or `spec.readyFirst`, once it said so). */
    private accepting = false;
    /** Speech the company reported starting and has not answered yet; unknown until it reports any (`HearingMessage.speech`). */
    private unanswered?: number;
    private timer?: NodeJS.Timeout;
    readonly pauseMs?: number;

    constructor(
        private readonly spec: SocketHearingSpec,
        private readonly settings: RecognitionSettings,
        private readonly events: RecognizerEvents,
    ) {
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
        if (this.accepting && this.ws?.readyState === WebSocket.OPEN) {
            this.sendFinish();
            // The wait for the last answer started with the end of the audio
            if (this.spec.lastAnswerAfterFinish) return;
        }
        // A socket still opening that never takes the end of the audio fails, however the last words come once it does
        this.restartTimer(
            () => this.fail(failure(this.spec.adapter, 'took too long for the last words')),
            this.spec.finalTimeoutMs ?? DEFAULT_FINAL_TIMEOUT_MS,
        );
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
            ws = this.spec.transport ? this.spec.transport(address) : new WebSocket(address.url, address.protocols, { headers: address.headers });
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
            if (!this.spec.ready && !this.spec.readyFirst) this.accept();
        });
        ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
            // Nothing the company sends may throw out of here: a socket handler that throws takes the whole worker down
            try {
                const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
                if (!this.accepting && this.spec.ready?.(buffer, isBinary)) {
                    for (const message of this.spec.afterReady?.(this.settings) ?? []) ws.send(message);
                    this.accept();
                    return;
                }
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
            res.on('end', () =>
                this.fail(failure(this.spec.adapter, 'refused the connection', answerStatus(res.statusCode ?? 0, body, this.spec.outOfCredit))),
            );
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

    /** Sends the audio held while the socket opened (and the company got ready), then the end of it if that came already. */
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
        const last = this.spec.lastAnswerAfterFinish;
        // Counted from the end of the audio: quietMs for words the company may still hold, a moment when it has answered all
        if (last) this.restartTimer(() => this.end(), this.unanswered === 0 ? (last.settleMs ?? DEFAULT_SETTLE_MS) : last.quietMs);
    }

    private restartTimer(run: () => void, ms: number): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(run, ms);
        this.timer.unref?.();
    }

    private answer(answer: HearingMessage | HearingMessage[] | undefined): void {
        if (this.done || !answer) return;
        this.inAnswer(answer);
        // Each answer while settling waits again for anything after it
        if (this.settling && !this.done) {
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.end(), this.spec.settleMs);
            this.timer.unref?.();
        }
    }

    private inAnswer(answer: HearingMessage | HearingMessage[]): void {
        for (const message of Array.isArray(answer) ? answer : [answer]) {
            if (this.done) return;
            if (message.error) return this.fail(failure(this.spec.adapter, 'answered with an error', message.error.status));
            if (message.speech === 'started') {
                this.unanswered = (this.unanswered ?? 0) + 1;
                // Speech heard after finish() was sent (the company's detection runs late) still gets its words
                const last = this.spec.lastAnswerAfterFinish;
                if (this.finishing && last) this.restartTimer(() => this.end(), last.quietMs);
            }
            if (message.speech === 'answered' && this.unanswered) this.unanswered -= 1;
            if (message.ready) this.accept();
            if (message.committed) {
                const glue = this.spec.join === 'tokens' || !this.committed ? '' : ' ';
                this.committed += glue + message.committed;
                this.interim = '';
            }
            if (message.interim !== undefined) this.interim = message.interim;
            if (message.finished) {
                if (!this.spec.settleMs) return this.end();
                this.settling = true;
            }
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
            const last = this.spec.lastAnswerAfterFinish;
            // Speech the company heard and has not answered yet may take longer than a moment
            if (this.finishing && last && (message.committed !== undefined || message.interim !== undefined)) {
                this.restartTimer(() => this.end(), this.unanswered ? last.quietMs : (last.settleMs ?? DEFAULT_SETTLE_MS));
            }
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
        letGo(ws, this.spec.goodbye);
    }
}
