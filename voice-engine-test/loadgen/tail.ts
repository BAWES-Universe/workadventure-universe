// Polls the fake brain's event log and lets scenarios wait for events. Also keeps the full log.
import { sleep } from '../common/util.ts';
export interface Ev { n: number; recvAt: number; dir: 'in' | 'out' | 'brain'; sessionId: string; msg: any }
export class BrainTail {
  all: Ev[] = []; bySid = new Map<string, Ev[]>(); last = 0; private stopped = false; private waiters: { pred: (e: Ev) => boolean; ok: (e: Ev) => void; t: NodeJS.Timeout }[] = [];
  constructor(public base: string, private pollMs = 40) {}
  start() { void this.loop(); return this; }
  stop() { this.stopped = true; }
  private async loop() {
    while (!this.stopped) {
      try {
        const r = await fetch(`${this.base}/events?since=${this.last}`); const j: any = await r.json();
        for (const e of j.events as Ev[]) { this.all.push(e); let l = this.bySid.get(e.sessionId); if (!l) this.bySid.set(e.sessionId, (l = [])); l.push(e); this.last = Math.max(this.last, e.n); this.waiters = this.waiters.filter((w) => { if (w.pred(e)) { clearTimeout(w.t); w.ok(e); return false; } return true; }); }
      } catch { /* brain not up yet */ }
      await sleep(this.pollMs);
    }
  }
  /** Resolves with the first FUTURE event matching pred, or undefined after timeoutMs. */
  waitFor(pred: (e: Ev) => boolean, timeoutMs: number): Promise<Ev | undefined> {
    return new Promise((ok) => { const w = { pred, ok, t: setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); ok(undefined); }, timeoutMs) }; this.waiters.push(w); });
  }
  find(pred: (e: Ev) => boolean) { return this.all.filter(pred); }
  async post(path: string, body: any) { const r = await fetch(`${this.base}${path}`, { method: 'POST', body: JSON.stringify(body) }); return r.json() as Promise<any>; }
  async get(path: string) { const r = await fetch(`${this.base}${path}`); return r.json() as Promise<any>; }
}
