// Turn-end logic for one lane. Two sources, chosen per engine process:
//   local    : VAD stop -> Smart Turn v3 on the last <= 8 s; INCOMPLETE keeps waiting; stop_secs (3 s) of silence ends it anyway.
//              Same logic as pipecat's BaseSmartTurn + TurnAnalyzerUserTurnStopStrategy with the settings pinned in the Python engine.
//   provider : the fake STT says "end of turn" after `providerSilenceMs` of silence. No Smart Turn.
import { smartTurnProbability } from './models.ts';

export const SMART_TURN = { stopSecs: 3.0, preSpeechMs: 500, maxDurationSecs: 8.0, vadStartSecs: 0.2 };
export interface TurnResult { reason: 'smart_turn' | 'stop_secs_timeout' | 'provider_eot'; probability?: number; inferenceMs?: number }
export interface SmartTurnLogEntry { turnId: string; complete: boolean; probability: number; ms: number }

export class TurnLocal {
  private chunks: Int16Array[] = []; private base = 0; private total = 0; private startIdx = -1; private userSpeaking = false; private triggered = false; private silenceMs = 0;
  constructor(private onComplete: (r: TurnResult) => void, private log: (e: { complete: boolean; probability: number; ms: number }) => void) {}
  vadStart() { this.userSpeaking = true; if (this.startIdx < 0) this.startIdx = this.total; }
  async vadStop() {
    this.userSpeaking = false;
    const t0 = performance.now();
    const seg = this.segment(); if (!seg.length) return;
    const { probability } = await smartTurnProbability(seg);
    const ms = performance.now() - t0; const complete = probability > 0.5;
    this.log({ complete, probability, ms });
    if (complete) { this.clear(); this.onComplete({ reason: 'smart_turn', probability, inferenceMs: ms }); }
  }
  /** One 20 ms (320 sample) frame at 16 kHz. */
  frame(pcm: Int16Array) {
    this.chunks.push(pcm); this.total += pcm.length;
    if (this.userSpeaking) { this.silenceMs = 0; this.triggered = true; }
    else if (this.triggered) {
      this.silenceMs += (pcm.length / 16000) * 1000;
      if (this.silenceMs >= SMART_TURN.stopSecs * 1000) { this.clear(); this.onComplete({ reason: 'stop_secs_timeout' }); }
    } else { // before speech: keep only what Smart Turn may need
      const keep = (SMART_TURN.preSpeechMs / 1000 + SMART_TURN.stopSecs + SMART_TURN.maxDurationSecs) * 16000;
      while (this.chunks.length && this.total - this.base - this.chunks[0].length > keep) { this.base += this.chunks[0].length; this.chunks.shift(); }
    }
  }
  private segment(): Float32Array {
    const all = new Int16Array(this.chunks.reduce((n, c) => n + c.length, 0)); let p = 0; for (const c of this.chunks) { all.set(c, p); p += c.length; }
    const pre = Math.round(((SMART_TURN.preSpeechMs + SMART_TURN.vadStartSecs * 1000) / 1000) * 16000);
    const from = Math.max(0, (this.startIdx < 0 ? this.base : this.startIdx) - pre - this.base);
    const max = SMART_TURN.maxDurationSecs * 16000; const seg = all.subarray(from); const cut = seg.length > max ? seg.subarray(seg.length - max) : seg;
    return Float32Array.from(cut, (v) => v / 32768);
  }
  clear() { this.chunks = []; this.base = this.total; this.startIdx = -1; this.triggered = false; this.silenceMs = 0; }
  reset() { this.clear(); this.userSpeaking = false; }
  get open() { return this.userSpeaking || this.triggered; }
}
