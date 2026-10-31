// A simulated human: a real WebRTC peer (werift) that sends fixed, checksummed clips as Opus and records the bot audio it gets back.
// Mic audio is pre-encoded once, so the load generator itself stays cheap. It sends a continuous 50 packets/s stream
// (digital silence between clips), like a browser with an open mic.
import { createHash } from 'node:crypto';
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader, useOPUS } from 'werift';
import { ROOT, manifest, readWav, opusPackets, newOpusDecoder, asInt16, rms, now, rng, sleep } from '../common/util.ts';

export const AUDIBLE_RMS = 250;
const clipCache = new Map<string, { packets: Buffer[]; durationMs: number }>();
export function loadClip(id: string) {
  let c = clipCache.get(id); if (c) return c;
  const info = manifest().clips[id]; if (!info) throw new Error(`unknown clip ${id}`);
  const path = ROOT + 'clips/' + info.file;
  const sha = createHash('sha256').update(readFileSyncBuf(path)).digest('hex');
  if (sha !== info.sha256) throw new Error(`clip ${id} checksum mismatch (${sha})`);
  const w = readWav(path); const packets = opusPackets(w.pcm);
  c = { packets, durationMs: packets.length * 20 }; clipCache.set(id, c); return c;
}
import { readFileSync as readFileSyncBuf } from 'node:fs';
let silencePkt: Buffer | undefined;
const silence = () => (silencePkt ??= opusPackets(new Int16Array(960 / 3 * 3))[0]);

export interface RxPacket { at: number; seq: number; ts: number; len: number; audible: boolean }
export interface SpeakOpts { lossPct?: number; gap?: { atMs: number; durMs: number }; hint?: boolean; hintText?: string; seed?: number }
export interface SpeakResult { clipId: string; startAt: number; endAt: number; sent: number; dropped: number; droppedMs: number }

// one shared 20 ms scheduler for all humans in the process
const humans = new Set<Human>(); let tickerRunning = false;
async function runTicker() {
  if (tickerRunning) return; tickerRunning = true;
  const t0 = performance.now(); let k = 0;
  while (humans.size) {
    k++; const due = t0 + k * 20; const wait = due - performance.now(); if (wait > 0) await sleep(Math.max(0, wait - 1));
    for (const h of humans) h.tick();
  }
  tickerRunning = false;
}

export class Human {
  pc?: RTCPeerConnection; track?: MediaStreamTrack; lane = -1;
  private seq = 0; private ts = 0; private ssrc = 1000 + Math.floor(Math.random() * 1e6); private dec = newOpusDecoder();
  connectedAt = 0; closed = false;
  sent = 0; sentBytes = 0; rxCount = 0; rxBytes = 0; rxAudible = 0; sendErrors = 0; rxErrors = 0;
  rx: RxPacket[] = [];
  private cur?: { clipId: string; packets: Buffer[]; idx: number; startAt: number; res: SpeakResult; done: (r: SpeakResult) => void; rand: () => number; opts: SpeakOpts };
  constructor(public o: { participantId: string; sessionId: string; bubbleId?: string; signaling: string; keepRx?: boolean }) {}

  async connect() {
    this.closed = false; this.rx = []; this.seq = Math.floor(Math.random() * 60000); this.ts = Math.floor(Math.random() * 1e9); this.ssrc = 1000 + Math.floor(Math.random() * 1e6);
    const pc = (this.pc = new RTCPeerConnection({ codecs: { audio: [useOPUS()], video: [] }, iceUseIpv6: false, iceServers: [] }));
    this.track = new MediaStreamTrack({ kind: 'audio' });
    pc.addTransceiver(this.track, { direction: 'sendrecv' });
    pc.onTrack.subscribe((t) => t.onReceiveRtp.subscribe((rtp) => this.onRtp(rtp)));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    if (pc.iceGatheringState !== 'complete') await new Promise<void>((ok) => pc.iceGatheringStateChange.subscribe((s) => s === 'complete' && ok()));
    const res = await fetch(`${this.o.signaling}/offer`, { method: 'POST', body: JSON.stringify({ sessionId: this.o.sessionId, bubbleId: this.o.bubbleId ?? this.o.sessionId, participantId: this.o.participantId, sdp: pc.localDescription!.sdp, type: 'offer' }) });
    const ans: any = await res.json(); if (!res.ok || !ans.sdp) throw new Error(`signaling: ${JSON.stringify(ans)}`);
    this.lane = ans.lane;
    await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
    await new Promise<void>((ok, fail) => {
      const to = setTimeout(() => fail(new Error('webrtc connect timeout')), 15000);
      const f = () => { if (pc.connectionState === 'connected') { clearTimeout(to); ok(); } else if (pc.connectionState === 'failed') { clearTimeout(to); fail(new Error('webrtc failed')); } };
      pc.connectionStateChange.subscribe(f); f();
    });
    this.connectedAt = now(); humans.add(this); void runTicker();
  }

  private onRtp(rtp: RtpPacket) {
    const at = now(); this.rxCount++; this.rxBytes += rtp.payload.length;
    let audible = false;
    try { const pcm = asInt16(this.dec.decode(rtp.payload)); audible = rms(pcm) > AUDIBLE_RMS; } catch { this.rxErrors++; }
    if (audible) this.rxAudible++;
    if (this.o.keepRx !== false) this.rx.push({ at, seq: rtp.header.sequenceNumber, ts: rtp.header.timestamp, len: rtp.payload.length, audible });
  }

  tick() {
    if (this.closed || !this.track) return;
    let payload: Buffer; let drop = false; let marker = false;
    const c = this.cur;
    if (c) {
      if (c.idx === 0) { c.startAt = now(); marker = true; }
      payload = c.packets[c.idx]; const tMs = c.idx * 20;
      const g = c.opts.gap; if (g && tMs >= g.atMs && tMs < g.atMs + g.durMs) drop = true;
      if (c.opts.lossPct && c.rand() * 100 < c.opts.lossPct) drop = true;
      c.idx++; if (drop) { c.res.dropped++; c.res.droppedMs += 20; }
      c.res.sent++;
      if (c.idx >= c.packets.length) { this.cur = undefined; c.res.endAt = now() + 20; c.res.startAt = c.startAt; setImmediate(() => c.done(c.res)); }
    } else payload = silence();
    const h = new RtpHeader({ sequenceNumber: this.seq & 0xffff, timestamp: this.ts >>> 0, payloadType: 111, ssrc: this.ssrc, marker });
    this.seq = (this.seq + 1) & 0xffff; this.ts = (this.ts + 960) >>> 0;
    if (drop) return;
    this.sent++; this.sentBytes += payload.length;
    try { this.track.writeRtp(new RtpPacket(h, payload)); } catch { this.sendErrors++; }
  }

  /** Plays a clip. Resolves when the last packet has been sent. `hint` tells the fake STT which clip this is (test-only side channel). */
  async speak(clipId: string, opts: SpeakOpts = {}): Promise<SpeakResult> {
    if (this.cur) throw new Error('already speaking');
    const clip = loadClip(clipId);
    if (opts.hint !== false) await fetch(`${this.o.signaling}/hint`, { method: 'POST', body: JSON.stringify({ sessionId: this.o.sessionId, participantId: this.o.participantId, clipId, text: opts.hintText }) });
    return new Promise<SpeakResult>((done) => {
      const res: SpeakResult = { clipId, startAt: 0, endAt: 0, sent: 0, dropped: 0, droppedMs: 0 };
      this.cur = { clipId, packets: clip.packets, idx: 0, startAt: 0, res, done, rand: rng(opts.seed ?? 7), opts };
    });
  }
  get speaking() { return !!this.cur; }

  /** Packets (audible) received in [from, to]. */
  audibleIn(from: number, to = Infinity) { return this.rx.filter((p) => p.audible && p.at >= from && p.at <= to); }
  firstAudibleAfter(t: number) { return this.rx.find((p) => p.audible && p.at >= t); }
  lastAudibleAt() { for (let i = this.rx.length - 1; i >= 0; i--) if (this.rx[i].audible) return this.rx[i].at; return 0; }
  /** End of the audible burst that is running at time t: the last audible packet before a >=gapMs silence. */
  burstEndAfter(t: number, gapMs = 250): number | undefined {
    let last: number | undefined;
    for (const p of this.rx) { if (p.at < t || !p.audible) continue; if (last !== undefined && p.at - last > gapMs) return last; last = p.at; }
    return last !== undefined && now() - last > gapMs ? last : undefined;
  }

  async disconnect(hangup = false) {
    this.closed = true; humans.delete(this);
    if (hangup) await fetch(`${this.o.signaling}/hangup`, { method: 'POST', body: JSON.stringify({ sessionId: this.o.sessionId, participantId: this.o.participantId }) }).catch(() => {});
    try { await this.pc?.close(); } catch { /* ignore */ }
  }
}
