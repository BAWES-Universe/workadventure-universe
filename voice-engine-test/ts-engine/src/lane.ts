// One human = one lane = one werift PeerConnection. Inbound: RTP/Opus -> PCM 48k -> 16k -> Silero VAD -> turn logic -> bridge.
// Outbound: bot speech is encoded once per 20 ms by the bubble and written as RTP on every lane that plays audio.
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader, useOPUS } from 'werift';
import type { Bubble } from './bubble.ts';
import { Down3 } from './dsp.ts';
import { Vad } from './vad.ts';
import { TurnLocal, type TurnResult, type SmartTurnLogEntry } from './turn.ts';
import { clipInfo } from './fakes.ts';
import { newOpusDecoder, asInt16, now } from '../../common/util.ts';
import type { Mode } from '../../bridge/src/protocol.ts';
import { stunUrl } from './config.ts';
import { labelFor } from './emotion.ts';

const FRAME_MS = 20;
export class Lane {
  mode: Mode; hint?: { clipId: string; text?: string };
  pc!: RTCPeerConnection; out = new MediaStreamTrack({ kind: 'audio' });
  gone = false; turnOpen = false; turnSeq = 0; turnId = ''; speechStartedAt = 0; finalText: string | undefined; lastFrameAt = performance.now();
  dropped: { t: number; ms: number }[] = []; smartTurnLog: SmartTurnLogEntry[] = [];
  private down = new Down3(); private dec = newOpusDecoder(); private vad = new Vad(); private local?: TurnLocal;
  private expectedSeq = -1; private chain: Promise<void> = Promise.resolve(); private pending = 0;
  private txSeq = Math.floor(Math.random() * 60000); private txTs = Math.floor(Math.random() * 1e9); private lastTx = 0; private txMarker = true;
  private partialTimer?: NodeJS.Timeout; private eotTimer?: NodeJS.Timeout; private discTimer?: NodeJS.Timeout;
  private lastMetrics?: TurnResult; private turnAudio: Int16Array[] = [];
  constructor(public bubble: Bubble, public pid: string, public idx: number) {
    this.mode = bubble.defaultMode;
    if (bubble.engine.turnEnd === 'local') this.local = new TurnLocal((r) => this.finishTurn(r), (e) => this.smartTurnLog.push({ turnId: this.turnId, ...e, ms: e.ms }));
  }
  listening() { return this.bubble.voice === 'active' && (this.mode === 'talk' || this.mode === 'speak_and_read'); }
  plays() { return this.bubble.voice === 'active' && (this.mode === 'talk' || this.mode === 'listen_only' || this.mode === 'type_and_listen'); }
  healthy() { return !this.gone && this.pc?.connectionState === 'connected' && performance.now() - this.lastFrameAt < 2000; }
  droppedMsSince(t0: number) { return Math.round(this.dropped.filter((d) => d.t >= t0 - 300).reduce((n, d) => n + d.ms, 0)); }

  async start(sdp: string): Promise<string> {
    const pc = (this.pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [] }, iceUseIpv6: false, iceServers: [{ urls: stunUrl() }] }));
    pc.onTrack.subscribe((t) => t.onReceiveRtp.subscribe((rtp) => this.onRtp(rtp)));
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const tr = pc.getTransceivers().find((x) => x.kind === 'audio')!; tr.setDirection('sendrecv'); tr.sender.registerTrack(this.out);
    await pc.setLocalDescription(await pc.createAnswer());
    pc.connectionStateChange.subscribe((s) => {
      if (s === 'closed' || s === 'failed') void this.bubble.laneGone(this, s === 'closed' ? 'closed' : 'failed');
      else if (s === 'disconnected') { this.discTimer = setTimeout(() => { if (!this.gone && pc.connectionState !== 'connected') void this.bubble.laneGone(this, 'failed'); }, 4000); }
      else if (s === 'connected' && this.discTimer) clearTimeout(this.discTimer);
    });
    this.lastFrameAt = performance.now();
    return pc.localDescription!.sdp;
  }

  // ---- inbound ----
  private onRtp(rtp: RtpPacket) {
    const c = this.bubble.engine.counters; c.rtp_in = (c.rtp_in ?? 0) + 1; c.bytes_in = (c.bytes_in ?? 0) + rtp.payload.length;
    const seq = rtp.header.sequenceNumber;
    if (this.expectedSeq >= 0) {
      const gap = (seq - this.expectedSeq) & 0xffff;
      if (gap > 32768) { c.rtp_late = (c.rtp_late ?? 0) + 1; return; } // late or duplicate
      if (gap > 0 && gap < 3000) { this.dropped.push({ t: now(), ms: gap * FRAME_MS }); c.dropped_audio_ms = (c.dropped_audio_ms ?? 0) + gap * FRAME_MS; }
    }
    this.expectedSeq = (seq + 1) & 0xffff;
    let pcm48: Int16Array;
    try { pcm48 = asInt16(this.dec.decode(rtp.payload)).slice(); } catch { c.decode_errors = (c.decode_errors ?? 0) + 1; return; }
    const pcm16 = this.down.process(pcm48); c.frames_in = (c.frames_in ?? 0) + 1;
    this.lastFrameAt = performance.now();
    this.pending++; const t0 = performance.now();
    this.chain = this.chain.then(() => this.process(pcm16)).catch((e) => this.bubble.engine.fail(`lane ${this.pid}: ${e?.stack ?? e}`)).finally(() => {
      this.pending--; const age = performance.now() - t0; c.queue_age_ms_max = Math.max(c.queue_age_ms_max ?? 0, age);
    });
  }

  private async process(pcm: Int16Array) {
    const c = this.bubble.engine.counters;
    if (!this.listening()) {
      if (!this.turnOpen) { c.frames_gated = (c.frames_gated ?? 0) + 1; return; }
      pcm = new Int16Array(pcm.length); // let VAD and the turn logic close the open turn with silence
    }
    if (this.bubble.engine.emotionStub && this.turnOpen && this.turnAudio.length < 1500) this.turnAudio.push(pcm);
    this.local?.frame(pcm);
    await this.vad.feed(pcm, (e) => { if (e === 'start') this.onVadStart(); else this.onVadStop(); });
  }

  private onVadStart() {
    clearTimeout(this.eotTimer);
    this.local?.vadStart();
    if (!this.turnOpen) {
      this.turnOpen = true; this.turnSeq++; this.turnId = `${this.pid}-t${this.turnSeq}`; this.speechStartedAt = now(); this.lastMetrics = undefined; this.turnAudio = [];
      const c = this.bubble.engine.counters; c.vad_starts = (c.vad_starts ?? 0) + 1;
      if (this.listening()) {
        const was = this.bubble.speaker.speaking;
        void this.bubble.bridge.send('user.speech_started', { lane: this.idx, participantId: this.pid, whileBotSpeaking: was, turnId: this.turnId });
        if (was) void this.bubble.bargeIn(this);
      }
    }
    // fake STT: interim text grows while the person speaks
    clearInterval(this.partialTimer);
    const { text, durationMs } = clipInfo(this.hint); const words = text.split(/\s+/); const t0 = performance.now();
    if (words.length > 1) this.partialTimer = setInterval(() => {
      const k = Math.min(words.length - 1, Math.max(1, Math.floor((words.length * (performance.now() - t0)) / durationMs)));
      if (this.listening() && this.turnOpen) { void this.bubble.bridge.send('user.turn', { lane: this.idx, participantId: this.pid, turnId: this.turnId, text: words.slice(0, k).join(' '), partial: true, droppedAudioMs: this.droppedMsSince(this.speechStartedAt) }); this.bubble.engine.counters.stt_partials = (this.bubble.engine.counters.stt_partials ?? 0) + 1; }
    }, 300);
  }

  private onVadStop() {
    clearInterval(this.partialTimer);
    this.finalText = clipInfo(this.hint).text; // fake STT finalises right after VAD stop
    if (this.local) void this.local.vadStop().catch((e) => this.bubble.engine.fail(`smart turn: ${e?.stack ?? e}`));
    else this.eotTimer = setTimeout(() => { this.bubble.engine.counters.stt_provider_eot = (this.bubble.engine.counters.stt_provider_eot ?? 0) + 1; this.finishTurn({ reason: 'provider_eot' }); }, Math.max(0, this.bubble.engine.providerSilenceMs - 200));
  }

  private finishTurn(r: TurnResult) {
    const wasOpen = this.turnOpen; this.turnOpen = false; clearInterval(this.partialTimer);
    const text = this.finalText; this.finalText = undefined;
    if (!wasOpen || !this.listening() || text === undefined) return;
    const dropped = this.droppedMsSince(this.speechStartedAt);
    let emotion; if (this.bubble.engine.emotionStub) { const all = new Int16Array(this.turnAudio.reduce((n, c) => n + c.length, 0)); let p = 0; for (const c of this.turnAudio) { all.set(c, p); p += c.length; } emotion = labelFor(all); this.turnAudio = []; }
    void this.bubble.bridge.send('user.turn', { ...(emotion ? { emotion } : {}), lane: this.idx, participantId: this.pid, turnId: this.turnId, text, partial: false, droppedAudioMs: dropped, incomplete: dropped > 0, speechMs: Math.round(now() - this.speechStartedAt), endReason: r.reason, speechStartedAt: this.speechStartedAt, turnEndedAt: now() });
    const c = this.bubble.engine.counters; c.turns_final = (c.turns_final ?? 0) + 1;
  }

  // ---- outbound ----
  /** Write one 20 ms Opus packet. Talk spurts get a marker bit and a timestamp that follows wall time, like a normal VoIP sender. */
  sendOpus(payload: Buffer) {
    if (this.gone) return;
    const t = performance.now();
    if (this.lastTx === 0 || t - this.lastTx > 60) { this.txMarker = true; if (this.lastTx) this.txTs = (this.txTs + Math.round(((t - this.lastTx) / 1000) * 48000)) >>> 0; }
    this.lastTx = t;
    const h = new RtpHeader({ sequenceNumber: this.txSeq, timestamp: this.txTs, payloadType: 111, ssrc: 1, marker: this.txMarker });
    this.txSeq = (this.txSeq + 1) & 0xffff; this.txTs = (this.txTs + 960) >>> 0; this.txMarker = false;
    try { this.out.writeRtp(new RtpPacket(h, payload)); const c = this.bubble.engine.counters; c.rtp_out = (c.rtp_out ?? 0) + 1; c.bytes_out = (c.bytes_out ?? 0) + payload.length; }
    catch { this.bubble.engine.counters.rtp_out_errors = (this.bubble.engine.counters.rtp_out_errors ?? 0) + 1; }
  }

  async stop() {
    this.gone = true; clearInterval(this.partialTimer); clearTimeout(this.eotTimer); clearTimeout(this.discTimer);
    try { await this.chain; } catch { /* already reported */ }
    try { await this.pc?.close(); } catch { /* ignore */ }
  }
}
