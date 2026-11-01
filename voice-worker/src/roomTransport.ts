// The bot's LiveKit participant for one bubble: the same two sides as a peer connection (microphone audio in, bot
// speech out), but for the whole room. It joins with the token the game made for the bot, with automatic
// subscription off. It subscribes to exactly one kind of thing: the microphone of a person the bot server named.
// Never a camera, a screen, screen-share audio, or anything another bot publishes. It publishes one microphone track
// (the bot's voice) and nothing else.
import {
    AudioFrame,
    AudioSource,
    AudioStream,
    LocalAudioTrack,
    Room,
    RoomEvent,
    TrackKind,
    TrackPublishOptions,
    TrackSource,
} from '@livekit/rtc-node';
import type { RemoteParticipant, RemoteTrack, RemoteTrackPublication } from '@livekit/rtc-node';
import type { Counters } from './counters.ts';
import { TTS_RATE } from './fakeSpeech.ts';
import { type Mode, modeListens, modePlays } from './protocol.ts';
import type { InputSink, OutputFrame, OutputTarget } from './transport.ts';

const CONNECT_TIMEOUT_MS = 15000;
/** Audio the media stack may hold for the bot's track. Short, so a stop leaves little to play out. */
const OUTPUT_QUEUE_MS = 200;
const INPUT_RATE = 16000;

export interface RoomDeps {
    counters: Counters;
    input: InputSink;
    /** The connection ended without being asked to. */
    onGone(room: RoomTransport, state: 'closed' | 'failed'): void;
    onConnected(room: RoomTransport): void;
    /** False once voice is stopped for the session. */
    voiceActive(): boolean;
}

export class RoomTransport implements OutputTarget {
    readonly participantId = 'room';
    gone = false;
    connected = false;
    private readonly room = new Room();
    private readonly people = new Map<string, Mode>();
    private source?: AudioSource;
    private readonly readers = new Map<string, AudioStream>();

    constructor(readonly epoch: number, private readonly serverUrl: string, private readonly token: string, private readonly deps: RoomDeps) {}

    async start(): Promise<void> {
        const { room } = this;
        room.on(RoomEvent.TrackPublished, (publication, participant) => this.consider(participant, publication));
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => this.onSubscribed(track, publication, participant));
        room.on(RoomEvent.TrackUnsubscribed, (track) => this.stopReading(track.sid ?? ''));
        room.on(RoomEvent.Disconnected, () => {
            if (!this.gone) this.deps.onGone(this, 'closed');
        });
        let timer: NodeJS.Timeout | undefined;
        const connecting = room.connect(this.serverUrl, this.token, { autoSubscribe: false, dynacast: false });
        // Stopped or timed out while still joining: a join that completes later is closed at once, never left connected
        connecting.then(
            () => {
                if (this.gone) void this.disconnectQuietly();
            },
            () => undefined
        );
        try {
            await Promise.race([
                connecting,
                new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('connect timed out')), CONNECT_TIMEOUT_MS))),
            ]);
        } finally {
            clearTimeout(timer);
        }
        if (this.gone) return;
        const source = new AudioSource(TTS_RATE, 1, OUTPUT_QUEUE_MS);
        this.source = source;
        // The only thing the bot publishes: one microphone track
        const track = LocalAudioTrack.createAudioTrack('bot-voice', source);
        await room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
        // Stopped while publishing: stop() has already closed the room and the source
        if (this.gone) return;
        this.connected = true;
        this.reconcile();
        this.deps.onConnected(this);
    }

    /** Replaces who the bot may hear. Tracks of anyone no longer named are dropped at once. */
    setPeople(people: { participantId: string; mode: Mode }[]): void {
        this.people.clear();
        for (const person of people) this.people.set(person.participantId, person.mode);
        this.reconcile();
    }

    setMode(mode: Mode, participantId?: string): void {
        for (const id of participantId ? [participantId] : [...this.people.keys()]) if (this.people.has(id)) this.people.set(id, mode);
        this.reconcile();
    }

    /** The bot may hear this person: they are named, their mode listens, and voice is on. */
    private mayHear(identity: string): boolean {
        const mode = this.people.get(identity);
        return !this.gone && this.deps.voiceActive() && mode !== undefined && modeListens(mode);
    }

    /** Re-checks every publication against the current rules (after voice stops, for one). */
    refresh(): void {
        this.reconcile();
    }

    private reconcile(): void {
        if (this.gone) return;
        for (const participant of this.room.remoteParticipants.values()) {
            for (const publication of participant.trackPublications.values()) this.consider(participant, publication);
        }
    }

    /** Subscribes to a publication only when it is a permitted person's microphone; unsubscribes from it otherwise. */
    private consider(participant: RemoteParticipant, publication: RemoteTrackPublication): void {
        if (this.gone) return;
        const wanted =
            publication.kind === TrackKind.KIND_AUDIO && publication.source === TrackSource.SOURCE_MICROPHONE && this.mayHear(participant.identity);
        if (wanted === publication.subscribed) return;
        publication.setSubscribed(wanted);
        this.deps.counters.inc(wanted ? 'room_subscribed' : 'room_unsubscribed');
    }

    private onSubscribed(track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant): void {
        const c = this.deps.counters;
        const sid = track.sid ?? '';
        // Whatever the media server delivered, only a permitted person's microphone is read
        if (!(publication.source === TrackSource.SOURCE_MICROPHONE && track.kind === TrackKind.KIND_AUDIO && this.mayHear(participant.identity))) {
            c.inc('room_refused');
            publication.setSubscribed(false);
            return;
        }
        const stream = new AudioStream(track, { sampleRate: INPUT_RATE, numChannels: 1 });
        this.readers.set(sid, stream);
        void this.read(stream, participant.identity, sid);
    }

    private async read(stream: AudioStream, identity: string, sid: string): Promise<void> {
        const c = this.deps.counters;
        try {
            for await (const frame of stream) {
                // Leaving the loop releases and cancels the stream; there is nothing else to close
                if (this.gone || this.readers.get(sid) !== stream) break;
                if (!this.mayHear(identity)) {
                    c.inc('frames_gated');
                    continue;
                }
                c.inc('frames_heard');
                c.inc('heard_ms', Math.round((frame.samplesPerChannel * 1000) / INPUT_RATE));
                this.deps.input({ participantId: identity, epoch: this.epoch, pcm16k: frame.data, droppedMs: 0 });
            }
        } catch {
            c.inc('room_read_errors');
        }
    }

    /** Stops reading a track. The read loop sees it is no longer registered and ends, which closes the stream. */
    private stopReading(sid: string): void {
        this.readers.delete(sid);
    }

    /** What the bot is subscribed to right now, for tests and status. */
    subscriptions(): { identity: string; source: TrackSource | undefined; kind: TrackKind | undefined }[] {
        const out: { identity: string; source: TrackSource | undefined; kind: TrackKind | undefined }[] = [];
        for (const participant of this.room.remoteParticipants.values()) {
            for (const publication of participant.trackPublications.values()) {
                if (publication.subscribed) out.push({ identity: participant.identity, source: publication.source, kind: publication.kind });
            }
        }
        return out;
    }

    // ---- outbound ----

    plays(): boolean {
        if (this.gone || !this.connected || !this.deps.voiceActive()) return false;
        for (const mode of this.people.values()) if (modePlays(mode)) return true;
        return false;
    }

    sendFrame(frame: OutputFrame): void {
        if (!this.plays() || !this.source) return;
        const samples = new Int16Array(frame.pcm24k);
        this.source.captureFrame(new AudioFrame(samples, TTS_RATE, 1, samples.length)).catch(() => this.deps.counters.inc('room_out_errors'));
        this.deps.counters.inc('room_frames_out');
    }

    clear(): void {
        this.source?.clearQueue();
    }

    async stop(): Promise<void> {
        this.gone = true;
        this.connected = false;
        for (const sid of [...this.readers.keys()]) this.stopReading(sid);
        await this.disconnectQuietly();
        try {
            await this.source?.close();
        } catch {
            /* ignore */
        }
    }

    private async disconnectQuietly(): Promise<void> {
        try {
            await this.room.disconnect();
        } catch {
            /* already gone */
        }
    }
}
