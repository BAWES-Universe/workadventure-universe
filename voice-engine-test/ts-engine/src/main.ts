// Thin TypeScript voice engine (engine A). One Node process, one werift PeerConnection per human lane.
// Usage: node --import tsx ts-engine/src/main.ts --turn-end local|provider [--brain ws://127.0.0.1:8800] [--signaling ws://127.0.0.1:8700] [--stats-port 8811]
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { Bubble } from './bubble.ts';
import { FakeTts } from './fakes.ts';
import { loadModels } from './models.ts';
import { cfg } from './config.ts';
import { pct, sleep } from '../../common/util.ts';

export class Engine {
  turnEnd: 'local' | 'provider'; providerSilenceMs: number; emotionStub: boolean; brainUrl: string; engineId: string; tts = new FakeTts();
  counters: Record<string, number> = {}; failures: string[] = []; bubbles = new Map<string, Bubble>(); lags: number[] = []; bargeInMs: number[] = [];
  private hints = new Map<string, { clipId: string; text?: string }>(); private win = { t: Date.now(), cpu: process.cpuUsage() };
  constructor(a: { turnEnd: 'local' | 'provider'; providerSilenceMs: number; emotionStub: boolean; brain: string }) { this.emotionStub = a.emotionStub; this.turnEnd = a.turnEnd; this.providerSilenceMs = a.providerSilenceMs; this.brainUrl = a.brain; this.engineId = `ts-${a.turnEnd}-${process.pid}`; }
  fail(msg: string) { this.counters.lane_failures = (this.counters.lane_failures ?? 0) + 1; this.failures.push(msg); console.error('FAIL', msg); }

  async signalingLoop(url: string, stop: () => boolean) {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/engine`);
    await new Promise<void>((ok, fail) => { ws.once('open', () => ok()); ws.once('error', fail); });
    ws.send(JSON.stringify({ type: 'engine.hello', engineId: this.engineId, kind: 'ts', turnEnd: this.turnEnd }));
    console.error(`registered with signaling ${url} as ${this.engineId}`);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'offer') void this.offer(ws, m);
      else if (m.type === 'fake.clip') { const l = this.bubbles.get(m.sessionId)?.lanes.get(m.participantId); const h = { clipId: m.clipId, text: m.text }; if (l) l.hint = h; else this.hints.set(`${m.sessionId}/${m.participantId}`, h); }
      else if (m.type === 'hangup') { const b = this.bubbles.get(m.sessionId); const l = b?.lanes.get(m.participantId); if (b && l) void b.laneGone(l, 'left'); }
    });
    await new Promise<void>((r) => { ws.on('close', () => r()); const t = setInterval(() => { if (stop()) { clearInterval(t); ws.close(); r(); } }, 200); });
  }

  private async offer(ws: WebSocket, m: any) {
    try {
      let b = this.bubbles.get(m.sessionId); if (!b || b.closing) { b = new Bubble(this, m.sessionId, m.bubbleId ?? m.sessionId); this.bubbles.set(m.sessionId, b); }
      const sdp = await b.addLane(m.participantId, m.lane, m.sdp);
      const h = this.hints.get(`${m.sessionId}/${m.participantId}`); if (h) { b.lanes.get(m.participantId)!.hint = h; this.hints.delete(`${m.sessionId}/${m.participantId}`); }
      ws.send(JSON.stringify({ type: 'answer', reqId: m.reqId, sdp }));
    } catch (e: any) { this.counters.offer_failures = (this.counters.offer_failures ?? 0) + 1; this.failures.push(`offer: ${e?.stack ?? e}`); ws.send(JSON.stringify({ type: 'error', reqId: m.reqId, message: String(e?.message ?? e) })); }
  }

  /** Event-loop delay: how late a 20 ms sleep wakes up (same probe as the Python engine). */
  async lagProbe(stop: () => boolean) { while (!stop()) { const t = performance.now(); await sleep(20); this.lags.push(performance.now() - t - 20); if (this.lags.length > 200000) this.lags.splice(0, 100000); } }

  stats(reset = false) {
    const wall = (Date.now() - this.win.t) / 1000; const u = process.cpuUsage(this.win.cpu); const cpu = (u.user + u.system) / 1e6;
    const rss = Number(readFileSync('/proc/self/status', 'utf8').match(/VmRSS:\s+(\d+)/)![1]) / 1024;
    const lanes = [...this.bubbles.values()].flatMap((b) => [...b.lanes.values()].map((l) => ({ sid: b.sid, pid: l.pid, healthy: l.healthy(), gone: l.gone, mode: l.mode })));
    const s = [...this.lags].sort((a, b) => a - b), bi = [...this.bargeInMs].sort((a, b) => a - b);
    const out = { engineId: this.engineId, kind: 'ts', turnEnd: this.turnEnd, pid: process.pid, windowSeconds: wall, cpuSeconds: cpu, cpuPctOfOneCore: wall ? (100 * cpu) / wall : 0, rssMb: rss,
      loopLagMs: { n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] ?? 0 }, bargeInStopMs: { n: bi.length, p50: pct(bi, 50), p95: pct(bi, 95) },
      counters: { ...this.counters }, failures: [...this.failures], lanes,
      smartTurn: [...this.bubbles.values()].flatMap((b) => [...b.lanes.values()].filter((l) => l.smartTurnLog.length).map((l) => ({ lane: l.pid, log: l.smartTurnLog.slice(-50).map((e) => [e.turnId, e.complete, e.probability, e.ms]) }))) };
    if (reset) { this.lags = []; this.bargeInMs = []; this.win = { t: Date.now(), cpu: process.cpuUsage() }; }
    return JSON.parse(JSON.stringify(out, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
  }
}

const { values: v } = parseArgs({ options: { 'turn-end': { type: 'string' }, 'provider-silence-ms': { type: 'string', default: '500' }, brain: { type: 'string', default: 'ws://127.0.0.1:8800' }, signaling: { type: 'string', default: 'ws://127.0.0.1:8700' }, 'stats-port': { type: 'string', default: '8811' }, 'emotion-stub': { type: 'boolean', default: false } } });
if (v['turn-end'] !== 'local' && v['turn-end'] !== 'provider') { console.error('--turn-end local|provider required'); process.exit(2); }
cfg.signalingUrl = v.signaling!.replace(/^ws/, 'http');
await loadModels();
const eng = new Engine({ turnEnd: v['turn-end'], providerSilenceMs: Number(v['provider-silence-ms']), emotionStub: !!v['emotion-stub'], brain: v.brain! });
let stopping = false; const stop = () => stopping;
const server = http.createServer((req, res) => {
  const u = new URL(req.url!, 'http://x'); res.writeHead(200, { 'content-type': 'application/json' });
  res.end(u.pathname === '/stats' ? JSON.stringify(eng.stats(u.searchParams.get('reset') === '1')) : JSON.stringify({ ok: true }));
});
await new Promise<void>((r) => server.listen(Number(v['stats-port']), '127.0.0.1', r));
const lag = eng.lagProbe(stop);
const sig = eng.signalingLoop(v.signaling!, stop);
console.error(`ts engine up: turn-end=${v['turn-end']} stats=:${v['stats-port']}`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { stopping = true; });
let rc = 0;
try { await Promise.race([sig, lag]); } catch (e) { console.error('engine task died', e); rc = 1; }
stopping = true;
await Promise.allSettled([...eng.bubbles.values()].map((b) => b.close()));
server.closeAllConnections(); await new Promise((r) => server.close(r)); await Promise.allSettled([lag, sig]);
process.exitCode = rc;
