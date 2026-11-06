/**
 * The bot's socket to the voice worker. It reconnects by itself; while it is down the bot has no voice and stays
 * text-only. Nothing here is shared between bots, so one bot's trouble never reaches another.
 */
import WebSocket from 'ws';
import type { FromWorker, ToWorker } from './protocol';

export interface VoiceLink {
    isUp(): boolean;
    /** False when the worker cannot be reached right now; nothing is queued. */
    send(message: ToWorker): boolean;
    close(): void;
}

export interface WorkerLinkOptions {
    url: string;
    botId: string;
    secret?: string;
    onMessage(message: FromWorker): void;
    onUp?(): void;
    /** The socket closed or never opened. Everything the worker held for this bot is gone. */
    onDown?(): void;
}

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const PING_INTERVAL_MS = 10000;
const MAX_MESSAGE_BYTES = 128 * 1024;

export class WorkerLink implements VoiceLink {
    private ws: WebSocket | null = null;
    private backoff = MIN_BACKOFF_MS;
    private retryTimer?: NodeJS.Timeout;
    private pingTimer?: NodeJS.Timeout;
    private alive = true;
    private closed = false;
    private up = false;

    constructor(private readonly options: WorkerLinkOptions) {}

    start(): void {
        if (this.closed || this.ws) return;
        const url = new URL('bridge', this.options.url.endsWith('/') ? this.options.url : `${this.options.url}/`);
        url.searchParams.set('botId', this.options.botId);
        const headers = this.options.secret ? { Authorization: `Bearer ${this.options.secret}` } : undefined;
        const ws = new WebSocket(url.toString(), { headers, maxPayload: MAX_MESSAGE_BYTES });
        this.ws = ws;

        ws.on('open', () => {
            this.up = true;
            this.alive = true;
            this.backoff = MIN_BACKOFF_MS;
            this.pingTimer = setInterval(() => {
                if (!this.alive) {
                    ws.terminate();
                    return;
                }
                this.alive = false;
                ws.ping();
            }, PING_INTERVAL_MS);
            this.pingTimer.unref?.();
            this.options.onUp?.();
        });
        ws.on('pong', () => {
            this.alive = true;
        });
        ws.on('message', (data) => {
            let message: FromWorker;
            try {
                message = JSON.parse(data.toString());
            } catch {
                return;
            }
            if (message && typeof message.type === 'string' && typeof message.sessionId === 'string') {
                this.options.onMessage(message);
            }
        });
        // Errors always come with a close; that is where the retry is scheduled
        ws.on('error', () => undefined);
        ws.on('close', () => {
            clearInterval(this.pingTimer);
            const wasUp = this.up;
            this.up = false;
            this.ws = null;
            if (wasUp) this.options.onDown?.();
            if (this.closed) return;
            this.retryTimer = setTimeout(() => this.start(), this.backoff);
            this.retryTimer.unref?.();
            this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
        });
    }

    isUp(): boolean {
        return this.up && this.ws?.readyState === WebSocket.OPEN;
    }

    send(message: ToWorker): boolean {
        if (!this.isUp()) return false;
        this.ws!.send(JSON.stringify({ ...message, ts: Date.now() }));
        return true;
    }

    close(): void {
        this.closed = true;
        clearTimeout(this.retryTimer);
        clearInterval(this.pingTimer);
        this.ws?.terminate();
    }
}
