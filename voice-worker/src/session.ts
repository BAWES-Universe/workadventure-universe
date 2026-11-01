// A session = one bot in one bubble. Audio travels one of two ways, never both: a lane per person (peer-to-peer), or
// one LiveKit room for the whole bubble. The bot server decides who gets which and when (it follows the game's own
// transport rules); the session only carries it out. Every path has an epoch from one counter, and the newest wins:
// a newer lane replaces the old lane, the room replaces every older lane, a lane replaces an older room, and anything
// still addressed to an older epoch is dropped.
import { type ConnectorRegistry, type ProviderReporter, Secret, type SpeechConnector, type SpeechSettings, type Voice, isRejection, statusOf } from './connectors.ts';
import type { Counters } from './counters.ts';
import { FAKE_SPEECH_SETTINGS } from './fakeSpeech.ts';
import { Lane, type IceConfig } from './lane.ts';
import type { Expression, LeaveReason, Mode, ProviderPart, RecognitionConfig, Signal, SpeechConfig, WorkerToBot } from './protocol.ts';
import { modeListens } from './protocol.ts';
import { Recognition } from './recognition.ts';
import type { Recognizer, RecognizerEvents, RecognizerFactory } from './recognizer.ts';
import { RoomTransport } from './roomTransport.ts';
import { Speaker } from './speaker.ts';
import type { InputSink } from './transport.ts';

/** A connection that has not come up this long after the person's offer is given up. */
const CONNECT_TIMEOUT_MS = 20000;
const STATUS_INTERVAL_MS = 5000;

/** A message to the bot server as the session writes it; the session id and time are added on the way out. */
export type OutgoingMessage = WorkerToBot extends infer M ? (M extends WorkerToBot ? Omit<M, 'sessionId' | 'ts'> : never) : never;

export interface SessionHost {
    engineId: string;
    counters: Counters;
    ice: IceConfig;
    input: InputSink;
    /** The providers a bubble may name. */
    connectors: ConnectorRegistry;
    /** Turns people's speech into words when the bubble names no provider. Without one, audio is only counted. */
    recognizer?: RecognizerFactory;
    /** The longest stretch of speech taken, in audio milliseconds. */
    maxUtteranceMs: number;
    /** Speaks when the bubble names no provider (the test engine). */
    defaultSpeech: SpeechConnector;
    /** The longest any reply may play. */
    maxReplyMs: number;
    /** The longest wait for the next piece of a reply's audio before the provider counts as failed. */
    speechTimeoutMs: number;
    /** Voiced audio before a person counts as speaking over the bot. */
    bargeInMs?: number;
    /** Lanes alive in the whole worker, to enforce the limit. */
    laneCount(): number;
    maxLanes: number;
    send(message: OutgoingMessage): void;
}

/** The providers a bubble asked for when its session was opened. Keys are held as Secrets from here on. */
export interface SessionSettings {
    recognition?: RecognitionConfig;
    speech?: SpeechConfig;
    expression?: Expression;
}

/** A recognizer that gives up on its first audio (the adapter is unknown, or the connector could not start). It says so once. */
function failingRecognizer(events: RecognizerEvents, error?: unknown): Recognizer {
    let said = false;
    const fail = () => {
        if (said) return;
        said = true;
        const status = statusOf(error);
        events.failed('', status === undefined ? undefined : { status });
    };
    return { push: fail, finish: fail, close: () => (said = true) };
}

/** Keeps a connector's recognizer from throwing into the audio path: a throw is a failure at the provider. */
function guardedRecognizer(inner: Recognizer, events: RecognizerEvents): Recognizer {
    let broken = false;
    const guard = (run: () => void) => {
        if (broken) return;
        try {
            run();
        } catch (error) {
            broken = true;
            const status = statusOf(error);
            events.failed('', status === undefined ? undefined : { status });
        }
    };
    return { push: (pcm) => guard(() => inner.push(pcm)), finish: () => guard(() => inner.finish()), close: () => { broken = true; inner.close(); } };
}

export class Session {
    voice: 'active' | 'stopped' = 'active';
    readonly lanes = new Map<string, Lane>();
    room?: RoomTransport;
    private readonly newest = new Map<string, number>();
    private newestRoom = 0;
    private readonly timers = new Map<Lane, NodeJS.Timeout>();
    private readonly speaker: Speaker;
    /** Where a person's permitted audio goes: through recognition when there is a recognizer, else straight to the tap. */
    private readonly input: InputSink;
    private readonly recognition?: Recognition;
    private readonly statusTimer: NodeJS.Timeout;
    private closing = false;

    constructor(
        readonly id: string,
        readonly bubbleId: string,
        readonly botId: string,
        private readonly host: SessionHost,
        public defaultMode: Mode = 'talk',
        settings: SessionSettings = {}
    ) {
        const hearing = this.hearingFor(settings.recognition);
        this.recognition = hearing
            ? new Recognition({
                  factory: hearing.factory,
                  provider: hearing.provider,
                  maxUtteranceMs: host.maxUtteranceMs,
                  counters: host.counters,
                  send: (message) => host.send(message),
                  next: host.input,
                  bargeInMs: host.bargeInMs,
                  // A person speaking over the bot stops its voice at once, here, with no round trip
                  onSpeaking: () => this.speaker.bargeIn(),
              })
            : undefined;
        this.input = this.recognition ? this.recognition.sink : host.input;
        this.speaker = new Speaker({
            counters: host.counters,
            ...this.speakingFor(settings.speech, settings.expression),
            maxReplyMs: host.maxReplyMs,
            speechTimeoutMs: host.speechTimeoutMs,
            targets: () => (this.room ? [...this.lanes.values(), this.room] : [...this.lanes.values()]),
            active: () => this.voice === 'active',
            progress: (message) => host.send({ type: 'playback.progress', ...message }),
        });
        this.statusTimer = setInterval(() => this.sendStatus(), STATUS_INTERVAL_MS);
        this.statusTimer.unref?.();
    }

    private reporter(part: ProviderPart, adapter: string): ProviderReporter {
        const c = this.host.counters;
        return {
            ok: () => {
                c.inc(`provider_ok_${part}`);
                this.host.send({ type: 'provider.ok', part, adapter });
            },
            failed: (status) => {
                c.inc(`provider_failed_${part}`);
                const rejected = isRejection(status);
                this.host.send({ type: 'provider.failed', part, adapter, ...(status === undefined ? {} : { status }), ...(rejected ? { rejected: true as const } : {}) });
            },
        };
    }

    /** Hearing for this bubble: the provider it names, else the worker's own engine. An adapter the worker does not have hears nothing and says so. */
    private hearingFor(config?: RecognitionConfig): { factory: RecognizerFactory; provider?: ProviderReporter } | undefined {
        if (!config) return this.host.recognizer ? { factory: this.host.recognizer } : undefined;
        const settings = { adapter: config.adapter, model: config.model, key: new Secret(config.key), endpoint: config.endpoint, region: config.region, language: config.language };
        const connector = this.host.connectors.recognition(config.adapter);
        const factory: RecognizerFactory = (events) => {
            if (!connector) return failingRecognizer(events);
            try {
                return guardedRecognizer(connector.listen(settings, events), events);
            } catch (error) {
                return failingRecognizer(events, error);
            }
        };
        return { factory, provider: this.reporter('recognition', config.adapter) };
    }

    /** Speaking for this bubble, the same way. An adapter the worker does not have makes every reply fail at once, so it ends in text. */
    private speakingFor(config?: SpeechConfig, expression?: Expression): { voice: Voice; provider?: ProviderReporter } {
        if (!config) {
            const speech = this.host.defaultSpeech;
            return { voice: { speak: (request) => speech.speak({ ...request, settings: FAKE_SPEECH_SETTINGS, expression }) } };
        }
        const settings: SpeechSettings = { adapter: config.adapter, model: config.model, voiceId: config.voiceId, key: new Secret(config.key), endpoint: config.endpoint, region: config.region, language: config.language };
        const connector = this.host.connectors.speech(config.adapter);
        const voice: Voice = {
            speak: (request) =>
                connector
                    ? connector.speak({ ...request, lang: request.lang ?? settings.language, settings, expression })
                    : (async function* (): AsyncGenerator<Int16Array> {
                          throw new Error('no such speech adapter');
                      })(),
        };
        return { voice, provider: this.reporter('speech', config.adapter) };
    }

    /** Starts a connection with a person. A newer epoch replaces the one before it; an older or equal one is refused. */
    async openLane(participantId: string, epoch: number, mode: Mode = this.defaultMode): Promise<void> {
        const c = this.host.counters;
        if (epoch <= Math.max(this.newest.get(participantId) ?? 0, this.newestRoom)) {
            c.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'lane.open with an old epoch', participantId, epoch });
            return;
        }
        // The bubble is back on peer-to-peer: the room goes first, so only one path carries audio
        if (this.room) await this.dropRoom(this.room, 'closed', true);
        const old = this.lanes.get(participantId);
        if (!old && this.host.laneCount() >= this.host.maxLanes) {
            c.inc('lanes_refused');
            this.host.send({ type: 'error', code: 'at_capacity', message: 'too many audio connections', participantId, epoch });
            return;
        }
        this.newest.set(participantId, epoch);
        // One path at a time: the old one is fenced before the new one can carry anything
        if (old) await this.dropLane(old, 'superseded', false);
        const lane = new Lane(
            participantId,
            epoch,
            mode,
            {
                counters: c,
                ice: this.host.ice,
                input: this.input,
                sendSignal: (l, signal) => this.currentLane(l) && this.host.send({ type: 'lane.signal', participantId: l.participantId, epoch: l.epoch, signal }),
                onConnected: (l) => {
                    if (!this.currentLane(l)) return;
                    this.clearTimer(l);
                    c.inc('lanes_connected');
                    this.host.send({ type: 'participant.join', participantId: l.participantId, epoch: l.epoch });
                    this.sendStatus();
                },
                onGone: (l, reason) => void this.dropLane(l, reason, true),
            },
            () => this.voice === 'active'
        );
        this.lanes.set(participantId, lane);
        c.inc('lanes_opened');
        this.timers.set(lane, setTimeout(() => void this.dropLane(lane, 'timeout', true), CONNECT_TIMEOUT_MS));
    }

    private currentLane(lane: Lane): boolean {
        return !lane.gone && this.lanes.get(lane.participantId) === lane;
    }

    private clearTimer(lane: Lane): void {
        clearTimeout(this.timers.get(lane));
        this.timers.delete(lane);
    }

    /** Hands a signal from the person to its lane. Anything not addressed to the current lane is dropped. */
    async signal(participantId: string, epoch: number, signal: Signal): Promise<void> {
        const lane = this.laneFor(participantId, epoch);
        if (lane) await lane.signal(signal);
    }

    async closeLane(participantId: string, epoch: number, reason: LeaveReason = 'left'): Promise<void> {
        const lane = this.laneFor(participantId, epoch);
        if (lane) await this.dropLane(lane, reason, true);
    }

    private laneFor(participantId: string, epoch: number): Lane | undefined {
        const lane = this.lanes.get(participantId);
        if (!lane || lane.epoch !== epoch || lane.gone) {
            this.host.counters.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'no current lane for that epoch', participantId, epoch });
            return undefined;
        }
        return lane;
    }

    /** Ends a lane. The leave is announced for the lane that was current; a replaced lane is only closed. */
    private async dropLane(lane: Lane, reason: LeaveReason, announce: boolean): Promise<void> {
        if (lane.gone) return;
        const current = this.lanes.get(lane.participantId) === lane;
        this.clearTimer(lane);
        // gone is set first: from here on nothing more is heard from or sent to this path
        lane.gone = true;
        if (current) this.lanes.delete(lane.participantId);
        // What they were saying is offered back to them (they left on purpose: dropped)
        this.recognition?.interrupt(lane.participantId, lane.epoch, reason === 'left' ? 'cleared' : 'lost');
        this.host.counters.inc('lanes_closed');
        if (announce && current && !this.closing) {
            this.host.send({ type: 'participant.leave', participantId: lane.participantId, epoch: lane.epoch, reason });
        }
        await lane.stop();
        if (!this.closing) this.sendStatus();
    }

    /** Joins the bubble's LiveKit room and drops every older lane: the room is the one path from here on. */
    async joinRoom(epoch: number, serverUrl: string, token: string): Promise<void> {
        const c = this.host.counters;
        if (epoch <= Math.max(this.newestRoom, ...this.newest.values())) {
            c.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'room.join with an old epoch', epoch });
            return;
        }
        if (!this.room && this.lanes.size === 0 && this.host.laneCount() >= this.host.maxLanes) {
            c.inc('lanes_refused');
            this.host.send({ type: 'error', code: 'at_capacity', message: 'too many audio connections', epoch });
            return;
        }
        this.newestRoom = epoch;
        if (this.room) await this.dropRoom(this.room, 'closed', false);
        for (const lane of [...this.lanes.values()]) await this.dropLane(lane, 'superseded', true);
        const room = new RoomTransport(epoch, serverUrl, token, {
            counters: c,
            input: this.input,
            voiceActive: () => this.voice === 'active',
            onConnected: (r) => {
                if (this.room !== r) return;
                c.inc('rooms_connected');
                this.host.send({ type: 'room.state', epoch: r.epoch, state: 'connected' });
                this.sendStatus();
            },
            onGone: (r, state) => void this.dropRoom(r, state, true),
        });
        this.room = room;
        c.inc('rooms_opened');
        // Connecting takes a while; the session keeps handling messages meanwhile
        void room.start().catch(() => void this.dropRoom(room, 'failed', true));
    }

    async leaveRoom(epoch: number): Promise<void> {
        if (!this.room || this.room.epoch !== epoch) {
            this.host.counters.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'no current room for that epoch', epoch });
            return;
        }
        await this.dropRoom(this.room, 'closed', true);
    }

    setRoomPeople(epoch: number, people: { participantId: string; mode: Mode }[]): void {
        if (!this.room || this.room.epoch !== epoch) {
            this.host.counters.inc('stale_dropped');
            this.host.send({ type: 'error', code: 'stale_epoch', message: 'no current room for that epoch', epoch });
            return;
        }
        this.room.setPeople(people);
        // Someone no longer named, or not in a mode that listens, is no longer heard: their unfinished words go nowhere
        const heard = new Set(people.filter((person) => modeListens(person.mode)).map((person) => person.participantId));
        this.recognition?.forget((participantId) => heard.has(participantId) || this.lanes.has(participantId));
    }

    private async dropRoom(room: RoomTransport, state: 'closed' | 'failed', announce: boolean): Promise<void> {
        if (room.gone) return;
        const current = this.room === room;
        room.gone = true;
        if (current) this.room = undefined;
        this.recognition?.interruptEpoch(room.epoch, 'lost');
        this.host.counters.inc('rooms_closed');
        if (announce && current && !this.closing) this.host.send({ type: 'room.state', epoch: room.epoch, state });
        await room.stop();
        if (!this.closing) this.sendStatus();
    }

    setMode(mode: Mode, participantId?: string): void {
        if (!participantId) {
            this.defaultMode = mode;
            for (const lane of this.lanes.values()) lane.mode = mode;
        } else {
            const lane = this.lanes.get(participantId);
            if (lane) lane.mode = mode;
        }
        this.room?.setMode(mode, participantId);
        // Not listening any more: what they had said so far goes nowhere
        if (!modeListens(mode)) this.recognition?.forget((id) => (participantId ? id !== participantId : false));
        this.sendStatus();
    }

    say(segmentId: string, text: string, maxMs?: number, lang?: string): void {
        this.speaker.enqueue(segmentId, text, maxMs, lang);
    }

    retract(segmentId: string): void {
        this.speaker.retract(segmentId);
    }

    stopVoice(): void {
        this.voice = 'stopped';
        this.speaker.stopAll('voice_stop');
        // Mid-sentence when the voice ran out: the words so far are offered back, so nothing said is lost
        this.recognition?.interruptAll('lost', 'stopped');
        this.room?.refresh();
        this.sendStatus();
    }

    sendStatus(): void {
        if (this.closing) return;
        this.host.send({
            type: 'engine.status',
            engineId: this.host.engineId,
            voice: this.voice,
            mode: this.defaultMode,
            lanes: [...this.lanes.values()].filter((l) => !l.gone).map((l) => ({ participantId: l.participantId, epoch: l.epoch, healthy: l.healthy(), mode: l.mode })),
            ...(this.room && !this.room.gone ? { room: { epoch: this.room.epoch, connected: this.room.connected } } : {}),
            counters: this.host.counters.snapshot(),
        });
    }

    async close(): Promise<void> {
        if (this.closing) return;
        this.closing = true;
        clearInterval(this.statusTimer);
        this.recognition?.dispose();
        await this.speaker.shutdown();
        const room = this.room;
        this.room = undefined;
        if (room) room.gone = true;
        const lanes = [...this.lanes.values()];
        this.lanes.clear();
        for (const lane of lanes) this.clearTimer(lane);
        await Promise.allSettled([...lanes.map((lane) => ((lane.gone = true), lane.stop())), ...(room ? [room.stop()] : [])]);
    }
}
