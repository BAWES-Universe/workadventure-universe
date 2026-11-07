// The worker's door: a WebSocket endpoint the bot server connects to (one socket per bot), plus /health and /stats.
// When the socket goes away every connection it owned is closed, so a bot server that dies leaves no audio behind.
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { ConnectorRegistry } from './connectors.ts';
import { Counters } from './counters.ts';
import { DEEPGRAM_ADAPTER, DEFAULT_DEEPGRAM_FINAL_TIMEOUT_MS, DeepgramRecognition } from './deepgram.ts';
import { FAKE_ADAPTER, FakeSpeech } from './fakeSpeech.ts';
import type { IceConfig } from './lane.ts';
import type { BotToWorker } from './protocol.ts';
import type { RecognizerFactory } from './recognizer.ts';
import type { RoomTransport } from './roomTransport.ts';
import { type OutgoingMessage, Session } from './session.ts';
import type { InputSink } from './transport.ts';
import { ASSEMBLYAI_ADAPTER, AssemblyAiRecognition } from './assemblyai.ts';
import { ASYNC_ADAPTER, AsyncSpeech } from './async.ts';
import { BLAND_ADAPTER, BlandSpeech } from './bland.ts';
import { CAMB_ADAPTER, CambSpeech } from './camb.ts';
import { FAL_ADAPTER, FalRecognition } from './fal.ts';
import { GLADIA_ADAPTER, GladiaRecognition } from './gladia.ts';
import { GRADIUM_ADAPTER, GradiumRecognition, GradiumSpeech } from './gradium.ts';
import { GROQ_ADAPTER, GroqRecognition, GroqSpeech } from './groq.ts';
import { HUME_ADAPTER, HumeSpeech } from './hume.ts';
import { META_ADAPTER, MetaRecognition } from './meta.ts';
import { MISTRAL_ADAPTER, MistralRecognition, MistralSpeech } from './mistral.ts';
import { NEUPHONIC_ADAPTER, NeuphonicSpeech } from './neuphonic.ts';
import { RESEMBLE_ADAPTER, ResembleSpeech } from './resemble.ts';
import { RIME_ADAPTER, RimeSpeech } from './rime.ts';
import { SARVAM_ADAPTER, SarvamRecognition, SarvamSpeech } from './sarvam.ts';
import { SMALLEST_ADAPTER, SmallestRecognition, SmallestSpeech } from './smallest.ts';
import { SPEECHIFY_ADAPTER, SpeechifySpeech } from './speechify.ts';
import { ELEVENLABS_ADAPTER, ElevenLabsSpeech } from './elevenlabs.ts';
import { CARTESIA_ADAPTER, CartesiaRecognition, CartesiaSpeech } from './cartesia.ts';
import { FISH_ADAPTER, FishSpeech } from './fish.ts';
import { DeepgramSpeech } from './deepgramSpeech.ts';
import { ElevenLabsRecognition } from './elevenlabsHearing.ts';
import { SonioxSpeech } from './sonioxSpeech.ts';
import { DEFAULT_SONIOX_FINAL_TIMEOUT_MS, SONIOX_ADAPTER, SonioxRecognition } from './soniox.ts';
import { checkMessage } from './validate.ts';
import { DEFAULT_MAX_PREVIEWS, DEFAULT_MAX_PREVIEW_SECONDS, type PreviewFailure, Previewer, readPreviewRequest } from './preview.ts';

export interface WorkerOptions {
    port: number;
    host: string;
    /** When set, the bot server must present it as a bearer token. */
    secret?: string;
    /** Audio connections alive in the whole worker; more are refused. */
    maxLanes: number;
    /** Bubbles one bot server connection may have open at once. */
    maxSessionsPerConnection: number;
    ice: IceConfig;
    /** Receives permitted microphone audio (a tap on all of it, for tests and measuring). */
    input?: InputSink;
    /** Hearing and speaking providers by adapter name. The test engine is always registered as "fake" for speech. */
    connectors?: ConnectorRegistry;
    /** Turns permitted microphone audio into words for a bubble that names no recognition provider (FakeEars in tests). Without one the audio is only counted. */
    recognizer?: RecognizerFactory;
    /** The longest stretch of one person's speech taken, in seconds of audio. Past it their words are offered back, never sent. Default 180. */
    maxUtteranceSeconds?: number;
    maxReplySeconds?: number;
    /** The longest wait for the next piece of a reply's audio from a speech provider, in seconds, before it counts as failed. Default 15. */
    speechTimeoutSeconds?: number;
    /** Voiced audio before a person counts as speaking over the bot, in milliseconds. */
    bargeInMs?: number;
    /** The Cartesia API version every Cartesia request names. Default DEFAULT_CARTESIA_VERSION. */
    cartesiaVersion?: string;
    /** How long a hearing provider may take for the last words after a person paused, in seconds, before it counts as failed. Default 10. */
    recognitionFinalTimeoutSeconds?: number;
    /** The longest one line spoken outside a bubble (the bot page's "Hear it say hello") plays, in seconds. Default 20. */
    maxPreviewSeconds?: number;
    /** How many of those lines are made at once; more are told to come back. Default 8. */
    maxPreviews?: number;
    engineId?: string;
}

/** The request path and query, or null when the request line is not a usable URL (such as "//" or "//%"). */
function parseRequestUrl(raw: string | undefined): URL | null {
    try {
        return new URL(raw ?? '/', 'http://worker');
    } catch {
        return null;
    }
}

export const DEFAULT_MAX_UTTERANCE_SECONDS = 180;
/** The longest any one spoken reply plays, whatever the bot server asks. */
export const DEFAULT_MAX_REPLY_SECONDS = 60;
/** How long a speech provider may go without sending the next piece of a reply's audio. */
export const DEFAULT_SPEECH_TIMEOUT_SECONDS = 15;
const MAX_MESSAGE_BYTES = 128 * 1024;
/** The most a /preview request may carry: the settings, a key and a short line. */
const MAX_PREVIEW_BODY_BYTES = 16 * 1024;
const PING_INTERVAL_MS = 10000;
/** CPU is sampled this often, and /stats gives its average over the last CPU_WINDOW_SAMPLES samples (one minute). */
const CPU_SAMPLE_MS = 5000;
const CPU_WINDOW_SAMPLES = 12;
/** A bot server that stops reading this far behind is cut off. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export class VoiceWorker {
    readonly counters = new Counters();
    /**
     * CPU is measured on the worker's own clock, not per /stats read, so every reader (and a second read soon after the
     * first) sees the same figure: the start of the current sample, and the last minute's samples in percent.
     */
    private cpuMark = { at: performance.now(), cpu: process.cpuUsage() };
    private readonly cpuSamples: number[] = [];
    private cpuTimer?: NodeJS.Timeout;
    /** What a bubble speaks with when it names no provider. */
    readonly speech = new FakeSpeech();
    readonly connectors: ConnectorRegistry;
    private readonly server = http.createServer((req, res) => this.onHttp(req, res));
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    private readonly connections = new Set<BridgeConnection>();
    readonly engineId: string;
    private pingTimer?: NodeJS.Timeout;
    private readonly previewer: Previewer;

    constructor(readonly options: WorkerOptions) {
        this.engineId = options.engineId ?? `voice-worker-${process.pid}`;
        // Each real provider is one file registered by name; a registry passed in (tests) keeps what it already has
        this.connectors = options.connectors ?? new ConnectorRegistry();
        if (!this.connectors.speech(FAKE_ADAPTER)) this.connectors.registerSpeech(FAKE_ADAPTER, this.speech);
        if (!this.connectors.recognition(ASSEMBLYAI_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(ASSEMBLYAI_ADAPTER, new AssemblyAiRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.speech(ASYNC_ADAPTER)) this.connectors.registerSpeech(ASYNC_ADAPTER, new AsyncSpeech());
        if (!this.connectors.speech(BLAND_ADAPTER)) this.connectors.registerSpeech(BLAND_ADAPTER, new BlandSpeech());
        if (!this.connectors.speech(CAMB_ADAPTER)) this.connectors.registerSpeech(CAMB_ADAPTER, new CambSpeech());
        if (!this.connectors.speech(CARTESIA_ADAPTER)) this.connectors.registerSpeech(CARTESIA_ADAPTER, new CartesiaSpeech({ version: options.cartesiaVersion }));
        if (!this.connectors.recognition(CARTESIA_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(CARTESIA_ADAPTER, new CartesiaRecognition({ version: options.cartesiaVersion, finalTimeoutMs }));
        }
        if (!this.connectors.recognition(FAL_ADAPTER)) this.connectors.registerRecognition(FAL_ADAPTER, new FalRecognition());
        if (!this.connectors.speech(FISH_ADAPTER)) this.connectors.registerSpeech(FISH_ADAPTER, new FishSpeech());
        if (!this.connectors.recognition(GLADIA_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(GLADIA_ADAPTER, new GladiaRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.recognition(GRADIUM_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(GRADIUM_ADAPTER, new GradiumRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.speech(GRADIUM_ADAPTER)) this.connectors.registerSpeech(GRADIUM_ADAPTER, new GradiumSpeech());
        if (!this.connectors.recognition(GROQ_ADAPTER)) this.connectors.registerRecognition(GROQ_ADAPTER, new GroqRecognition());
        if (!this.connectors.speech(GROQ_ADAPTER)) this.connectors.registerSpeech(GROQ_ADAPTER, new GroqSpeech());
        if (!this.connectors.speech(HUME_ADAPTER)) this.connectors.registerSpeech(HUME_ADAPTER, new HumeSpeech());
        if (!this.connectors.recognition(META_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(META_ADAPTER, new MetaRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.recognition(MISTRAL_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(MISTRAL_ADAPTER, new MistralRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.speech(MISTRAL_ADAPTER)) this.connectors.registerSpeech(MISTRAL_ADAPTER, new MistralSpeech());
        if (!this.connectors.speech(NEUPHONIC_ADAPTER)) this.connectors.registerSpeech(NEUPHONIC_ADAPTER, new NeuphonicSpeech());
        if (!this.connectors.speech(RESEMBLE_ADAPTER)) this.connectors.registerSpeech(RESEMBLE_ADAPTER, new ResembleSpeech());
        if (!this.connectors.speech(RIME_ADAPTER)) this.connectors.registerSpeech(RIME_ADAPTER, new RimeSpeech());
        if (!this.connectors.recognition(SARVAM_ADAPTER)) this.connectors.registerRecognition(SARVAM_ADAPTER, new SarvamRecognition());
        if (!this.connectors.speech(SARVAM_ADAPTER)) this.connectors.registerSpeech(SARVAM_ADAPTER, new SarvamSpeech());
        if (!this.connectors.recognition(SMALLEST_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(SMALLEST_ADAPTER, new SmallestRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.speech(SMALLEST_ADAPTER)) this.connectors.registerSpeech(SMALLEST_ADAPTER, new SmallestSpeech());
        if (!this.connectors.speech(SPEECHIFY_ADAPTER)) this.connectors.registerSpeech(SPEECHIFY_ADAPTER, new SpeechifySpeech());
        if (!this.connectors.recognition(SONIOX_ADAPTER)) {
            const finalTimeoutMs = (options.recognitionFinalTimeoutSeconds ?? DEFAULT_SONIOX_FINAL_TIMEOUT_MS / 1000) * 1000;
            this.connectors.registerRecognition(SONIOX_ADAPTER, new SonioxRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.speech(SONIOX_ADAPTER)) this.connectors.registerSpeech(SONIOX_ADAPTER, new SonioxSpeech());
        if (!this.connectors.speech(ELEVENLABS_ADAPTER)) this.connectors.registerSpeech(ELEVENLABS_ADAPTER, new ElevenLabsSpeech());
        if (!this.connectors.recognition(ELEVENLABS_ADAPTER)) {
            const finalTimeoutMs = options.recognitionFinalTimeoutSeconds === undefined ? undefined : options.recognitionFinalTimeoutSeconds * 1000;
            this.connectors.registerRecognition(ELEVENLABS_ADAPTER, new ElevenLabsRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.recognition(DEEPGRAM_ADAPTER)) {
            const finalTimeoutMs = (options.recognitionFinalTimeoutSeconds ?? DEFAULT_DEEPGRAM_FINAL_TIMEOUT_MS / 1000) * 1000;
            this.connectors.registerRecognition(DEEPGRAM_ADAPTER, new DeepgramRecognition({ finalTimeoutMs }));
        }
        if (!this.connectors.speech(DEEPGRAM_ADAPTER)) this.connectors.registerSpeech(DEEPGRAM_ADAPTER, new DeepgramSpeech());
        this.previewer = new Previewer({
            connectors: this.connectors,
            speechTimeoutMs: (options.speechTimeoutSeconds ?? DEFAULT_SPEECH_TIMEOUT_SECONDS) * 1000,
            maxPreviewMs: Math.min(options.maxPreviewSeconds ?? DEFAULT_MAX_PREVIEW_SECONDS, options.maxReplySeconds ?? DEFAULT_MAX_REPLY_SECONDS) * 1000,
            maxPreviews: options.maxPreviews ?? DEFAULT_MAX_PREVIEWS,
            inc: (counter, by) => this.counters.inc(counter, by),
        });
        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    }

    async listen(): Promise<number> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.options.port, this.options.host, () => resolve());
        });
        this.pingTimer = setInterval(() => this.connections.forEach((c) => c.ping()), PING_INTERVAL_MS);
        this.pingTimer.unref?.();
        this.cpuTimer = setInterval(() => this.sampleCpu(), CPU_SAMPLE_MS);
        this.cpuTimer.unref?.();
        return (this.server.address() as AddressInfo).port;
    }

    /** Stops serving and closes every connection, like a worker that goes down. */
    async close(): Promise<void> {
        clearInterval(this.pingTimer);
        clearInterval(this.cpuTimer);
        this.wss.close();
        this.server.closeAllConnections();
        await Promise.allSettled([...this.connections].map((c) => c.shutdown()));
        await new Promise((resolve) => this.server.close(resolve));
    }

    laneCount(): number {
        let n = 0;
        for (const c of this.connections) n += c.laneCount();
        return n;
    }

    /** What every bot's LiveKit participant is subscribed to right now (for tests: it must only ever be permitted microphones). */
    roomSubscriptions(): ReturnType<RoomTransport['subscriptions']> {
        return [...this.connections].flatMap((c) => c.roomSubscriptions());
    }

    sessionCount(): number {
        let n = 0;
        for (const c of this.connections) n += c.sessionCount();
        return n;
    }

    /**
     * What the worker is carrying and how hard it is working, for whoever watches its load (#1751). CPU is this
     * process's share of one core over the last minute, so 100 is one core fully busy. Reading it changes nothing.
     */
    stats(): Record<string, unknown> {
        const lanes = this.laneCount();
        this.counters.max('peak_lanes', lanes);
        return {
            engineId: this.engineId,
            connections: this.connections.size,
            sessions: this.sessionCount(),
            lanes,
            maxLanes: this.options.maxLanes,
            peakLanes: this.counters.get('peak_lanes'),
            cpuPercent: this.cpuPercent(),
            memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
            uptimeSeconds: Math.round(process.uptime()),
            counters: this.counters.snapshot(),
        };
    }

    /** CPU since the current sample began, in percent of one core. Reading it changes nothing. */
    private cpuSinceMark(): number {
        const elapsedMs = performance.now() - this.cpuMark.at;
        const cpu = process.cpuUsage(this.cpuMark.cpu);
        return elapsedMs > 0 ? ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100 : 0;
    }

    /** Closes the current CPU sample and starts the next. */
    sampleCpu(): void {
        this.cpuSamples.push(this.cpuSinceMark());
        if (this.cpuSamples.length > CPU_WINDOW_SAMPLES) this.cpuSamples.shift();
        this.cpuMark = { at: performance.now(), cpu: process.cpuUsage() };
    }

    /** The last minute's average CPU, in percent of one core (before the first sample: since the worker started). */
    cpuPercent(): number {
        const value = this.cpuSamples.length > 0 ? this.cpuSamples.reduce((a, b) => a + b, 0) / this.cpuSamples.length : this.cpuSinceMark();
        return Math.round(value * 10) / 10;
    }

    sessionHost(send: (message: OutgoingMessage) => void) {
        return {
            engineId: this.engineId,
            counters: this.counters,
            ice: this.options.ice,
            input: this.options.input ?? (() => undefined),
            connectors: this.connectors,
            recognizer: this.options.recognizer,
            maxUtteranceMs: (this.options.maxUtteranceSeconds ?? DEFAULT_MAX_UTTERANCE_SECONDS) * 1000,
            defaultSpeech: this.speech,
            maxReplyMs: (this.options.maxReplySeconds ?? DEFAULT_MAX_REPLY_SECONDS) * 1000,
            speechTimeoutMs: (this.options.speechTimeoutSeconds ?? DEFAULT_SPEECH_TIMEOUT_SECONDS) * 1000,
            bargeInMs: this.options.bargeInMs,
            laneCount: () => this.laneCount(),
            maxLanes: this.options.maxLanes,
            send,
        };
    }

    private authorized(req: http.IncomingMessage): boolean {
        const secret = this.options.secret;
        if (!secret) return true;
        const header = req.headers.authorization ?? '';
        const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
        const wanted = Buffer.from(secret);
        return given.length === wanted.length && timingSafeEqual(given, wanted);
    }

    private onHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
        const json = (code: number, body: unknown) => {
            res.writeHead(code, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        const url = parseRequestUrl(req.url);
        if (!url) {
            this.counters.inc('http_bad_url');
            return json(400, { error: 'bad request' });
        }
        const path = url.pathname;
        if (path === '/health') return json(200, { ok: true });
        if (path === '/stats') return this.authorized(req) ? json(200, this.stats()) : json(401, { error: 'unauthorized' });
        if (path === '/preview') {
            if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
            if (!this.authorized(req)) {
                this.counters.inc('preview_unauthorized');
                return json(401, { error: 'unauthorized' });
            }
            void this.onPreview(req, res, json);
            return;
        }
        json(404, { error: 'not found' });
    }

    /**
     * One line spoken outside a bubble (see preview.ts): the audio comes back as a WAV file, or a short JSON answer that says why not.
     * The answer never carries the key or the provider's own words.
     */
    private async onPreview(req: http.IncomingMessage, res: http.ServerResponse, json: (code: number, body: unknown) => void): Promise<void> {
        // Bytes first, text once the whole body is in: a character can be split across two pieces
        const pieces: Buffer[] = [];
        let received = 0;
        let tooBig = false;
        try {
            for await (const piece of req) {
                const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as string);
                received += bytes.length;
                if (received > MAX_PREVIEW_BODY_BYTES) {
                    tooBig = true;
                    break;
                }
                pieces.push(bytes);
            }
        } catch {
            return json(400, { error: 'bad_request', message: 'the request could not be read' });
        }
        if (tooBig) return json(413, { error: 'bad_request', message: 'the request is too big' });
        let body: unknown;
        try {
            body = JSON.parse(Buffer.concat(pieces).toString('utf8'));
        } catch {
            return json(400, { error: 'bad_request', message: 'the request is not JSON' });
        }
        const request = readPreviewRequest(body);
        if (typeof request === 'string') return json(400, { error: 'bad_request', message: request });
        // The asker going away closes the provider call
        const gone = new AbortController();
        res.once('close', () => {
            if (!res.writableEnded) gone.abort();
        });
        try {
            const { wav, ms } = await this.previewer.render(request, gone.signal);
            if (res.writableEnded || res.destroyed) return;
            res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'x-audio-ms': String(ms) });
            res.end(wav);
        } catch (error) {
            if (res.writableEnded || res.destroyed) return;
            const failure = error as PreviewFailure | undefined;
            switch (failure?.kind) {
                case 'no_adapter':
                    return json(400, { error: 'no_adapter' });
                case 'busy':
                    return json(429, { error: 'busy' });
                case 'provider':
                    return json(502, { error: 'provider', ...(failure.status !== undefined ? { status: failure.status } : {}), rejected: failure.rejected });
                default:
                    this.counters.inc('preview_errors');
                    console.error('[voice-worker] preview failed', error);
                    return json(500, { error: 'internal' });
            }
        }
    }

    private onUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        socket.on('error', () => undefined);
        const url = parseRequestUrl(req.url);
        const botId = url?.searchParams.get('botId') ?? '';
        if (!url || url.pathname !== '/bridge' || !botId || botId.length > 128) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }
        if (!this.authorized(req)) {
            this.counters.inc('bridge_unauthorized');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => {
            const connection = new BridgeConnection(this, ws, botId);
            this.connections.add(connection);
            ws.on('close', () => {
                this.connections.delete(connection);
                void connection.shutdown();
            });
        });
    }
}

/** One bot's socket. Its sessions (bubbles) live and die with it. */
class BridgeConnection {
    private readonly sessions = new Map<string, Session>();
    /** Messages for one session are handled one at a time, in order. */
    private readonly queues = new Map<string, Promise<void>>();
    private alive = true;
    private closed = false;

    constructor(private readonly worker: VoiceWorker, private readonly ws: WebSocket, readonly botId: string) {
        ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
        ws.on('pong', () => (this.alive = true));
        ws.on('error', () => this.worker.counters.inc('bridge_socket_errors'));
        worker.counters.inc('bridge_connections');
    }

    laneCount(): number {
        let n = 0;
        for (const s of this.sessions.values()) n += s.lanes.size + (s.room ? 1 : 0);
        return n;
    }

    sessionCount(): number {
        return this.sessions.size;
    }

    roomSubscriptions(): ReturnType<RoomTransport['subscriptions']> {
        return [...this.sessions.values()].flatMap((s) => s.room?.subscriptions() ?? []);
    }

    ping(): void {
        if (!this.alive) {
            this.worker.counters.inc('bridge_ping_timeouts');
            this.ws.terminate();
            return;
        }
        this.alive = false;
        this.ws.ping();
    }

    send(sessionId: string, message: OutgoingMessage): void {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            this.worker.counters.inc('bridge_slow_consumer');
            this.ws.terminate();
            return;
        }
        this.worker.counters.inc('bridge_out');
        this.ws.send(JSON.stringify({ ...message, sessionId, ts: Date.now() }));
    }

    private onMessage(data: RawData, isBinary: boolean): void {
        const counters = this.worker.counters;
        let message: unknown;
        try {
            if (isBinary) throw new Error('binary');
            message = JSON.parse(data.toString());
        } catch {
            counters.inc('bridge_bad_in');
            return;
        }
        const problem = checkMessage('fromBot', message);
        if (problem) {
            counters.inc('bridge_invalid_in');
            const sessionId = (message as { sessionId?: unknown } | null)?.sessionId;
            if (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 128) {
                this.send(sessionId, { type: 'error', code: 'invalid_message', message: problem });
            }
            return;
        }
        counters.inc('bridge_in');
        const msg = message as BotToWorker;
        const previous = this.queues.get(msg.sessionId) ?? Promise.resolve();
        const next: Promise<void> = previous
            .then(() => this.handle(msg))
            .catch((error) => {
                counters.inc('bridge_handler_errors');
                console.error('[voice-worker] handler failed', error);
                this.send(msg.sessionId, { type: 'error', code: 'internal', message: 'handler failed' });
            })
            .finally(() => {
                // The line for a session goes away once its last queued message is done, so a message for a session that
                // never opened leaves nothing behind, and a session that is closing keeps its line until the close is over
                if (this.queues.get(msg.sessionId) === next) this.queues.delete(msg.sessionId);
            });
        this.queues.set(msg.sessionId, next);
    }

    private async handle(msg: BotToWorker): Promise<void> {
        if (this.closed) return;
        if (msg.type === 'session.open') {
            let session = this.sessions.get(msg.sessionId);
            if (!session) {
                if (this.sessions.size >= this.worker.options.maxSessionsPerConnection) {
                    this.worker.counters.inc('sessions_refused');
                    this.send(msg.sessionId, { type: 'error', code: 'at_capacity', message: 'too many sessions' });
                    return;
                }
                // The providers are read once, when the session starts; a repeated session.open does not change them
                session = new Session(msg.sessionId, msg.bubbleId, msg.botId, this.worker.sessionHost((m) => this.send(msg.sessionId, m)), undefined, {
                    recognition: msg.recognition,
                    speech: msg.speech,
                    expression: msg.expression,
                    turnSeconds: msg.turnSeconds,
                });
                this.sessions.set(msg.sessionId, session);
                this.worker.counters.inc('sessions_opened');
            }
            this.send(msg.sessionId, { type: 'session.start', bubbleId: session.bubbleId, mode: session.defaultMode, engine: { id: this.worker.engineId, kind: 'ts' } });
            return;
        }
        const session = this.sessions.get(msg.sessionId);
        if (!session) {
            this.send(msg.sessionId, { type: 'error', code: 'no_session', message: 'unknown session' });
            return;
        }
        switch (msg.type) {
            case 'lane.open':
                await session.openLane(msg.participantId, msg.epoch, msg.mode);
                break;
            case 'lane.signal':
                await session.signal(msg.participantId, msg.epoch, msg.signal);
                break;
            case 'lane.close':
                await session.closeLane(msg.participantId, msg.epoch, msg.reason);
                break;
            case 'room.join':
                await session.joinRoom(msg.epoch, msg.serverUrl, msg.token);
                break;
            case 'room.leave':
                await session.leaveRoom(msg.epoch);
                break;
            case 'room.people':
                session.setRoomPeople(msg.epoch, msg.people);
                break;
            case 'mode.set':
                session.setMode(msg.mode, msg.participantId);
                break;
            case 'bot.say':
                session.say(msg.segmentId, msg.text, msg.maxMs, msg.lang);
                break;
            case 'bot.retract':
                session.retract(msg.segmentId);
                break;
            case 'voice.stop':
                session.stopVoice();
                break;
            case 'session.end':
                this.sessions.delete(msg.sessionId);
                await session.close();
                break;
        }
    }

    async shutdown(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        this.ws.terminate();
        const sessions = [...this.sessions.values()];
        this.sessions.clear();
        await Promise.allSettled(sessions.map((s) => s.close()));
    }
}
