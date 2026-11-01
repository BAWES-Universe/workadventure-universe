// Test harness: a fake person's browser (a werift peer connection that signals the way the game's simple-peer does)
// and a fake game side for the bot server's relay. No browser, no network beyond loopback, no speech provider.
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, useOPUS, useVP8 } from 'werift';
import { Decoder, Encoder } from '@evan/opus';
import { VoiceCalls, type GameSide } from '../../bots/voice/VoiceCalls.ts';
import { WorkerLink } from '../../bots/voice/VoiceLink.ts';
import type { FromWorker, ToWorker } from '../../bots/voice/protocol.ts';
import { checkMessage } from '../src/validate.ts';
import { VoiceWorker } from '../src/server.ts';
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

    constructor(readonly id: string, private readonly withVideo = false) {}

    /** Builds the offer (and the trickled candidates) a browser would send, as JSON strings. */
    async offer(): Promise<string[]> {
        this.pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [useVP8()] }, iceServers: [], iceUseIpv6: false });
        this.pc.addTransceiver(this.mic, { direction: 'sendrecv' });
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
                    if (rms(pcm) > 300) this.loudFrames++;
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
    readonly spaceName = 'proximity-1';
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

export async function startRig(options: { secret?: string; maxLanes?: number; input?: InputSink } = {}): Promise<Rig> {
    const worker = new VoiceWorker({
        port: 0,
        host: '127.0.0.1',
        secret: options.secret,
        maxLanes: options.maxLanes ?? 50,
        maxSessionsPerConnection: 8,
        ice: { iceServers: [] },
        input: options.input,
    });
    const workerPort = await worker.listen();
    const game = new FakeGame();
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
