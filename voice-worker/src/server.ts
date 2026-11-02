// The worker's door: a WebSocket endpoint the bot server connects to (one socket per bot), plus /health and /stats.
// When the socket goes away every connection it owned is closed, so a bot server that dies leaves no audio behind.
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { ConnectorRegistry } from './connectors.ts';
import { Counters } from './counters.ts';
import { FAKE_ADAPTER, FakeSpeech } from './fakeSpeech.ts';
import type { IceConfig } from './lane.ts';
import type { BotToWorker } from './protocol.ts';
import type { RecognizerFactory } from './recognizer.ts';
import type { RoomTransport } from './roomTransport.ts';
import { type OutgoingMessage, Session } from './session.ts';
import type { InputSink } from './transport.ts';
import { checkMessage } from './validate.ts';

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
const PING_INTERVAL_MS = 10000;
/** A bot server that stops reading this far behind is cut off. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export class VoiceWorker {
    readonly counters = new Counters();
    /** What a bubble speaks with when it names no provider. */
    readonly speech = new FakeSpeech();
    readonly connectors: ConnectorRegistry;
    private readonly server = http.createServer((req, res) => this.onHttp(req, res));
    private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    private readonly connections = new Set<BridgeConnection>();
    readonly engineId: string;
    private pingTimer?: NodeJS.Timeout;

    constructor(readonly options: WorkerOptions) {
        this.engineId = options.engineId ?? `voice-worker-${process.pid}`;
        // The test engine is the only connector built in; each real provider is one more file registered by name
        this.connectors = options.connectors ?? new ConnectorRegistry();
        if (!this.connectors.speech(FAKE_ADAPTER)) this.connectors.registerSpeech(FAKE_ADAPTER, this.speech);
        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
    }

    async listen(): Promise<number> {
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.options.port, this.options.host, () => resolve());
        });
        this.pingTimer = setInterval(() => this.connections.forEach((c) => c.ping()), PING_INTERVAL_MS);
        this.pingTimer.unref?.();
        return (this.server.address() as AddressInfo).port;
    }

    /** Stops serving and closes every connection, like a worker that goes down. */
    async close(): Promise<void> {
        clearInterval(this.pingTimer);
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

    stats(): Record<string, unknown> {
        return { engineId: this.engineId, connections: this.connections.size, lanes: this.laneCount(), counters: this.counters.snapshot() };
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
        json(404, { error: 'not found' });
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
        const next = previous
            .then(() => this.handle(msg))
            .catch((error) => {
                counters.inc('bridge_handler_errors');
                console.error('[voice-worker] handler failed', error);
                this.send(msg.sessionId, { type: 'error', code: 'internal', message: 'handler failed' });
            });
        this.queues.set(msg.sessionId, next);
    }

    private async handle(msg: BotToWorker): Promise<void> {
        if (this.closed) return;
        if (msg.type === 'session.open') {
            let session = this.sessions.get(msg.sessionId);
            if (!session) {
                if (this.sessions.size >= this.worker.options.maxSessionsPerConnection) {
                    this.send(msg.sessionId, { type: 'error', code: 'at_capacity', message: 'too many sessions' });
                    return;
                }
                // The providers are read once, when the session starts; a repeated session.open does not change them
                session = new Session(msg.sessionId, msg.bubbleId, msg.botId, this.worker.sessionHost((m) => this.send(msg.sessionId, m)), undefined, {
                    recognition: msg.recognition,
                    speech: msg.speech,
                    expression: msg.expression,
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
                this.queues.delete(msg.sessionId);
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
