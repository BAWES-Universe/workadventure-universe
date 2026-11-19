// Load runner. A SEPARATE process from the engines. For one engine config it runs N concurrent 1:1 conversations
// (one simulated human + one bot each), duty-cycled so a person talks about 40% of the time, ~15% of turns are talk-overs.
// For each run: warm-up, then a measured window. Writes one CSV row per run and one CSV row per conversation cycle.
// Usage: npx tsx scenarios/load.ts <pipecat|ts> <local|provider> --n 1,5,10,20 --reps 3 --warmup 15 --measure 60 --out DIR
import { mkdirSync, appendFileSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { cpus } from 'node:os';
import { Stack, procTimes, type EngineKind, type TurnEnd } from './stack.ts';
import { Human } from '../loadgen/human.ts';
import { ROOT, now, sleep, summarize, manifest } from '../common/util.ts';
import type { Ev } from '../loadgen/tail.ts';

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { n: { type: 'string', default: '1,5,10,20' }, reps: { type: 'string', default: '3' }, warmup: { type: 'string', default: '15' }, measure: { type: 'string', default: '60' }, out: { type: 'string', default: `${ROOT}results/load` }, 'port-base': { type: 'string', default: '10000' }, procs: { type: 'string', default: '1' }, 'rep-from': { type: 'string', default: '1' }, prefix: { type: 'string', default: 'load' } } });
const engine = positionals[0] as EngineKind, turnEnd = positionals[1] as TurnEnd;
const NS = v.n!.split(',').map(Number), REPS = Number(v.reps), WARM = Number(v.warmup) * 1000, MEAS = Number(v.measure) * 1000;
mkdirSync(v.out!, { recursive: true });
const tag = `${engine}-${turnEnd}`;
const PROCS = v.procs!.split(',');
const RUNS_CSV = `${v.out}/${v.prefix}-runs-${tag}.csv`, CYC_CSV = `${v.out}/${v.prefix}-cycles-${tag}.csv`;
const LONG_TEXT = 'This is a long answer from the test bot. It keeps talking for quite a while so that a person has plenty of time to talk over it, or for the voice to be stopped.';
const CLIPS = ['en_ls_experience', 'en_ls_halt', 'en_ls_power'];
const TALK_OVER_SHARE = 0.15, DUTY = 0.4;
const num = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '' : String(Math.round(x * 1000) / 1000));
const csvLine = (a: (string | number | undefined)[]) => a.map((x) => { const s = x === undefined ? '' : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',') + '\n';

interface Cycle { run: string; lane: number; kind: 'normal' | 'talkover'; startAt: number; counted: boolean; clip: string; finals: number; split: boolean; eosToTurnMs?: number; turnToFirstAudioMs?: number; sayToFirstAudioMs?: number; stopMs?: number; staleMs?: number; playedMs?: number; interrupted?: boolean; droppedAudioMs: number; timeout: boolean; note: string }

async function until(fn: () => boolean, ms: number, step = 30) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(step); } return fn(); }

async function conversation(lane: number, st: Stack, h: Human, sid: string, runId: string, ctl: { stop: boolean; windowStart: number }, out: Cycle[], errors: string[], rnd: () => number) {
  const evs = (pred: (e: Ev) => boolean) => (st.tail.bySid.get(sid) ?? []).filter(pred);
  const finals = (since: number) => evs((e) => e.dir === 'in' && e.msg.type === 'user.turn' && !e.msg.partial && e.recvAt >= since);
  const progress = (seg: string) => evs((e) => e.dir === 'in' && e.msg.type === 'playback.progress' && e.msg.segmentId === seg);
  await sleep(rnd() * 3000); // spread the lanes out
  while (!ctl.stop) {
    const startAt = now(); const clipId = CLIPS[Math.floor(rnd() * CLIPS.length)]; const ci = manifest().clips[clipId]; const period = ci.durationMs / DUTY;
    const talkover = rnd() < TALK_OVER_SHARE; const c: Cycle = { run: runId, lane, kind: talkover ? 'talkover' : 'normal', startAt, counted: startAt >= ctl.windowStart, clip: clipId, finals: 0, split: false, droppedAudioMs: 0, timeout: false, note: '' };
    try {
      if (!h.pc || h.pc.connectionState !== 'connected') throw new Error(`peer ${h.pc?.connectionState}`);
      let segId: string | undefined, onset: number;
      if (talkover) {
        const before = now(); segId = (await st.tail.post('/admin/say', { sessionId: sid, text: LONG_TEXT })).segmentId;
        const heard = await until(() => !!h.firstAudibleAfter(before), 4000);
        if (!heard) { c.timeout = true; c.note = 'bot not heard before talk-over'; out.push(c); await sleep(1000); continue; }
        await sleep(1200);
      }
      const r = await h.speak(clipId); onset = r.speechStartAt;
      let flist: Ev[] = [];
      const got = await until(() => (flist = finals(onset - 50)).length > 0, Math.max(0, r.speechEndAt - now()) + 6000, 25);
      if (!got) { c.timeout = true; c.note = 'no final user.turn'; out.push(c); continue; }
      // let a possible split second turn show up, then take the last turn as "the" turn
      let lastCount = -1; while (flist.length !== lastCount) { lastCount = flist.length; await sleep(700); flist = finals(onset - 50); }
      c.finals = flist.length; c.split = flist.length > 1; const fin = flist[flist.length - 1];
      c.eosToTurnMs = fin.recvAt - r.speechEndAt; c.droppedAudioMs = flist.reduce((a, e) => a + (e.msg.droppedAudioMs ?? 0), 0);
      if (talkover && segId) {
        const pr = progress(segId).find((e) => e.msg.finished);
        c.interrupted = !!pr?.msg.interrupted && pr?.msg.reason === 'barge_in'; c.playedMs = pr?.msg.playedMs;
        const burstEnd = h.burstEndAfter(onset - 100); if (burstEnd) c.stopMs = burstEnd - onset; else c.note += 'no-stop-found ';
        if (pr) { const nextSay = evs((e) => e.dir === 'out' && e.msg.type === 'bot.say' && e.recvAt > pr.recvAt)[0]; c.staleMs = h.audibleIn(pr.recvAt + 100, nextSay ? nextSay.recvAt : pr.recvAt + 1500).length * 20; }
        else c.note += 'no-progress-for-interrupted ';
      }
      // the reply to the last turn
      // the brain's reply is the first bot.say sent after the last final turn (replyTo is not part of the wire message)
      const isReply = (e: Ev) => e.dir === 'out' && e.msg.type === 'bot.say' && e.recvAt >= fin.recvAt && e.msg.segmentId !== segId;
      const say = evs(isReply)[0] ?? (await st.tail.waitFor((e) => e.sessionId === sid && isReply(e), 4000));
      if (!say) { c.timeout = true; c.note += 'no reply say '; out.push(c); continue; }
      c.turnToFirstAudioMs = undefined;
      const sayAt = say.recvAt; const gotAudio = await until(() => !!h.firstAudibleAfter(sayAt - 20), 3000, 20);
      if (!gotAudio) { c.timeout = true; c.note += 'reply not heard '; out.push(c); continue; }
      const fa = h.firstAudibleAfter(sayAt - 20)!; c.sayToFirstAudioMs = fa.at - sayAt; c.turnToFirstAudioMs = fa.at - fin.recvAt;
      await until(() => !!progress(say.msg.segmentId).find((e) => e.msg.finished), 5000, 40);
      out.push(c);
    } catch (e: any) { c.note += `ERROR ${e?.message ?? e}`; out.push(c); errors.push(`lane ${lane}: ${e?.stack ?? e}`); return; }
    const idle = startAt + period - now(); if (idle > 0 && !ctl.stop) await sleep(idle);
  }
}

// ---- several engine processes: totals across processes, worst process for loop delay ----
const aggStats = (a: any[]) => ({
  failures: a.flatMap((x) => x.failures), lanes: a.flatMap((x) => x.lanes), cpuPctOfOneCore: a.reduce((t, x) => t + x.cpuPctOfOneCore, 0),
  counters: a.reduce((t: Record<string, number>, x) => { for (const [k, val] of Object.entries(x.counters as Record<string, number>)) t[k] = (t[k] ?? 0) + val; return t; }, {}),
  loopLagMs: { p50: Math.max(...a.map((x) => x.loopLagMs.p50 ?? 0)), p95: Math.max(...a.map((x) => x.loopLagMs.p95 ?? 0)), p99: Math.max(...a.map((x) => x.loopLagMs.p99 ?? 0)), max: Math.max(...a.map((x) => x.loopLagMs.max ?? 0)) },
});
const aggCpu = (a: { cpuSec: number; rssMb: number; threads: number }[]) => ({ cpuSec: a.reduce((t, x) => t + x.cpuSec, 0), rssMb: a.reduce((t, x) => t + x.rssMb, 0), threads: a.reduce((t, x) => t + x.threads, 0) });
const boxCpu = () => { const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number); const idle = f[3] + f[4]; const tot = f.reduce((a, b) => a + b, 0); return { idle, tot }; };

async function oneRun(n: number, rep: number, runIdx: number, procsSpec: string) {
  const nProcs = procsSpec === 'N' ? n : Math.min(Number(procsSpec), n); const poolLabel = procsSpec === 'N' ? 'PN' : `P${procsSpec}`;
  const runId = `${tag}-${poolLabel}-N${n}-r${rep}`; const basePort = Number(v['port-base']) + (runIdx % 20) * 30;
  const t00 = Date.now(); const invalid: string[] = [];
  // a slow start of a helper process is retried once on other ports; the failure is written down, never hidden
  let st!: Stack;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cand = new Stack({ engine, turnEnd, procs: nProcs, basePort: basePort + attempt * 600, logDir: `${v.out}/logs` });
    try { st = await cand.start(); break; } catch (e: any) { appendFileSync(`${v.out}/load-invalid-${tag}.txt`, `${runId} stack start attempt ${attempt} failed: ${e?.message}\n`); await cand.stop().catch(() => {}); if (attempt === 2) { console.log(`${runId} INVALID (stack would not start)`); return; } }
  }
  await st.tail.post('/config', { greet: false });
  const humans: Human[] = []; const cycles: Cycle[] = []; const errors: string[] = []; const ctl = { stop: false, windowStart: Infinity };
  const lag: { t: number; ms: number }[] = []; let lagStop = false;
  void (async () => { while (!lagStop) { const t = performance.now(); await sleep(20); lag.push({ t: now(), ms: performance.now() - t - 20 }); } })();
  const rssPeak = { v: 0 }; const rssTimer = setInterval(() => { try { rssPeak.v = Math.max(rssPeak.v, aggCpu(st.cpuAll()).rssMb); } catch { /* process gone */ } }, 1000);
  const tasks: Promise<void>[] = [];
  const sids: string[] = [];
  let seed = 12345 + runIdx;
  const mk = (s: number) => { let a = s >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  try {
    for (let i = 0; i < n; i++) {
      const sid = `load-${runId}-${i}`; sids.push(sid);
      const h = new Human({ participantId: 'p1', sessionId: sid, signaling: st.signalingUrl, keepRx: true }); await h.connect(); humans.push(h);
      // rx buffer is only used for the last few seconds: trim it so memory and scans stay small
      await sleep(150);
    }
    const connectMs = Date.now() - t00;
    for (let i = 0; i < n; i++) tasks.push(conversation(i, st, humans[i], sids[i], runId, ctl, cycles, errors, mk(seed++ * 7919)));
    const trim = setInterval(() => { const cut = now() - 15000; for (const h of humans) if (h.rx.length > 2000) { let k = 0; while (k < h.rx.length && h.rx[k].at < cut) k++; if (k) h.rx.splice(0, k); } }, 5000);
    await sleep(WARM);
    // ---- measured window ----
    const sAall = await st.statsAll(true); const sA = aggStats(sAall); const pAall = st.cpuAll(); const pA = aggCpu(pAall); const boxA = boxCpu(); const peers = [st.procs[0], st.procs[1]].map((p) => p.pid!);
    const otherA = peers.map((p) => procTimes(p).cpuSec); const lgA = process.cpuUsage(); const tA = now(); ctl.windowStart = tA; const idxA = cycles.length; lag.length = 0;
    const hA = humans.map((h) => ({ sent: h.sent, sentBytes: h.sentBytes, rx: h.rxCount, rxBytes: h.rxBytes, rxAud: h.rxAudible }));
    const brainEvA = st.tail.all.length; rssPeak.v = pA.rssMb;
    await sleep(MEAS);
    const sBall = await st.statsAll(false); const sB = aggStats(sBall); const pBall = st.cpuAll(); const pB = aggCpu(pBall); const boxB = boxCpu(); const tB = now(); const lgB = process.cpuUsage(lgA);
    const otherB = peers.map((p) => procTimes(p).cpuSec); const lags = lag.filter((l) => l.t >= tA).map((l) => l.ms).sort((a, b) => a - b);
    const hB = humans.map((h, i) => ({ sent: h.sent - hA[i].sent, sentBytes: h.sentBytes - hA[i].sentBytes, rx: h.rxCount - hA[i].rx, rxBytes: h.rxBytes - hA[i].rxBytes, rxAud: h.rxAudible - hA[i].rxAud }));
    const brainEv = st.tail.all.slice(brainEvA);
    ctl.stop = true; clearInterval(trim);
    await Promise.race([Promise.all(tasks), sleep(20000)]);
    const wall = (tB - tA) / 1000; const cpuS = pB.cpuSec - pA.cpuSec;
    const counted = cycles.filter((c) => c.counted && c.startAt + 0 < tB);
    // ---- supervision ----
    const viol = await st.tail.get('/violations').catch(() => null);
    const stFinal = await st.statsAll(false).then(aggStats).catch(() => null);
    if (errors.length) invalid.push(`conversation errors: ${errors.length} (${errors[0].slice(0, 160)})`);
    if (st.exited.length) invalid.push(`process exited: ${st.exited.join('; ')}`);
    if (sB.failures.length) invalid.push(`engine failures: ${sB.failures.length} (${String(sB.failures[0]).slice(0, 160)})`);
    if (viol?.count) invalid.push(`bridge schema violations: ${viol.count}`);
    const unhealthy = (stFinal?.lanes ?? sB.lanes).filter((l: any) => !l.healthy || l.gone).length; if (unhealthy) invalid.push(`unhealthy lanes at end: ${unhealthy}`);
    if ((sB.lanes?.length ?? 0) !== n) invalid.push(`engine reports ${sB.lanes?.length} lanes, expected ${n}`);
    const nTimeouts = counted.filter((c) => c.timeout).length; if (counted.length && nTimeouts / counted.length > 0.05) invalid.push(`turn/reply timeouts ${nTimeouts}/${counted.length} > 5%`);
    const perLane = Array.from({ length: n }, (_, i) => counted.filter((c) => c.lane === i && !c.timeout).length); const thin = perLane.filter((x) => x < 4).length; if (thin) invalid.push(`${thin} lane(s) with fewer than 4 completed cycles in the window (${perLane.join('/')})`);
    const lagP95 = lags.length ? lags[Math.floor(lags.length * 0.95)] : NaN; if (lagP95 > 30) invalid.push(`load generator overloaded: its own loop lag p95 ${lagP95.toFixed(1)} ms > 30`);
    const peerStats = { brainCpuPct: (100 * (otherB[0] - otherA[0])) / wall, signalingCpuPct: (100 * (otherB[1] - otherA[1])) / wall };
    // ---- latency summaries (counted, non-timeout cycles) ----
    const ok = counted.filter((c) => !c.timeout);
    const eos = summarize(ok.filter((c) => !c.split && c.eosToTurnMs !== undefined).map((c) => c.eosToTurnMs!)), t2a = summarize(ok.map((c) => c.turnToFirstAudioMs!).filter((x) => x !== undefined)), s2a = summarize(ok.map((c) => c.sayToFirstAudioMs!).filter((x) => x !== undefined));
    const to = ok.filter((c) => c.kind === 'talkover'); const stops = summarize(to.map((c) => c.stopMs!).filter((x) => x !== undefined)); const stale = to.map((c) => c.staleMs ?? 0);
    const d = (k: string) => (sB.counters[k] ?? 0) - 0; // counters were reset only for lag/stat window, so diff against sA below
    const dc = (k: string) => (sB.counters[k] ?? 0) - (sA.counters[k] ?? 0);
    void d;
    const talkMs = counted.reduce((a, c) => a + manifest().clips[c.clip].durationMs, 0);
    const row = {
      run: runId, engine, turnEnd, n, rep, valid: invalid.length === 0 ? 'VALID' : 'INVALID', invalidReasons: invalid.join(' | '),
      windowS: wall, warmupS: WARM / 1000, connectS: connectMs / 1000,
      engineCpuPctOfOneCore: (100 * cpuS) / wall, engineCpuPctSelf: sB.cpuPctOfOneCore, procs: nProcs, procsSpec, procCpuMaxPct: Math.max(...pBall.map((x, i) => (100 * (x.cpuSec - pAall[i].cpuSec)) / wall)), procCpuMinPct: Math.min(...pBall.map((x, i) => (100 * (x.cpuSec - pAall[i].cpuSec)) / wall)), boxBusyPctOf4Cores: 100 * (1 - (boxB.idle - boxA.idle) / (boxB.tot - boxA.tot)), boxCores: cpus().length, cpuPctPerConversation: (100 * cpuS) / wall / n, rssMbStart: pA.rssMb, rssMbEnd: pB.rssMb, rssMbPeak: Math.max(rssPeak.v, pB.rssMb), threadsEnd: pB.threads,
      loopLagP50Ms: sB.loopLagMs.p50, loopLagP95Ms: sB.loopLagMs.p95, loopLagP99Ms: sB.loopLagMs.p99, loopLagMaxMs: sB.loopLagMs.max,
      loadgenCpuPctOfOneCore: (100 * (lgB.user + lgB.system) / 1e6) / wall, loadgenLagP95Ms: lagP95, brainCpuPct: peerStats.brainCpuPct, signalingCpuPct: peerStats.signalingCpuPct,
      cyclesCounted: counted.length, cyclesTimeout: nTimeouts, cyclesSplitTurn: counted.filter((c) => c.split).length, talkOvers: to.length, talkOversInterrupted: to.filter((c) => c.interrupted).length, talkingDutyPct: (100 * talkMs) / (wall * 1000 * n),
      eosToTurnP50Ms: eos.p50, eosToTurnP95Ms: eos.p95, turnToFirstAudioP50Ms: t2a.p50, turnToFirstAudioP95Ms: t2a.p95, sayToFirstAudioP50Ms: s2a.p50, sayToFirstAudioP95Ms: s2a.p95, talkOverStopP50Ms: stops.p50, talkOverStopP95Ms: stops.p95, staleAudioMsTotal: stale.reduce((a, b) => a + b, 0),
      droppedAudioMsReported: counted.reduce((a, c) => a + c.droppedAudioMs, 0),
      lgTxPackets: hB.reduce((a, x) => a + x.sent, 0), lgTxBytes: hB.reduce((a, x) => a + x.sentBytes, 0), lgRxPackets: hB.reduce((a, x) => a + x.rx, 0), lgRxBytes: hB.reduce((a, x) => a + x.rxBytes, 0), lgRxAudiblePackets: hB.reduce((a, x) => a + x.rxAud, 0),
      segStarted: dc('segments_started'), segCompleted: dc('segments_completed'), segCancelled: dc('segments_cancelled'), ttsGeneratedMs: dc('tts_generated_ms'), ttsPlayedMs: dc('tts_played_ms'), ttsCancelledMs: dc('tts_cancelled_ms'),
      turnsFinal: dc('turns_final'), vadStarts: dc('vad_starts'), sttPartials: dc('stt_partials'), bargeIns: dc('barge_ins'), engineBytesIn: dc('bytes_in'),
      engineFramesOrPktsIn: dc('frames_in') || dc('rtp_in'), engineAudioOutChunksOrPkts: dc('audio_out_chunks') || dc('rtp_out'), engineBytesOut: dc('audio_out_bytes') || dc('bytes_out'),
      brainEventsInWindow: brainEv.length, loadavgEnd: readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' '), runWallS: (Date.now() - t00) / 1000,
    };
    const keys = Object.keys(row); if (!existsSync(RUNS_CSV)) writeFileSync(RUNS_CSV, csvLine(keys));
    appendFileSync(RUNS_CSV, csvLine(keys.map((k) => { const x = (row as any)[k]; return typeof x === 'number' ? num(x) : x; })));
    const ckeys = ['run', 'lane', 'kind', 'counted', 'clip', 'startAt', 'finals', 'split', 'eosToTurnMs', 'turnToFirstAudioMs', 'sayToFirstAudioMs', 'stopMs', 'staleMs', 'playedMs', 'interrupted', 'droppedAudioMs', 'timeout', 'note'];
    if (!existsSync(CYC_CSV)) writeFileSync(CYC_CSV, csvLine(ckeys));
    for (const c of cycles) appendFileSync(CYC_CSV, csvLine(ckeys.map((k) => { const x = (c as any)[k]; return typeof x === 'number' ? num(x) : x; })));
    console.log(`${runId} ${row.valid} cpu ${row.engineCpuPctOfOneCore.toFixed(1)}% rss ${row.rssMbEnd.toFixed(0)}MB lagP95 ${num(row.loopLagP95Ms)}ms cycles ${counted.length} timeouts ${nTimeouts} eos→turn p50 ${num(row.eosToTurnP50Ms)} turn→audio p50 ${num(row.turnToFirstAudioP50Ms)} ${invalid.length ? 'REASON: ' + invalid.join(' | ') : ''}`);
  } catch (e: any) {
    console.log(`${runId} INVALID (run crashed): ${e?.stack ?? e}`);
    // a crashed run is never hidden: it is listed here, and the summary counts it as INVALID
    appendFileSync(`${v.out}/load-invalid-${tag}.txt`, `${runId} crashed: ${e?.stack ?? e}\n`);
  } finally {
    ctl.stop = true; lagStop = true; clearInterval(rssTimer);
    await Promise.race([Promise.all(tasks), sleep(5000)]);
    for (const h of humans) await h.disconnect(true).catch(() => {});
    await sleep(1500);
    await st.stop();
  }
}

console.log(`load: ${tag} N=${NS} reps=${REPS} warmup=${WARM / 1000}s measure=${MEAS / 1000}s cpus=${cpus().length} (${cpus()[0].model})`);
let idx = 0;
for (const rep of Array.from({ length: REPS }, (_, i) => i + Number(v['rep-from']))) for (const n of NS) for (const ps of PROCS) await oneRun(n, rep, idx++, ps);
console.log('load done');
