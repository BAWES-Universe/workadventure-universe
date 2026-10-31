// Runs S1..S13 (+X1) for one configuration and writes results/<engine>-<turnEnd>.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { Stack, type EngineKind, type TurnEnd } from './stack.ts';
import { Ctx, type Result } from './lib.ts';
import * as S from './scenarios.ts';
import { ROOT } from '../common/util.ts';

const engine = process.argv[2] as EngineKind, turnEnd = process.argv[3] as TurnEnd; const only = process.argv[4] ? process.argv[4].split(',') : undefined;
const out = process.argv[5] ?? `${ROOT}results/scenarios`; mkdirSync(out, { recursive: true });
const base = 8000 + (engine === 'ts' ? 300 : 0) + (turnEnd === 'provider' ? 100 : 0) + 200;
const results: Result[] = []; const t0 = Date.now();
async function withStack(emotion: boolean, fn: (c: Ctx, st: Stack) => Promise<void>) {
  const st = await new Stack({ engine, turnEnd, basePort: base + (emotion ? 50 : 0), emotionStub: emotion }).start(); const c = new Ctx(st);
  try { await fn(c, st); } finally {
    const stats = await st.stats().catch(() => null); const viol = await st.tail.get('/violations').catch(() => null);
    results.push({ id: emotion ? 'HARNESS-emotion-stack' : 'HARNESS', status: stats && stats.failures.length === 0 && viol?.count === 0 && st.exited.length === 0 ? 'PASS' : 'FAIL', reason: 'engine failures, bridge schema violations, unexpected process exits', evidence: { failures: stats?.failures, violations: viol?.count, exited: st.exited, counters: stats?.counters } });
    await st.stop();
  }
}
await withStack(false, async (c) => {
  for (const [id, fn] of Object.entries({ S1: S.S1, S2: S.S2, S3: S.S3, S4: S.S4, S5: S.S5, S6: S.S6, S7: S.S7, S8: S.S8, S9: S.S9, S10: S.S10, S11: S.S11, X1: S.X1 })) {
    if (only && !only.includes(id)) continue;
    const t = Date.now();
    try { const r = await fn(c); r.evidence.durationS = Math.round((Date.now() - t) / 1000); results.push(r); console.log(id, r.status, r.reason); }
    catch (e: any) { results.push({ id, status: 'FAIL', reason: `scenario crashed: ${e?.message ?? e}`, evidence: { stack: String(e?.stack).slice(0, 600) } }); console.log(id, 'CRASH', e?.message); }
    writeFileSync(`${out}/${engine}-${turnEnd}.json`, JSON.stringify({ engine, turnEnd, results }, null, 1));
  }
});
if (!only || only.includes('S13')) await withStack(true, async (c) => {
  try { const r = await S.S13(c); results.push(r); console.log('S13', r.status, r.reason); } catch (e: any) { results.push({ id: 'S13', status: 'FAIL', reason: `crashed: ${e?.message}`, evidence: {} }); }
});
writeFileSync(`${out}/${engine}-${turnEnd}.json`, JSON.stringify({ engine, turnEnd, results, totalSeconds: Math.round((Date.now() - t0) / 1000) }, null, 1));
console.log('done in', Math.round((Date.now() - t0) / 1000), 's');
