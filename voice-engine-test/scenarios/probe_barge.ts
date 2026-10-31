// Where does the talk-over stop time go? Per trial: person's speech onset -> engine sees speech start -> engine reports the cut -> last bot audio packet heard.
import { Stack, type EngineKind } from './stack.ts';
import { Ctx, until, LONG_TEXT } from './lib.ts';
import { sleep, now, summarize } from '../common/util.ts';
const engine = process.argv[2] as EngineKind; const extra = process.argv.slice(3);
const st = await new Stack({ engine, turnEnd: 'local', basePort: 9300, extraArgs: extra, logDir: '/tmp/probe-logs' }).start(); const c = new Ctx(st); await c.cfg({ greet: false });
const sid = c.sid('probe'); const h = await c.human(sid, 'p1'); const rows: number[][] = []; const onsets: number[] = [];
for (let i = 0; i < 8; i++) {
  const before = now(); const segId = (await c.admin('say', { sessionId: sid, text: LONG_TEXT })).segmentId; await c.hears(h, before); await sleep(1500);
  const r = await h.speak('en_ls_power'); const onset = r.speechStartAt;
  await until(() => !!c.progress(sid, segId).find((e) => e.msg.finished), 4000); await sleep(800);
  const started = c.evs(sid, (e) => e.dir === 'in' && e.msg.type === 'user.speech_started' && e.recvAt > onset - 100)[0];
  const pr = c.progress(sid, segId).find((e) => e.msg.finished)!; const end = h.burstEndAfter(onset - 100)!;
  rows.push([started.recvAt - onset, pr.recvAt - onset, end - onset]); onsets.push(Math.round(onset));
  const nextSay = c.evs(sid, (e) => e.dir === 'out' && e.msg.type === 'bot.say' && e.recvAt > pr.recvAt)[0]; if (nextSay) await c.finished(sid, nextSay.msg.segmentId, 5000); await sleep(500);
}
const col = (k: number) => Math.round(summarize(rows.map((r) => r[k])).p50);
console.log(JSON.stringify({ engine, extra, trials: rows.length, p50_onset_to_speech_started_ms: col(0), p50_onset_to_cut_reported_ms: col(1), p50_onset_to_last_audio_ms: col(2), p50_cut_reported_to_last_audio_ms: Math.round(summarize(rows.map((r) => r[2] - r[1])).p50) }));
console.log('ONSETS ' + JSON.stringify(onsets)); await h.disconnect(); await st.stop();
