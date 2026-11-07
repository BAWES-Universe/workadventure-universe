// Speaking over a WebSocket, one socket per reply. A company spec says how to open the socket, what to send, and how to
// read what comes back; this file does the rest the same way for every company: waiting for audio, stopping when the reply
// is no longer wanted, turning bytes into 24 kHz samples, and saying why it failed.
import WebSocket from 'ws';
import { ProviderError, type SpeechConnector, type SpeechRequest } from '../connectors.ts';
import { answerStatus, failure, type CreditCheck } from './errors.ts';
import { decodeAudioText, PcmReader, Resampler } from './pcm.ts';
import { SPEECH_RATE } from './httpSpeech.ts';

export interface SocketAddress {
    url: string;
    headers?: Record<string, string>;
    protocols?: string[];
}

/** What one message from the company holds. */
export interface SpeechMessage {
    /** Audio: raw bytes (a binary message) or text in the spec's encoding. */
    audio?: Uint8Array | string;
    /** The reply is complete: no more audio comes. */
    done?: boolean;
    error?: { status?: number };
}

export interface SocketSpeechSpec {
    adapter: string;
    endpoint: string;
    connect(request: SpeechRequest, base: string): SocketAddress;
    /** The messages sent once the socket is open: usually a setup message, the text, and a flush or close. */
    send(request: SpeechRequest): (string | Uint8Array)[];
    /**
     * Set when the company must answer the setup before it takes the text (Google's setupComplete): `start` is sent once the
     * socket opens, and `send` once an answer this says yes to arrives. That answer is not read as audio.
     */
    ready?(data: Buffer, isBinary: boolean): boolean;
    start?(request: SpeechRequest): (string | Uint8Array)[];
    read(data: Buffer, isBinary: boolean): SpeechMessage | undefined;
    audio: { sampleRate: number; encoding?: 'base64' | 'hex'; mayStartWithWav?: boolean };
    outOfCredit?: CreditCheck;
    /** A close after audio started, with no `done`, still counts as the end of the reply (companies that just close). */
    closeEndsReply?: boolean;
    /** How long to wait for the next message before the reply counts as failed. Default 15 s. */
    quietMs?: number;
}

export function socketSpeech(spec: SocketSpeechSpec): SpeechConnector {
    return { speak: (request) => speakOverSocket(spec, request) };
}

type Event = { samples: Int16Array } | { end: true } | { error: Error };

async function* speakOverSocket(spec: SocketSpeechSpec, request: SpeechRequest): AsyncGenerator<Int16Array> {
    if (request.signal.aborted) return;
    const base = (request.settings.endpoint || spec.endpoint).replace(/\/+$/, '');
    let ws: WebSocket;
    try {
        const address = spec.connect(request, base);
        // Throws at once on a bad address or a header value it can't send (a key pasted with a line break)
        ws = new WebSocket(address.url, address.protocols, { headers: address.headers });
    } catch (error) {
        throw error instanceof ProviderError ? error : failure(spec.adapter, 'could not be reached');
    }
    const reader = new PcmReader({ skipWavHeader: spec.audio.mayStartWithWav === true });
    const resampler = spec.audio.sampleRate === SPEECH_RATE ? undefined : new Resampler(spec.audio.sampleRate, SPEECH_RATE);
    const queue: Event[] = [];
    let wake: (() => void) | undefined;
    let heardAudio = false;
    let over = false;
    const push = (event: Event): void => {
        if (over) return;
        if (!('samples' in event)) over = true;
        queue.push(event);
        wake?.();
    };
    const samplesOf = (bytes: Uint8Array): void => {
        const raw = reader.take(bytes);
        if (!raw || raw.length === 0) return;
        const ready = resampler ? resampler.process(raw) : raw;
        if (ready.length > 0) {
            heardAudio = true;
            push({ samples: ready });
        }
    };
    let quiet: NodeJS.Timeout | undefined;
    const quietMs = spec.quietMs ?? 15_000;
    const rearm = (): void => {
        clearTimeout(quiet);
        quiet = setTimeout(() => push({ error: failure(spec.adapter, 'went quiet before the reply ended') }), quietMs);
        quiet.unref?.();
    };
    const onAbort = (): void => push({ end: true });
    request.signal.addEventListener('abort', onAbort, { once: true });

    let waiting = false;
    ws.on('open', () => {
        try {
            if (spec.ready) {
                for (const message of spec.start?.(request) ?? []) ws.send(message);
                waiting = true;
            } else {
                for (const message of spec.send(request)) ws.send(message);
            }
            rearm();
        } catch {
            push({ error: failure(spec.adapter, 'could not be sent the reply') });
        }
    });
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        rearm();
        const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        // Nothing the company sends may throw out of here: a socket handler that throws takes the whole worker down
        try {
            if (waiting && spec.ready?.(buffer, isBinary)) {
                waiting = false;
                for (const message of spec.send(request)) ws.send(message);
                return;
            }
            const message = spec.read(buffer, isBinary);
            if (!message) return;
            if (message.error) return push({ error: failure(spec.adapter, 'reported an error in the reply', message.error.status) });
            if (message.audio !== undefined) samplesOf(typeof message.audio === 'string' ? decodeAudioText(message.audio, spec.audio.encoding ?? 'base64') : message.audio);
            if (message.done) push({ end: true });
        } catch {
            push({ error: failure(spec.adapter, 'sent an answer that could not be read') });
        }
    });
    ws.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (d: Buffer) => {
            if (body.length < 4096) body += d.toString('utf8');
        });
        res.on('end', () => push({ error: failure(spec.adapter, 'refused the connection', answerStatus(res.statusCode ?? 0, body, spec.outOfCredit)) }));
        res.on('error', () => push({ error: failure(spec.adapter, 'refused the connection', res.statusCode) }));
    });
    ws.on('error', () => push({ error: failure(spec.adapter, 'could not be reached') }));
    ws.on('close', () => push(spec.closeEndsReply && heardAudio ? { end: true } : { error: failure(spec.adapter, 'closed before the reply ended') }));

    try {
        while (true) {
            if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
            wake = undefined;
            const event = queue.shift();
            if (!event) continue;
            if ('samples' in event) {
                if (request.signal.aborted) return;
                yield event.samples;
                continue;
            }
            if ('error' in event) {
                if (request.signal.aborted) return;
                throw event.error;
            }
            const rest = reader.flush();
            if (rest && !request.signal.aborted) {
                const ready = resampler ? resampler.process(rest) : rest;
                if (ready.length > 0) yield ready;
            }
            return;
        }
    } finally {
        clearTimeout(quiet);
        request.signal.removeEventListener('abort', onAbort);
        ws.removeAllListeners();
        ws.on('error', () => undefined);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
    }
}
