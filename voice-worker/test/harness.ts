// Test harness: a fake person's browser (a werift peer connection that signals the way the game's simple-peer does)
// and a fake game side for the bot server's relay. No browser, no network beyond loopback, no speech provider.
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, useOPUS, useVP8 } from 'werift';
import { appendFileSync } from 'node:fs';
import { Decoder, Encoder } from '@evan/opus';
import { VoiceCalls, type GameSide } from '../../bots/voice/VoiceCalls.ts';
import { WorkerLink } from '../../bots/voice/VoiceLink.ts';
import type { FromWorker, ListenInfo, ToWorker, VoiceDraft, VoiceStatus } from '../../bots/voice/protocol.ts';
import { checkMessage } from '../src/validate.ts';
import { VoiceWorker, type WorkerOptions } from '../src/server.ts';
import type { RecognizerFactory } from '../src/recognizer.ts';
import type { SpeechObserverSettings } from '../src/speechObserver.ts';
import { sileroLoader } from '../src/speechObserverRuntime.ts';
import type { InputSink } from '../src/transport.ts';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(what: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await sleep(20);
    }
}

const rms = (pcm: Int16Array): number => {
    let sum = 0;
    for (const v of pcm) sum += v * v;
    return Math.sqrt(sum / Math.max(1, pcm.length));
};

/** One person's browser. The person makes the offer, like the game's initiator side. */
export class FakeHuman {
    pc!: RTCPeerConnection;
    readonly mic = new MediaStreamTrack({ kind: 'audio' });
    /** RTP packets of audio that arrived from the other side, and how many decoded to something loud. */
    audioPackets = 0;
    loudFrames = 0;
    /** Called for every audio packet from the other side as it arrives, with whether it decoded to something loud. */
    onAudio?: (loud: boolean) => void;
    videoPackets = 0;
    /** Messages the bot sent on the data channel. */
    dataMessages: unknown[] = [];
    state = 'new';
    private micTimer?: NodeJS.Timeout;
    private seq = 1000;
    private ts = 5000;
    private readonly encoder = new Encoder({ channels: 1, sample_rate: 48000, application: 'voip' });
    private readonly decoder = new Decoder({ channels: 1, sample_rate: 48000 });
    outgoingSignals: string[] = [];

    /** Where this person's later signals go (set by a test that lets the person offer again). */
    deliver?: (signal: string) => void;
    /** The bot asked this person to add an audio line. */
    audioRequests = 0;

    constructor(readonly id: string, private readonly withVideo = false, private readonly withMic = true) {}

    /** Builds the offer (and the trickled candidates) a browser would send, as JSON strings. */
    async offer(): Promise<string[]> {
        this.pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [useVP8()] }, iceServers: [], iceUseIpv6: false });
        if (this.withMic) this.pc.addTransceiver(this.mic, { direction: 'sendrecv' });
        if (this.withVideo) this.pc.addTransceiver('video', { direction: 'sendrecv' });
        this.pc.createDataChannel('data').onMessage.subscribe((data) => {
            try {
                this.dataMessages.push(JSON.parse(String(data)));
            } catch {
                /* not json */
            }
        });
        this.pc.onTrack.subscribe((track) => {
            if (track.kind === 'video') {
                track.onReceiveRtp.subscribe(() => this.videoPackets++);
                return;
            }
            track.onReceiveRtp.subscribe((rtp) => {
                this.audioPackets++;
                try {
                    const pcm = new Int16Array(this.decoder.decode(rtp.payload).slice().buffer);
                    const loud = rms(pcm) > 300;
                    if (loud) this.loudFrames++;
                    this.onAudio?.(loud);
                } catch {
                    /* undecodable */
                }
            });
        });
        this.pc.connectionStateChange.subscribe((s) => (this.state = s));
        const signals: string[] = [];
        this.pc.onIceCandidate.subscribe((c) => {
            if (c) signals.push(JSON.stringify({ type: 'candidate', candidate: { candidate: c.candidate, sdpMLineIndex: c.sdpMLineIndex ?? 0, sdpMid: c.sdpMid ?? '0' } }));
        });
        await this.pc.setLocalDescription(await this.pc.createOffer());
        return [JSON.stringify({ type: 'offer', sdp: this.pc.localDescription!.sdp }), ...signals];
    }

    async accept(json: string): Promise<void> {
        const signal = JSON.parse(json);
        if (signal.type === 'answer') await this.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        else if (signal.type === 'candidate') await this.pc.addIceCandidate(signal.candidate);
        else if (signal.type === 'transceiverRequest') {
            // What simple-peer's initiator does with the request: add the line and offer again
            this.audioRequests++;
            this.pc.addTransceiver(signal.transceiverRequest.kind, { direction: signal.transceiverRequest.init?.direction ?? 'recvonly' });
            await this.pc.setLocalDescription(await this.pc.createOffer());
            this.deliver?.(JSON.stringify({ type: 'offer', sdp: this.pc.localDescription!.sdp }));
        }
    }

    /** Sends a tone as microphone audio, one 20 ms packet at a time. */
    startMic(hz = 440): void {
        let phase = 0;
        this.micTimer = setInterval(() => {
            const frame = new Int16Array(960);
            for (let i = 0; i < frame.length; i++) {
                frame[i] = Math.round(8000 * Math.sin(phase));
                phase += (2 * Math.PI * hz) / 48000;
            }
            const header = new RtpHeader({ sequenceNumber: this.seq++ & 0xffff, timestamp: (this.ts += 960) >>> 0, payloadType: 111, ssrc: 4242, marker: false });
            try {
                this.mic.writeRtp(new RtpPacket(header, Buffer.from(this.encoder.encode(frame))));
            } catch {
                /* peer closed */
            }
        }, 20);
    }

    stopMic(): void {
        clearInterval(this.micTimer);
    }

    async close(): Promise<void> {
        this.stopMic();
        await this.pc?.close();
    }
}

/** A person standing next to the other, talking directly (the game's person-to-person path, which the worker never touches). */
export async function connectPeople(a: FakeHuman, b: FakeHuman): Promise<void> {
    const offer = await a.offer();
    b.pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()] }, iceServers: [], iceUseIpv6: false });
    b.pc.addTransceiver(b.mic, { direction: 'sendrecv' });
    b.pc.onTrack.subscribe((track) => {
        if (track.kind === 'audio') track.onReceiveRtp.subscribe(() => b.audioPackets++);
    });
    await b.pc.setRemoteDescription({ type: 'offer', sdp: JSON.parse(offer[0]).sdp });
    await b.pc.setLocalDescription(await b.pc.createAnswer());
    await a.pc.setRemoteDescription({ type: 'answer', sdp: b.pc.localDescription!.sdp });
}

export interface Rig {
    worker: VoiceWorker;
    calls: VoiceCalls;
    game: FakeGame;
    /** Every bridge message in either direction that does not match the schema. */
    violations: string[];
    /** Everything the worker sent to the bot server. */
    fromWorker: FromWorker[];
    toWorker: ToWorker[];
    workerPort: number;
    link: () => WorkerLink;
}

/** The game side: delivers the bot's signals to the right fake browser and records the disconnects it asks for. */
export class FakeGame implements GameSide {
    humans = new Map<string, FakeHuman>();
    disconnects: string[] = [];
    /** Also the LiveKit room's name: a test file whose rooms may run beside another file's gives its own (startRig). */
    spaceName = 'proximity-1';
    readonly botId = 'room_bot';

    botSpaceUserId(spaceName: string): string | undefined {
        return spaceName === this.spaceName ? this.botId : undefined;
    }

    sendSignal(_space: string, receiverUserId: string, signal: string): void {
        void this.humans.get(receiverUserId)?.accept(signal);
    }

    sendDisconnect(_space: string, receiverUserId: string): void {
        this.disconnects.push(receiverUserId);
    }

    starts: string[] = [];
    /** What the bot showed each person of what it heard them say, in order. */
    drafts: [string, VoiceDraft][] = [];

    sendDraft(_space: string, receiverUserId: string, draft: VoiceDraft): void {
        this.drafts.push([receiverUserId, draft]);
    }

    sendStart(_space: string, receiverUserId: string): void {
        this.starts.push(receiverUserId);
    }

    /** Where the bot said its voice stood to each person, in order. */
    statuses: [string, VoiceStatus][] = [];

    /** Whether the bot said it takes each person's microphone in a group (round 8), in order, when it said anything about it. */
    listens: [string, ListenInfo][] = [];

    sendStatus(_space: string, receiverUserId: string, status: VoiceStatus, _left?: unknown, listen?: ListenInfo): void {
        this.statuses.push([receiverUserId, status]);
        if (listen) this.listens.push([receiverUserId, listen]);
    }
}

/** A private event as the bot receives it from the game. */
export function privateEvent(game: FakeGame, senderId: string, event: { $case: string } & Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
        spaceName: game.spaceName,
        receiverUserId: game.botId,
        sender: { spaceUserId: senderId, uuid: `uuid-${senderId}`, tags: [], name: senderId, ...extra },
        spaceEvent: { event },
    } as never;
}

/**
 * The whole suite can be run a second time with the speech observer switched on, to show that nothing it tests changes:
 *   ORT_DISABLE_TELEMETRY=1 VOICE_TEST_SPEECH_OBSERVER_MODEL=<silero_vad.onnx> VOICE_TEST_SPEECH_OBSERVER_RUNTIME=<onnxruntime-node folder> npm test
 * VOICE_TEST_SPEECH_OBSERVER_REPORT=<file> gets one line per worker with what the observer counted, so the run can show it was really on.
 */
function observerFromEnv(): SpeechObserverSettings | undefined {
    const modelPath = process.env.VOICE_TEST_SPEECH_OBSERVER_MODEL;
    return modelPath ? { load: sileroLoader({ modelPath, runtime: process.env.VOICE_TEST_SPEECH_OBSERVER_RUNTIME }) } : undefined;
}

export async function startRig(
    options: { secret?: string; maxLanes?: number; input?: InputSink; recognizer?: RecognizerFactory; maxUtteranceSeconds?: number; maxReplySeconds?: number; speechObserver?: SpeechObserverSettings | false; yieldBots?: WorkerOptions['yieldBots']; spaceName?: string } = {}
): Promise<Rig> {
    // false: without it even in a run of the whole suite with it on (the test that compares with and without)
    const speechObserver = options.speechObserver === false ? undefined : (options.speechObserver ?? observerFromEnv());
    const worker = new VoiceWorker({
        speechObserver,
        port: 0,
        host: '127.0.0.1',
        secret: options.secret,
        maxLanes: options.maxLanes ?? 50,
        maxSessionsPerConnection: 8,
        ice: { iceServers: [] },
        input: options.input,
        recognizer: options.recognizer,
        maxUtteranceSeconds: options.maxUtteranceSeconds,
        maxReplySeconds: options.maxReplySeconds,
        yieldBots: options.yieldBots,
    });
    const workerPort = await worker.listen();
    const report = process.env.VOICE_TEST_SPEECH_OBSERVER_REPORT;
    if (report && speechObserver) {
        const close = worker.close.bind(worker);
        worker.close = async () => {
            const c = worker.counters;
            appendFileSync(
                report,
                `${JSON.stringify({
                    loaded: c.get('observer_loaded'),
                    unavailable: c.get('observer_unavailable'),
                    completed: c.get('observer_windows_completed'),
                    accepted: c.get('observer_windows_accepted'),
                    revoked: c.get('observer_windows_revoked'),
                    stale: c.get('observer_windows_stale'),
                    expired: c.get('observer_windows_expired'),
                    failed: c.get('observer_windows_failed'),
                    streams: c.get('observer_streams'),
                    ended: c.get('observer_streams_ended'),
                    errors: c.get('observer_errors'),
                    timedOut: c.get('observer_timed_out'),
                    overflowMs: Math.round(c.get('observer_overflow_ms')),
                    expiredMs: Math.round(c.get('observer_expired_ms')),
                    refusedAfterClose: c.get('observer_refused_closed'),
                    baseline: c.get('observer_baseline'),
                    firings: c.get('observer_firings'),
                    agree: c.get('observer_agree'),
                })}\n`
            );
            await close();
        };
    }
    const game = new FakeGame();
    if (options.spaceName) game.spaceName = options.spaceName;
    const violations: string[] = [];
    const fromWorker: FromWorker[] = [];
    const toWorker: ToWorker[] = [];
    let link!: WorkerLink;
    const calls = new VoiceCalls(
        'bot1',
        game,
        (handlers) => {
            link = new WorkerLink({
                url: `ws://127.0.0.1:${workerPort}`,
                botId: 'bot1',
                secret: options.secret,
                onMessage: (message) => {
                    fromWorker.push(message);
                    const problem = checkMessage('fromWorker', message);
                    if (problem) violations.push(`from worker: ${problem}`);
                    handlers.onMessage(message);
                },
                onUp: handlers.onUp,
                onDown: handlers.onDown,
            });
            const send = link.send.bind(link);
            link.send = (message: ToWorker) => {
                toWorker.push(message);
                const problem = checkMessage('fromBot', JSON.parse(JSON.stringify(message)));
                if (problem) violations.push(`to worker: ${problem}`);
                return send(message);
            };
            link.start();
            return link;
        }
    );
    await waitFor('the bot server to reach the worker', () => link.isUp());
    return { worker, calls, game, violations, fromWorker, toWorker, workerPort, link: () => link };
}
