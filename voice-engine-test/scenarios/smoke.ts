// Quick end-to-end check of one stack: connect a human, hear the greeting, say a clip, get a turn and a reply.
import { Stack, type EngineKind, type TurnEnd } from './stack.ts';
import { Human } from '../loadgen/human.ts';
import { sleep, now } from '../common/util.ts';

const engine = (process.argv[2] ?? 'pipecat') as EngineKind; const turnEnd = (process.argv[3] ?? 'local') as TurnEnd;
const st = await new Stack({ engine, turnEnd, basePort: 8900 }).start();
try {
  const h = new Human({ participantId: 'p1', sessionId: 'smoke-1', signaling: st.signalingUrl });
  const t0 = now(); await h.connect(); console.log('connected in', Math.round(now() - t0), 'ms lane', h.lane);
  await sleep(3500);
  const g = h.audibleIn(0); console.log('greeting audible packets', g.length, 'first at +', g.length ? Math.round(g[0].at - t0) : 'none');
  const r = await h.speak('en_ls_power'); console.log('spoke', JSON.stringify(r));
  const turn = st.tail.find((e) => e.dir === 'in' && e.msg.type === 'user.turn' && !e.msg.partial)[0];
  for (const e of st.tail.all) if (e.msg.type==='user.turn'||e.msg.type==='user.speech_started') console.log('  ev', e.msg.type, JSON.stringify({partial:e.msg.partial,text:e.msg.text,why:e.msg.endReason,dropped:e.msg.droppedAudioMs}), 'rel start', Math.round(e.recvAt-r.startAt), 'rel speechEnd', Math.round(e.recvAt-r.speechEndAt));
  console.log('turn', turn ? { text: turn.msg.text, reason: turn.msg.endReason, afterSpeechEndMs: Math.round(turn.recvAt - r.speechEndAt) } : 'NONE');
  await sleep(3000);
  const types: Record<string, number> = {}; for (const e of st.tail.all) types[`${e.dir}:${e.msg.type}`] = (types[`${e.dir}:${e.msg.type}`] ?? 0) + 1;
  console.log(types); console.log('rx audible', h.rxAudible, 'rx total', h.rxCount);
  console.log(JSON.stringify((await st.stats()).counters), 'failures', (await st.stats()).failures);
  console.log('violations', JSON.stringify(await st.tail.get('/violations')));
} finally { await st.stop(); }
