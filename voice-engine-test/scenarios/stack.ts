// Starts the test stack as separate OS processes: fake brain, signaling, one engine. Measures engine CPU/RSS from /proc.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { ROOT, sleep } from '../common/util.ts';
import { BrainTail } from '../loadgen/tail.ts';

export type EngineKind = 'pipecat' | 'ts';
export type TurnEnd = 'local' | 'provider';
export interface StackOpts { engine: EngineKind; turnEnd: TurnEnd; basePort?: number; logDir?: string; brainThinkMs?: number; emotionStub?: boolean; extraArgs?: string[]; env?: Record<string, string> }
const CLK = 100; // Linux USER_HZ

export function procTimes(pid: number) {
  const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
  const rssKb = Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] ?? 0);
  return { cpuSec: (Number(f[11]) + Number(f[12])) / CLK, rssMb: rssKb / 1024, threads: Number(f[17]) };
}

export class Stack {
  procs: ChildProcess[] = []; engineProc!: ChildProcess; tail!: BrainTail;
  brainUrl: string; signalingUrl: string; statsUrl: string; exited: string[] = [];
  constructor(public o: StackOpts) {
    const b = o.basePort ?? 8800;
    this.brainUrl = `http://127.0.0.1:${b}`; this.signalingUrl = `http://127.0.0.1:${b - 100}`; this.statsUrl = `http://127.0.0.1:${b + 11}`;
  }
  private launch(name: string, cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
    const dir = this.o.logDir ?? '/tmp/voice-engine-test-logs'; mkdirSync(dir, { recursive: true });
    const log = createWriteStream(`${dir}/${name}-${this.o.engine}-${this.o.turnEnd}-${this.o.basePort ?? 8800}.log`);
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout!.pipe(log); p.stderr!.pipe(log);
    p.on('exit', (code, sig) => { if (!(p as any)._expected) this.exited.push(`${name} exited code=${code} sig=${sig}`); });
    this.procs.push(p); return p;
  }
  async start() {
    const b = this.o.basePort ?? 8800; const tsx = `${ROOT}node_modules/.bin/tsx`;
    this.launch('brain', 'node', ['--import', 'tsx', `${ROOT}bridge/src/brain.ts`], ROOT, { BRAIN_PORT: String(b), BRAIN_THINK_MS: String(this.o.brainThinkMs ?? 300) });
    this.launch('signaling', 'node', ['--import', 'tsx', `${ROOT}signaling/server.ts`], ROOT, { SIGNALING_PORT: String(b - 100) });
    await this.waitHttp(this.brainUrl); await this.waitHttp(this.signalingUrl);
    const common = ['--turn-end', this.o.turnEnd, '--brain', `ws://127.0.0.1:${b}`, '--signaling', `ws://127.0.0.1:${b - 100}`, '--stats-port', String(b + 11), ...(this.o.emotionStub ? ['--emotion-stub'] : []), ...(this.o.extraArgs ?? [])];
    if (this.o.engine === 'pipecat') this.engineProc = this.launch('engine', `${ROOT}pipecat-engine/.venv/bin/python`, ['-m', 'engine.main', ...common], `${ROOT}pipecat-engine`, this.o.env);
    else this.engineProc = this.launch('engine', 'node', ['--import', 'tsx', `${ROOT}ts-engine/src/main.ts`, ...common], ROOT, this.o.env);
    await this.waitHttp(this.statsUrl + '/healthz', 60000);
    for (let i = 0; i < 100; i++) { const j: any = await (await fetch(this.signalingUrl + '/engine-info')).json(); if (j.connected) break; await sleep(100); }
    void tsx; this.tail = new BrainTail(this.brainUrl).start();
    return this;
  }
  async waitHttp(url: string, ms = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { await fetch(url); return; } catch { await sleep(150); } }
    throw new Error(`timeout waiting for ${url}`);
  }
  stats(reset = false): Promise<any> { return fetch(`${this.statsUrl}/stats${reset ? '?reset=1' : ''}`).then((r) => r.json()); }
  cpu() { return procTimes(this.engineProc.pid!); }
  async stop() {
    this.tail?.stop();
    for (const p of [...this.procs].reverse()) { (p as any)._expected = true; p.kill('SIGTERM'); }
    await Promise.all(this.procs.map((p) => new Promise<void>((ok) => { if (p.exitCode !== null) return ok(); const t = setTimeout(() => { p.kill('SIGKILL'); ok(); }, 8000); p.on('exit', () => { clearTimeout(t); ok(); }); })));
  }
}
