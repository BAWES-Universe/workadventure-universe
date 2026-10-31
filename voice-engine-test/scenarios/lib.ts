import { Human, type SpeakResult } from '../loadgen/human.ts';
import type { Stack } from './stack.ts';
import type { Ev } from '../loadgen/tail.ts';
import { sleep, now, summarize, manifest } from '../common/util.ts';

export type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN' | 'N/A';
export interface Result { id: string; status: Status; reason: string; evidence: Record<string, unknown> }
export const LONG_TEXT = 'This is a long answer from the test bot. It keeps talking for quite a while so that a person has plenty of time to talk over it, or for the voice to be stopped.'; // 9.5 s of audio

export async function until(fn: () => boolean, timeoutMs: number, step = 40): Promise<boolean> {
  const t0 = Date.now(); while (Date.now() - t0 < timeoutMs) { if (fn()) return true; await sleep(step); } return fn();
}
export class Ctx {
  n = 0;
  constructor(public st: Stack) {}
  sid(name: string) { return `${name}-${this.st.o.engine}-${this.st.o.turnEnd}-${++this.n}-${Date.now() % 100000}`; }
  async human(sid: string, pid: string) { const h = new Human({ participantId: pid, sessionId: sid, signaling: this.st.signalingUrl }); await h.connect(); return h; }
  evs(sid: string, pred: (e: Ev) => boolean = () => true) { return this.st.tail.all.filter((e) => e.sessionId === sid && pred(e)); }
  inMsgs(sid: string, type: string) { return this.evs(sid, (e) => e.dir === 'in' && e.msg.type === type); }
  finals(sid: string, pid?: string) { return this.evs(sid, (e) => e.dir === 'in' && e.msg.type === 'user.turn' && !e.msg.partial && (!pid || e.msg.participantId === pid)); }
  progress(sid: string, segId: string) { return this.evs(sid, (e) => e.dir === 'in' && e.msg.type === 'playback.progress' && e.msg.segmentId === segId); }
  async admin(cmd: string, body: any) { return this.st.tail.post(`/admin/${cmd}`, body); }
  async cfg(c: any) { return this.st.tail.post('/config', c); }
  async finished(sid: string, segId: string, timeoutMs: number) { return until(() => this.progress(sid, segId).some((e) => e.msg.finished), timeoutMs); }
  final(sid: string, segId: string) { return this.progress(sid, segId).find((e) => e.msg.finished)?.msg; }
  /** Wait for the human to hear the start of bot audio newer than `after`. */
  async hears(h: Human, after: number, timeoutMs = 6000) { await until(() => !!h.firstAudibleAfter(after), timeoutMs); return h.firstAudibleAfter(after); }
}
export const clipsLang = (lang: string) => Object.entries(manifest().clips).filter(([id, c]) => c.lang === lang && id !== 'en_yes').map(([id]) => id);
export type { SpeakResult };
export { summarize, now, sleep };
