// One person = one lane = one werift peer connection, audio only both ways.
// Inbound: RTP/Opus -> PCM 48k -> 16k -> InputSink (only while the lane's mode listens). Outbound: the speaker encodes
// bot speech once per 20 ms and writes it as RTP on every lane that plays.
import { randomUUID } from 'node:crypto';
import { MediaStreamTrack, RTCPeerConnection, RtpHeader, RtpPacket, useOPUS } from 'werift';
import type { RTCDataChannel } from 'werift';
import { Down3 } from './dsp.ts';
import { asInt16, newOpusDecoder } from './opus.ts';
import { FRAME_MS } from './audioFormat.ts';
import type { Counters } from './counters.ts';
import { type LeaveReason, type Mode, type Signal, modeListens, modePlays } from './protocol.ts';
import type { InputSink, OutputFrame, OutputTarget } from './transport.ts';

export interface IceConfig {
    iceServers?: { urls: string; username?: string; credential?: string }[];
    icePortRange?: [number, number];
    iceAdditionalHostAddresses?: string[];
}

export interface LaneDeps {
    counters: Counters;
    ice: IceConfig;
    input: InputSink;
    sendSignal(lane: Lane, signal: Signal): void;
    /** The media path came up. */
    onConnected(lane: Lane): void;
    /** The media path is gone and will not come back. */
    onGone(lane: Lane, reason: LeaveReason): void;
}

/** How long a connection that dropped may recover before it is given up. */
const DISCONNECT_GRACE_MS = 4000;
/** Gaps larger than this are a restart of the stream, not lost packets. */
const MAX_COUNTED_GAP = 3000;

export class Lane implements OutputTarget {
    mode: Mode;
    gone = false;
    pc?: RTCPeerConnection;
    readonly out = new MediaStreamTrack({ kind: 'audio' });
    private readonly down = new Down3();
    private readonly decoder = newOpusDecoder();
    private expectedSeq = -1;
    private droppedMs = 0;
    private connected = false;
    private chain: Promise<void> = Promise.resolve();
    private disconnectTimer?: NodeJS.Timeout;
    private txSeq = Math.floor(Math.random() * 60000);
    private txTs = Math.floor(Math.random() * 1e9);
    private lastTx = 0;
    private txMarker = true;
    private readonly streamId = `bot-${randomUUID()}`;

    constructor(
        readonly participantId: string,
        readonly epoch: number,
        mode: Mode,
        private readonly deps: LaneDeps,
        /** Whether voice is on for the whole session. */
        private readonly voiceActive: () => boolean
    ) {
        this.mode = mode;
    }

    listening(): boolean {
        return !this.gone && this.voiceActive() && modeListens(this.mode);
    }

    plays(): boolean {
        return !this.gone && this.connected && this.voiceActive() && modePlays(this.mode);
    }

    healthy(): boolean {
        return !this.gone && this.pc?.connectionState === 'connected';
    }

    /** Handles one signal from the person, in order. Failures end the lane. */
    signal(signal: Signal): Promise<void> {
        this.chain = this.chain
            .then(() => this.handleSignal(signal))
            .catch((error) => {
                this.deps.counters.inc('signal_errors');
                console.error(`[voice-worker] signal failed for ${this.participantId}`, error);
                this.deps.onGone(this, 'failed');
            });
        return this.chain;
    }

    private async handleSignal(signal: Signal): Promise<void> {
        if (this.gone) return;
        if (signal.type === 'offer') {
            await this.handleOffer(signal.sdp);
        } else if (signal.type === 'candidate') {
            if (!this.pc) {
                this.deps.counters.inc('signal_dropped');
                return;
            }
            try {
                await this.pc.addIceCandidate(signal.candidate);
            } catch (error) {
                // Browsers may send candidates this stack cannot use (hidden .local addresses); the rest still connect
                this.deps.counters.inc('candidates_unusable');
            }
        } else {
            // An answer is only ever expected from the bot's side
            this.deps.counters.inc('signal_dropped');
        }
    }

    private async handleOffer(sdp: string): Promise<void> {
        const first = !this.pc;
        const pc = this.pc ?? this.createPeer();
        await pc.setRemoteDescription({ type: 'offer', sdp });
        if (first) {
            // The person's microphone comes in, the bot's voice goes out. Anything else in the offer (camera, screen) is refused.
            const audio = pc.getTransceivers().find((t) => t.kind === 'audio');
            if (!audio) throw new Error('offer has no audio');
            audio.setDirection('sendrecv');
            audio.sender.registerTrack(this.out);
            // The browser attaches the incoming track to a stream only when the answer names one
            audio.sender.streamId = this.streamId;
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.deps.sendSignal(this, { type: 'answer', sdp: pc.localDescription!.sdp });
    }

    private createPeer(): RTCPeerConnection {
        const { ice } = this.deps;
        const pc = new RTCPeerConnection({
            codecs: { audio: [useOPUS({ parameters: 'minptime=10;useinbandfec=1' })], video: [] },
            iceUseIpv6: false,
            iceServers: ice.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }],
            icePortRange: ice.icePortRange,
            iceAdditionalHostAddresses: ice.iceAdditionalHostAddresses,
        });
        this.pc = pc;
        pc.onTrack.subscribe((track) => {
            if (track.kind !== 'audio') {
                this.deps.counters.inc('tracks_refused');
                return;
            }
            track.onReceiveRtp.subscribe((rtp) => this.onRtp(rtp));
        });
        pc.onDataChannel.subscribe((channel) => this.onDataChannel(channel));
        pc.connectionStateChange.subscribe((state) => {
            if (this.gone) return;
            if (state === 'connected') {
                clearTimeout(this.disconnectTimer);
                if (!this.connected) {
                    this.connected = true;
                    this.deps.onConnected(this);
                }
            } else if (state === 'closed' || state === 'failed') {
                this.deps.onGone(this, state === 'closed' ? 'closed' : 'failed');
            } else if (state === 'disconnected') {
                this.disconnectTimer = setTimeout(() => {
                    if (!this.gone && pc.connectionState !== 'connected') this.deps.onGone(this, 'failed');
                }, DISCONNECT_GRACE_MS);
            }
        });
        return pc;
    }

    /** The person's browser opens a data channel and expects to hear about our media (see P2PMessages in the game). */
    private onDataChannel(channel: RTCDataChannel): void {
        const announce = () => {
            try {
                channel.send(JSON.stringify({ type: 'constraint', message: { audio: true, video: false } }));
            } catch {
                this.deps.counters.inc('datachannel_errors');
            }
        };
        if (channel.readyState === 'open') announce();
        else channel.stateChanged.subscribe((state) => state === 'open' && announce());
        // Nothing the person sends on it is acted on here
        channel.onMessage.subscribe(() => this.deps.counters.inc('datachannel_in_ignored'));
    }

    // ---- inbound ----

    private onRtp(rtp: RtpPacket): void {
        const c = this.deps.counters;
        // A path that was replaced or closed delivers nothing, even if packets are still in flight
        if (this.gone) {
            c.inc('rtp_stale_in');
            return;
        }
        c.inc('rtp_in');
        const seq = rtp.header.sequenceNumber;
        if (this.expectedSeq >= 0) {
            const gap = (seq - this.expectedSeq) & 0xffff;
            if (gap > 32768) {
                c.inc('rtp_late');
                return;
            }
            if (gap > 0 && gap < MAX_COUNTED_GAP) {
                this.droppedMs += gap * FRAME_MS;
                c.inc('dropped_audio_ms', gap * FRAME_MS);
            }
        }
        this.expectedSeq = (seq + 1) & 0xffff;
        // Not permitted (mode, voice stopped): the packet is dropped before it is decoded
        if (!this.listening()) {
            c.inc('frames_gated');
            return;
        }
        let pcm48: Int16Array;
        try {
            pcm48 = asInt16(this.decoder.decode(rtp.payload)).slice();
        } catch {
            c.inc('decode_errors');
            return;
        }
        const pcm16k = this.down.process(pcm48);
        c.inc('frames_heard');
        c.inc('heard_ms', Math.round(pcm48.length / 48));
        const droppedMs = this.droppedMs;
        this.droppedMs = 0;
        this.deps.input({ participantId: this.participantId, epoch: this.epoch, pcm16k, droppedMs });
    }

    // ---- outbound ----

    /** Writes one 20 ms Opus packet. A new talk spurt gets a marker bit and a timestamp that follows wall time. */
    sendFrame(frame: OutputFrame): void {
        if (!this.plays()) return;
        const payload = frame.opus();
        const now = performance.now();
        if (this.lastTx === 0 || now - this.lastTx > 60) {
            this.txMarker = true;
            if (this.lastTx) this.txTs = (this.txTs + Math.round(((now - this.lastTx) / 1000) * 48000)) >>> 0;
        }
        this.lastTx = now;
        const header = new RtpHeader({ sequenceNumber: this.txSeq, timestamp: this.txTs, payloadType: 111, ssrc: 1, marker: this.txMarker });
        this.txSeq = (this.txSeq + 1) & 0xffff;
        this.txTs = (this.txTs + 960) >>> 0;
        this.txMarker = false;
        try {
            this.out.writeRtp(new RtpPacket(header, payload));
            this.deps.counters.inc('rtp_out');
            this.deps.counters.inc('bytes_out', payload.length);
        } catch {
            this.deps.counters.inc('rtp_out_errors');
        }
    }

    async stop(): Promise<void> {
        this.gone = true;
        this.connected = false;
        clearTimeout(this.disconnectTimer);
        try {
            await this.chain;
        } catch {
            /* already reported */
        }
        try {
            await this.pc?.close();
        } catch {
            /* ignore */
        }
    }
}
