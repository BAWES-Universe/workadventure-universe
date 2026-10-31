// A bubble = one session = one bot + one or more human lanes. Owns the bridge socket, bot speech, mode and voice state.
import { WebSocket } from 'ws';
import type { Engine } from './main.ts';
import { Lane } from './lane.ts';
import { Up2 } from './dsp.ts';
import { FRAME_MS, TTS_RATE, FakeTts } from './fakes.ts';
import { newOpusEncoder, now, sleep } from '../../common/util.ts';
import type { Mode } from '../../bridge/src/protocol.ts';

const GRACE_MS = 8000;
const MODES = new Set(['off', 'listen_only', 'talk', 'type_and_listen', 'speak_and_read']);

class Bridge {
  ws!: WebSocket; closed = false; private onMsg!: (m: any) => void;
  constructor(private url: string, private sid: string, private c: Record<string, number>) {}
  async connect(onMsg: (m: any) => void) {
    this.onMsg = onMsg; this.ws = new WebSocket(this.url);
    await new Promise<void>((ok, fail) => { this.ws.once('open', () => ok()); this.ws.once('error', fail); });
    this.ws.on('message', (d) => { let m: any; try { m = JSON.parse(String(d)); } catch { this.c.bridge_bad_in = (this.c.bridge_bad_in ?? 0) + 1; return; } this.c.bridge_in = (this.c.bridge_in ?? 0) + 1; this.onMsg(m); });
    this.ws.on('close', () => { this.closed = true; });
  }
  async send(type: string, f: Record<string, unknown> = {}) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.c.bridge_out = (this.c.bridge_out ?? 0) + 1;
    this.ws.send(JSON.stringify({ type, sessionId: this.sid, ts: now(), ...f }));
  }
  close() { this.closed = true; try { this.ws.close(); } catch { /* ignore */ } }
}

interface Segment { sid: string; text: string; totalMs: number; playedMs: number; deliveredAll: boolean }

class Speaker {
  queue: Segment[] = []; current?: Segment; speaking = false; private cancel = false; private wake?: () => void; private stopped = false;
  private enc = newOpusEncoder(32000); private done: Promise<void>;
  constructor(private b: Bubble) { this.done = this.run(); }
  enqueue(s: Segment) { this.queue.push(s); this.wake?.(); }
  retract(sid: string): [Segment | undefined, 'queued' | 'playing' | 'unknown'] {
    const i = this.queue.findIndex((s) => s.sid === sid); if (i >= 0) return [this.queue.splice(i, 1)[0], 'queued'];
    if (this.current?.sid === sid) { this.cancel = true; return [this.current, 'playing']; }
    return [undefined, 'unknown'];
  }
  stopCurrent() { if (this.speaking) this.cancel = true; }
  async shutdown() { this.stopped = true; this.cancel = true; this.wake?.(); await this.done; }
  private async run() {
    const tts: FakeTts = this.b.engine.tts, c = this.b.engine.counters;
    while (!this.stopped) {
      if (!this.queue.length) await new Promise<void>((r) => { this.wake = r; }); this.wake = undefined;
      const seg = this.queue.shift(); if (!seg || this.stopped) continue;
      this.current = seg; this.speaking = true; this.cancel = false;
      const pcm = tts.synth(seg.text); seg.totalMs = (pcm.length / tts.chunk) * FRAME_MS;
      c.tts_generated_ms = (c.tts_generated_ms ?? 0) + seg.totalMs; c.segments_started = (c.segments_started ?? 0) + 1;
      const up = new Up2(); this.enc.reset?.();
      const t0 = performance.now(); let k = 0, interrupted = false, reason = 'completed', lastProg = t0;
      for (let off = 0; off < pcm.length; off += tts.chunk) {
        if (this.cancel || !this.b.shouldContinue()) { interrupted = true; reason = this.b.stopReason ?? (this.b.voice !== 'active' ? 'voice_stop' : 'mode'); break; }
        const targets = [...this.b.lanes.values()].filter((l) => l.plays() && !l.gone);
        if (targets.length) {
          const chunk = pcm.subarray(off, off + tts.chunk); if (chunk.length !== tts.chunk) throw new Error('bad chunk size');
          const s16 = new Int16Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length));
          const payload = Buffer.from(this.enc.encode(up.process(s16)));
          for (const l of targets) l.sendOpus(payload);
          seg.playedMs += FRAME_MS;
        } else seg.deliveredAll = false;
        k++;
        if (performance.now() - lastProg > 500) { lastProg = performance.now(); void this.b.bridge.send('playback.progress', { segmentId: seg.sid, playedMs: seg.playedMs, totalMs: seg.totalMs, finished: false, interrupted: false }); }
        const delay = t0 + k * FRAME_MS - performance.now(); if (delay > 0) await sleep(delay);
      }
      this.speaking = false; this.current = undefined;
      if (interrupted) { c.segments_cancelled = (c.segments_cancelled ?? 0) + 1; c.tts_cancelled_ms = (c.tts_cancelled_ms ?? 0) + (seg.totalMs - seg.playedMs); }
      else { c.segments_completed = (c.segments_completed ?? 0) + 1; if (!seg.deliveredAll) reason = 'lane_loss'; }
      c.tts_played_ms = (c.tts_played_ms ?? 0) + seg.playedMs;
      await this.b.bridge.send('playback.progress', { segmentId: seg.sid, playedMs: seg.playedMs, totalMs: seg.totalMs, finished: true, interrupted, reason });
      this.b.stopReason = undefined;
    }
  }
}

export class Bubble {
  defaultMode: Mode = 'talk'; voice: 'active' | 'stopped' = 'active'; lanes = new Map<string, Lane>(); bridge: Bridge; speaker!: Speaker;
  stopReason?: string; started = false; closing = false; private grace?: NodeJS.Timeout; private statusTimer?: NodeJS.Timeout; private lock: Promise<unknown> = Promise.resolve();
  constructor(public engine: Engine, public sid: string, public bubbleId: string) { this.bridge = new Bridge(`${engine.brainUrl}/bridge`.replace(/^http/, 'ws'), sid, engine.counters); }

  addLane(pid: string, idx: number, sdp: string): Promise<string> { const r = this.lock.then(() => this.addLaneInner(pid, idx, sdp)); this.lock = r.catch(() => {}); return r; }
  private async addLaneInner(pid: string, idx: number, sdp: string): Promise<string> {
    clearTimeout(this.grace); this.grace = undefined;
    if (!this.started) {
      await this.bridge.connect((m) => void this.onBrain(m));
      this.speaker = new Speaker(this); this.started = true;
      await this.bridge.send('session.start', { bubbleId: this.bubbleId, participants: [{ participantId: pid, lane: idx }], mode: this.defaultMode, engine: { id: this.engine.engineId, kind: 'ts', turnEnd: this.engine.turnEnd } });
      this.statusTimer = setInterval(() => { void this.sendStatus(); this.watchdog(); }, 1000);
    }
    const old = this.lanes.get(pid); const rejoin = !!old; if (old) await old.stop();
    const lane = new Lane(this, pid, idx); if (old) lane.mode = old.mode; if (old?.hint) lane.hint = old.hint;
    this.lanes.set(pid, lane);
    const answer = await lane.start(sdp);
    await this.bridge.send('participant.join', { participantId: pid, lane: idx, rejoin });
    return answer;
  }

  async laneGone(lane: Lane, reason: string) {
    if (lane.gone || this.closing) return;
    lane.gone = true;
    await this.bridge.send('participant.leave', { participantId: lane.pid, lane: lane.idx, reason });
    void lane.stop();
    if ([...this.lanes.values()].every((l) => l.gone)) this.grace = setTimeout(() => void this.close(), GRACE_MS);
  }

  /** A peer that vanished without a clean close is not always signalled. No inbound audio for 3 s = lane lost. */
  private watchdog() { for (const l of this.lanes.values()) if (!l.gone && performance.now() - l.lastFrameAt > 3000) { this.engine.counters.lane_watchdog = (this.engine.counters.lane_watchdog ?? 0) + 1; void this.laneGone(l, 'failed'); } }

  shouldContinue() {
    if (this.voice !== 'active') return false;
    const live = [...this.lanes.values()].filter((l) => !l.gone);
    return live.length === 0 || live.some((l) => l.plays());
  }

  /** Local, no round trip to the brain. Stops bot audio for every lane. */
  async bargeIn(_src: Lane) {
    if (!this.speaker.speaking && !this.speaker.queue.length) return;
    const t = performance.now(); this.stopReason = 'barge_in'; this.speaker.stopCurrent();
    const queued = this.speaker.queue.splice(0);
    for (const s of queued) { await this.bridge.send('playback.progress', { segmentId: s.sid, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'barge_in' }); this.engine.counters.segments_cancelled = (this.engine.counters.segments_cancelled ?? 0) + 1; }
    this.engine.counters.barge_ins = (this.engine.counters.barge_ins ?? 0) + 1; this.engine.bargeInMs.push(performance.now() - t);
  }

  async stopVoice(_reason: string) {
    this.voice = 'stopped'; this.stopReason = 'voice_stop'; this.speaker.stopCurrent();
    for (const s of this.speaker.queue.splice(0)) await this.bridge.send('playback.progress', { segmentId: s.sid, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'voice_stop' });
    await this.sendStatus();
  }

  async onBrain(m: any) {
    const c = this.engine.counters;
    switch (m.type) {
      case 'bot.say': {
        const reject = async () => { c.say_rejected = (c.say_rejected ?? 0) + 1; await this.bridge.send('playback.progress', { segmentId: m.segmentId ?? '?', playedMs: 0, totalMs: 0, finished: true, interrupted: false, reason: 'rejected' }); };
        if (m.committed !== true || typeof m.text !== 'string' || !m.text || this.voice !== 'active') return reject();
        this.speaker.enqueue({ sid: m.segmentId, text: m.text, totalMs: 0, playedMs: 0, deliveredAll: true }); break;
      }
      case 'bot.retract': {
        const [seg, where] = this.speaker.retract(m.segmentId);
        if (where === 'queued') await this.bridge.send('playback.progress', { segmentId: seg!.sid, playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'retract' });
        else if (where === 'playing') this.stopReason = 'retract';
        break;
      }
      case 'mode.set': {
        if (!MODES.has(m.mode)) return;
        const targets = m.participantId ? [this.lanes.get(m.participantId)].filter(Boolean) as Lane[] : [...this.lanes.values()];
        if (!m.participantId) this.defaultMode = m.mode;
        for (const l of targets) l.mode = m.mode;
        if (this.speaker.speaking && !this.shouldContinue()) this.stopReason = 'mode';
        await this.sendStatus(); break;
      }
      case 'voice.stop': await this.stopVoice(m.reason ?? 'other'); break;
      case 'session.end': await this.close(); break;
    }
  }

  async sendStatus() {
    await this.bridge.send('engine.status', { engineId: this.engine.engineId, voice: this.voice, mode: this.defaultMode,
      lanes: [...this.lanes.values()].filter((l) => !l.gone).map((l) => ({ participantId: l.pid, lane: l.idx, healthy: l.healthy(), mode: l.mode })),
      counters: { ...this.engine.counters } });
  }

  async close() {
    if (this.closing) return; this.closing = true; clearInterval(this.statusTimer); clearTimeout(this.grace);
    await this.speaker?.shutdown();
    await Promise.allSettled([...this.lanes.values()].map((l) => l.stop()));
    this.bridge.close(); this.engine.bubbles.delete(this.sid);
  }
}
void TTS_RATE;
