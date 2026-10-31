// S1..S13 for one engine configuration. Every PASS comes from an automated check that fails when the behaviour is wrong.
import { Ctx, until, LONG_TEXT, clipsLang, type Result } from './lib.ts';
import { Human } from '../loadgen/human.ts';
import { sleep, now, summarize, manifest } from '../common/util.ts';

const R = (id: string, status: Result['status'], reason: string, evidence: Record<string, unknown> = {}): Result => ({ id, status, reason, evidence });
const ok = (checks: Record<string, boolean>) => Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
const verdict = (id: string, checks: Record<string, boolean>, evidence: Record<string, unknown>, passMsg: string): Result => {
  const bad = ok(checks); return bad.length ? R(id, 'FAIL', `failed checks: ${bad.join(', ')}`, { checks, ...evidence }) : R(id, 'PASS', passMsg, { checks, ...evidence });
};

export async function S1(c: Ctx): Promise<Result> {
  await c.cfg({ greet: true });
  const sid = c.sid('s1'); const t0 = now(); const h = await c.human(sid, 'p1'); const connectMs = now() - t0;
  await until(() => c.evs(sid, (e) => e.dir === 'out' && e.msg.type === 'bot.say').length > 0, 5000);
  const say = c.evs(sid, (e) => e.dir === 'out' && e.msg.type === 'bot.say')[0]; const join = c.inMsgs(sid, 'participant.join')[0];
  const segId = say?.msg.segmentId; await c.finished(sid, segId, 8000); await sleep(400);
  const fin = c.final(sid, segId); const first = h.audibleIn(join?.recvAt - 50 || 0)[0]; const aud = h.audibleIn(0);
  const wall = aud.length ? aud[aud.length - 1].at - aud[0].at : 0; const pkts = aud.length * 20;
  const gen = fin?.totalMs ?? 0; const latency = first && join ? first.at - join.recvAt : NaN; const afterSay = first && say ? first.at - say.recvAt : NaN;
  const seg = (await c.st.tail.get(`/segments?sessionId=${sid}`))[0];
  await h.disconnect();
  return verdict('S1', {
    greetingSpoken: !!first, firstAudioWithin1500ms: latency < 1500, finishedNotInterrupted: !!fin && fin.finished && !fin.interrupted,
    playedEqualsTotal: !!fin && fin.playedMs === fin.totalMs, wallMatchesGenerated: Math.abs(wall - gen) < 300, committedTextIntact: seg?.text === say?.msg.text,
  }, { joinToFirstAudioMs: Math.round(latency), sayToFirstAudioMs: Math.round(afterSay), connectMs: Math.round(connectMs), pacing: { generatedMs: gen, wallMsFirstToLastAudible: Math.round(wall), audiblePacketsMs: pkts, playedMs: fin?.playedMs } },
    `greeting heard ${Math.round(latency)} ms after join; generated ${gen} ms, wall ${Math.round(wall)} ms`);
}

export async function S2(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s2'); const h = await c.human(sid, 'p1'); const stops: number[] = []; const stales: number[] = []; const played: number[] = []; const problems: string[] = [];
  const TRIALS = 10;
  for (let i = 0; i < TRIALS; i++) {
    const before = now(); const segId = (await c.admin('say', { sessionId: sid, text: LONG_TEXT })).segmentId;
    const first = await c.hears(h, before); if (!first) { problems.push(`trial ${i}: bot never heard`); continue; }
    await sleep(1500); const r = await h.speak('en_ls_power'); const onset = r.speechStartAt;
    await until(() => !!c.progress(sid, segId).find((e) => e.msg.finished), 4000);
    const fin = c.final(sid, segId); const pr = c.progress(sid, segId).find((e) => e.msg.finished)!;
    if (!fin || !fin.interrupted || fin.reason !== 'barge_in') problems.push(`trial ${i}: progress=${JSON.stringify(fin)}`);
    else { played.push(fin.playedMs); if (!(fin.playedMs > 800 && fin.playedMs < fin.totalMs - 500)) problems.push(`trial ${i}: playedMs ${fin.playedMs} of ${fin.totalMs}`); }
    await sleep(700);
    const stop = h.burstEndAfter(onset - 100); if (stop) stops.push(stop - onset); else problems.push(`trial ${i}: no stop found`);
    // stale: audible audio that arrives more than 100 ms after the engine said it had stopped, before the reply starts
    const nextSay = c.evs(sid, (e) => e.dir === 'out' && e.msg.type === 'bot.say' && e.recvAt > pr.recvAt)[0];
    const stale = h.audibleIn(pr.recvAt + 100, nextSay ? nextSay.recvAt : pr.recvAt + 1500).length * 20; stales.push(stale);
    // let the reply finish before the next trial
    const rep = nextSay ? nextSay.msg.segmentId : undefined; if (rep) await c.finished(sid, rep, 5000); await sleep(400);
  }
  const seg = (await c.st.tail.get(`/segments?sessionId=${sid}`)).find((s: any) => s.text === LONG_TEXT);
  const s = summarize(stops); await h.disconnect();
  return verdict('S2', { allTrialsInterruptedWithReason: problems.length === 0, trialsCompleted: stops.length === TRIALS, p95StopWithin1000ms: s.p95 <= 1000, noStaleAudio: Math.max(0, ...stales) === 0, committedTextIntact: seg?.text === LONG_TEXT },
    { stopMs: { n: s.n, p50: Math.round(s.p50), p95: Math.round(s.p95), min: Math.round(s.min), max: Math.round(s.max) }, staleMsPerTrial: stales, playedMsPerTrial: played, problems, definition: 'stop = last audible RTP packet before a >=250 ms gap, minus the time the person starts speaking (VAD-confirmed speech start inside the clip)' },
    `talk-over stop p50 ${Math.round(s.p50)} ms p95 ${Math.round(s.p95)} ms, no stale audio`);
}

export async function S3(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s3'); const h = await c.human(sid, 'p1');
  const t0 = now(); const r = await h.speak('en_ls_power');
  await until(() => c.finals(sid).length > 0, 6000);
  const turn = c.finals(sid)[0]; await c.hears(h, turn?.recvAt ?? t0, 5000);
  const chat = await c.admin('chat', { sessionId: sid, participantId: 'p1', text: 'typed while you talk' }); // typed message while the voice reply is playing
  await sleep(6000);
  const says = c.evs(sid, (e) => e.dir === 'out' && e.msg.type === 'bot.say'); const inbound = c.evs(sid, (e) => e.dir === 'in' && (e.msg.type === 'user.turn' && !e.msg.partial || e.msg.type === 'user.text'));
  const replyToTurn = says.filter((e) => e.msg.segmentId && (c.st.tail.all.length, true)).length;
  const segs = await c.st.tail.get(`/segments?sessionId=${sid}`); const byReply = (k: string) => segs.filter((g: any) => g.replyTo?.startsWith(k));
  const order = inbound.map((e) => e.msg.type);
  const finishedAll = segs.every((g: any) => g.progress.some((p: any) => p.finished && !p.interrupted));
  const ids = segs.map((g: any) => g.segmentId);
  await h.disconnect(); void replyToTurn; void r; void chat;
  return verdict('S3', { oneReplyToVoiceTurn: byReply('turn:').length === 1, oneReplyToTypedText: byReply('text:').length === 1, inboundOrderTurnBeforeText: order.join() === 'user.turn,user.text', allRepliesFullyPlayed: finishedAll, noDuplicateSegments: new Set(ids).size === ids.length },
    { inboundOrder: order, replies: segs.map((g: any) => ({ replyTo: g.replyTo, played: g.progress.at(-1)?.playedMs })) }, 'one reply each, in order, nothing cut off');
}

export async function S4(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s4'); const h = await c.human(sid, 'p1'); const t0 = now();
  const jobDur = 7000; const { jobId } = await c.admin('job', { sessionId: sid, durationMs: jobDur });
  const first = await c.hears(h, t0); await sleep(500); const r = await h.speak('en_ls_power');
  const ack = (await c.st.tail.get(`/segments?sessionId=${sid}`)).find((s: any) => s.replyTo === `job:${jobId}`);
  await until(() => c.evs(sid, (e) => e.dir === 'brain' && e.msg.type === 'job.finished').length > 0, jobDur + 3000);
  await sleep(500);
  const fin = c.evs(sid, (e) => e.dir === 'brain' && e.msg.type === 'job.finished')[0]; await until(() => { return true; }, 1);
  const segs = await c.st.tail.get(`/segments?sessionId=${sid}`); const result = segs.find((s: any) => s.replyTo === `job-result:${jobId}`);
  await until(() => !!result && (c.final(sid, result.segmentId)?.finished ?? false), 6000);
  const rf = result ? c.final(sid, result.segmentId) : undefined; const ackP = ack ? c.final(sid, ack.segmentId) : undefined;
  const resultAudible = fin ? h.audibleIn(fin.recvAt).length * 20 : 0;
  await h.disconnect();
  return verdict('S4', { ackWasInterrupted: !!ackP?.interrupted, jobFinishedNotCancelled: !!fin && fin.msg.cancelled === false, resultSegmentPlayedFully: !!rf && rf.finished && !rf.interrupted && rf.playedMs === rf.totalMs, resultHeard: resultAudible >= (rf?.totalMs ?? 99999) * 0.8, firstHeard: !!first },
    { ackProgress: ackP, resultProgress: rf, resultAudibleMs: resultAudible, jobFinishedAfterMs: fin ? Math.round(fin.recvAt - t0) : null, note: 'the job lives in the fake brain; the engine-testable part is that the interruption does not stop the session and the later result is spoken in full' },
    'job survived the talk-over and its result was spoken in full later');
}

export async function S5(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s5'); const a = await c.human(sid, 'p1'); const b = await c.human(sid, 'p2');
  const ask = await c.admin('ask', { sessionId: sid, participantId: 'p2', text: 'Shall I deploy it now? Say yes or no.' }); await c.finished(sid, ask.segmentId, 6000);
  await sleep(300); await b.speak('en_yes');
  await until(() => c.evs(sid, (e) => e.dir === 'brain' && e.msg.type === 'confirm.answered').length > 0, 6000);
  const conf = c.evs(sid, (e) => e.dir === 'brain' && e.msg.type === 'confirm.answered')[0]; const turn = c.finals(sid)[0];
  await a.disconnect(); await b.disconnect();
  return verdict('S5', { deliveredAsUserTurn: !!turn, attributedToP2: turn?.msg.participantId === 'p2', laneIsOne: turn?.msg.lane === 1, textIsYes: turn?.msg.text === 'yes', brainSawConfirmationForP2: conf?.msg.participantId === 'p2' && conf?.msg.yes === true },
    { turn: turn?.msg, note: 'two people in the bubble; the question was for p2; p2 answered. UI part (card) is N/A for the engine.' }, 'spoken yes arrived as user.turn from p2 and resolved the pending ask');
}

export async function S6(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s6'); const h = await c.human(sid, 'p1'); const before = now();
  const { segmentId } = await c.admin('say', { sessionId: sid, text: LONG_TEXT }); await c.hears(h, before); await sleep(2000);
  const tStop = now(); await c.admin('voice_stop', { sessionId: sid, reason: 'allowance_ended' });
  await until(() => !!c.final(sid, segmentId), 3000); const fin = c.final(sid, segmentId); await sleep(2500);
  const lastAud = h.lastAudibleAt(); const leaked = h.audibleIn(tStop + 1000).length; const stopMs = lastAud - tStop;
  const status = c.inMsgs(sid, 'engine.status').filter((e) => e.recvAt > tStop).at(-1)?.msg;
  // mic must be ignored now
  const nTurnsBefore = c.finals(sid).length; await h.speak('en_ls_halt'); await sleep(3500); const turnsAfter = c.finals(sid).length - nTurnsBefore;
  // a bot.say after the stop must be rejected
  const late = (await c.admin('say', { sessionId: sid, text: 'This must not be spoken.' })).segmentId; await sleep(1200); const lateFin = c.final(sid, late);
  const lateAud = h.audibleIn(tStop + 4500).length;
  // the session still works for text
  await c.admin('chat', { sessionId: sid, participantId: 'p1', text: 'are you still there' }); await sleep(900);
  const textReply = c.evs(sid, (e) => e.dir === 'brain' && e.msg.type === 'text_reply').length;
  const connected = h.pc?.connectionState === 'connected'; await h.disconnect();
  return verdict('S6', { progressInterruptedVoiceStop: !!fin?.interrupted && fin?.reason === 'voice_stop', audioStoppedWithin1s: stopMs < 1000, noLeakedAudioAfter1s: leaked === 0, statusVoiceStopped: status?.voice === 'stopped', micIgnored: turnsAfter === 0, lateSayRejected: lateFin?.reason === 'rejected' && lateAud === 0, sessionUsableForText: textReply === 1 && connected },
    { stopAfterMs: Math.round(stopMs), leakedPackets: leaked, progress: fin, lateProgress: lateFin }, `audio stopped ${Math.round(stopMs)} ms after voice.stop; mic ignored; text still answered`);
}

export async function S7(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s7'); const h = await c.human(sid, 'p1'); const out: any = {};
  const run = async (name: string, opts: any) => {
    const n = c.finals(sid).length; const r = await h.speak('en_concat3', opts); await until(() => c.finals(sid).length > n, 9000); await sleep(4200); // loss can split one utterance into several turns
    const ts = c.finals(sid).slice(n).map((e) => e.msg);
    out[name] = { injectedDroppedMs: r.droppedMs, turns: ts.length, reportedDroppedMsTotal: ts.reduce((a: number, t: any) => a + t.droppedAudioMs, 0), everyTurnWithDropsIncomplete: ts.every((t: any) => (t.droppedAudioMs > 0) === (t.incomplete === true)), texts: ts.map((t: any) => t.text) };
  };
  await run('control_no_loss', {}); await run('loss_10pct', { lossPct: 10, seed: 11 }); await run('gap_1s', { gap: { atMs: 2000, durMs: 1000 } });
  await h.disconnect(); const o = out;
  return verdict('S7', {
    controlReportsZero: o.control_no_loss.reportedDroppedMsTotal === 0 && o.control_no_loss.everyTurnWithDropsIncomplete,
    loss10Reported: o.loss_10pct.reportedDroppedMsTotal > 0 && o.loss_10pct.everyTurnWithDropsIncomplete && o.loss_10pct.reportedDroppedMsTotal >= 0.5 * o.loss_10pct.injectedDroppedMs,
    gap1sReported: o.gap_1s.reportedDroppedMsTotal >= 800 && o.gap_1s.everyTurnWithDropsIncomplete,
    turnsStillDelivered: [o.control_no_loss, o.loss_10pct, o.gap_1s].every((x: any) => x.turns >= 1 && x.texts.every((t: string) => t === manifest().clips.en_concat3.transcript)),
  }, out, 'loss and gap were reported as droppedAudioMs with incomplete:true; clean run reported zero');
}

export async function S8(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s8'); const P = ['pa', 'pb', 'pc']; const H: Human[] = []; for (const p of P) H.push(await c.human(sid, p));
  const clips = ['en_ls_power', 'en_ls_halt', 'en_ls_experience']; const want = clips.map((x) => manifest().clips[x].transcript); const att: boolean[] = [];
  for (let i = 0; i < 3; i++) { const n = c.finals(sid).length; await H[i].speak(clips[i]); await until(() => c.finals(sid).length > n, 6000); const t = c.finals(sid)[n]?.msg; att.push(t?.participantId === P[i] && t?.lane === i && t?.text === want[i]); await sleep(2600); }
  // bot audio reaches everyone
  const b1 = now(); const sg = (await c.admin('say', { sessionId: sid, text: LONG_TEXT })).segmentId; await sleep(1800);
  const hear = H.map((h) => h.audibleIn(b1).length > 30); await H[1].speak('en_ls_halt'); // pb talks over
  await until(() => !!c.final(sid, sg), 4000); const fin = c.final(sid, sg); await sleep(800);
  const stops = H.map((h) => { const s = h.burstEndAfter(b1); return s ? s - b1 : 99999; });
  const pt = c.progress(sid, sg).find((e) => e.msg.finished)!.recvAt; const quiet = H.map((h) => h.audibleIn(pt + 150, pt + 1200).length);
  // let the reply to pb finish, then overlap
  await sleep(2500); const n0 = c.finals(sid).length;
  await Promise.all([H[0].speak('en_ls_power'), H[2].speak('en_ls_experience')]); await until(() => c.finals(sid).length >= n0 + 2, 8000);
  const ov = c.finals(sid).slice(n0).map((e) => `${e.msg.participantId}:${e.msg.text}`).sort();
  const wantOv = [`pa:${want[0]}`, `pc:${want[2]}`].sort();
  await sleep(1500); const st = await c.st.stats(); const healthy = st.lanes.filter((l: any) => l.sid === sid && l.healthy).length;
  for (const h of H) await h.disconnect();
  return verdict('S8', { threeLanesAttributedCorrectly: att.every(Boolean), botHeardByAll: hear.every(Boolean), talkOverStoppedBotOnAllLanes: !!fin?.interrupted && quiet.every((q) => q === 0), overlapBothTurnsCorrect: ov.join('|') === wantOv.join('|'), noEngineFailure: st.failures.length === 0, allLanesHealthy: healthy === 3 },
    { attribution: att, heard: hear, stopMsPerLane: stops.map(Math.round), overlapTurns: ov, healthyLanes: healthy }, 'three lanes attributed, one talk-over stopped the bot for all, overlap handled');
}

export async function S9(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s9'); const h = await c.human(sid, 'p1'); const pc0 = h.pc; const steps: Record<string, any> = {};
  const say = async (txt: string) => { const t = now(); const id = (await c.admin('say', { sessionId: sid, text: txt })).segmentId; await sleep(1800); return { id, heard: h.audibleIn(t).length > 20 }; };
  const speakTurn = async () => { const n = c.finals(sid).length; await h.speak('en_ls_power'); await sleep(3500); return c.finals(sid).length > n; };
  const setMode = async (m: string) => { await c.admin('mode', { sessionId: sid, mode: m }); await sleep(300); };
  const TXT = 'Testing the voice mode right now, please listen.';
  await setMode('talk'); steps.talk = { turn: await speakTurn(), heard: (await say(TXT)).heard }; await sleep(2500);
  await setMode('listen_only'); steps.listen_only = { turn: await speakTurn(), heard: (await say(TXT)).heard }; await sleep(2500);
  await setMode('type_and_listen'); steps.type_and_listen = { turn: await speakTurn(), heard: (await say(TXT)).heard }; await sleep(2500);
  await setMode('off'); steps.off = { turn: await speakTurn(), heard: (await say(TXT)).heard }; await sleep(1500);
  await setMode('talk'); steps.talk_again = { turn: await speakTurn(), heard: (await say(TXT)).heard }; await sleep(2500);
  const joins = c.inMsgs(sid, 'participant.join').length, leaves = c.inMsgs(sid, 'participant.leave').length; const samePc = h.pc === pc0 && h.pc?.connectionState === 'connected';
  await h.disconnect();
  return verdict('S9', { talkWorks: steps.talk.turn && steps.talk.heard, listenOnly_botHeard_micIgnored: steps.listen_only.heard && !steps.listen_only.turn, typeAndListen_botHeard_micIgnored: steps.type_and_listen.heard && !steps.type_and_listen.turn, off_silent_deaf: !steps.off.heard && !steps.off.turn, talkAgainWorks: steps.talk_again.turn && steps.talk_again.heard, noReconnect: joins === 1 && leaves === 0 && samePc },
    { steps, joins, leaves }, 'all four mode changes behaved, same connection');
}

export async function S10(c: Ctx): Promise<Result> {
  await c.cfg({ greet: true });
  const sid = c.sid('s10'); let h = await c.human(sid, 'p1'); await sleep(2500);
  const t0 = now(); const { segmentId } = await c.admin('say', { sessionId: sid, text: LONG_TEXT }); await c.hears(h, t0); await sleep(2000);
  const rxBefore = h.audibleIn(t0).length; const tDrop = now(); await h.disconnect();
  await until(() => c.inMsgs(sid, 'participant.leave').length > 0, 12000); const leaveMs = c.inMsgs(sid, 'participant.leave')[0] ? c.inMsgs(sid, 'participant.leave')[0].recvAt - tDrop : NaN;
  await sleep(1000); const tRe = now(); const h2 = await c.human(sid, 'p1'); await until(() => !!c.final(sid, segmentId), 12000); await sleep(1500);
  const fin = c.final(sid, segmentId); const rxAfter = h2.audibleIn(tRe).length; const total = (rxBefore + rxAfter) * 20;
  const join2 = c.inMsgs(sid, 'participant.join')[1]; const greets = c.evs(sid, (e) => e.dir === 'out' && e.msg.type === 'bot.say' && e.msg.text.startsWith('Hi there')).length;
  const finishes = c.progress(sid, segmentId).filter((e) => e.msg.finished).length;
  const n = c.finals(sid).length; await h2.speak('en_ls_power'); await until(() => c.finals(sid).length > n, 6000); const worksAfter = c.finals(sid).length > n;
  await h2.disconnect();
  return verdict('S10', { leaveReported: !Number.isNaN(leaveMs), rejoinFlagged: join2?.msg.rejoin === true, greetedOnce: greets === 1, segmentFinishedOnce: finishes === 1, noDuplicateAudio: total <= (fin?.totalMs ?? 0) + 120, turnsWorkAfterRejoin: worksAfter },
    { leaveDetectedAfterMs: Math.round(leaveMs), audibleMsBefore: rxBefore * 20, audibleMsAfter: rxAfter * 20, segmentTotalMs: fin?.totalMs, progress: fin }, 'dropped and rejoined without a repeated greeting or repeated audio');
}

export async function S11(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('s11'); const h = await c.human(sid, 'p1'); const rows: any[] = []; const M = manifest().clips;
  const langs: Record<string, string[]> = { en: ['en_jfk', 'en_ls_experience', 'en_ls_halt', 'en_ls_power'], ar: clipsLang('ar') };
  for (let rep = 0; rep < 2; rep++) for (const lang of ['en', 'ar']) for (const id of langs[lang]) {
    const n = c.finals(sid).length; const r = await h.speak(id); await until(() => c.finals(sid).length > n, 9000);
    const t = c.finals(sid)[n]; rows.push({ clip: id, lang, rep, ok: !!t, text_ok: t?.msg.text === M[id].transcript, reason: t?.msg.endReason ?? null, latencyMs: t ? Math.round(t.recvAt - r.speechEndAt) : null });
    await sleep(3200);
  }
  const stats = await c.st.stats(); await h.disconnect();
  // classify each run: ok = turn ended after the speech ended and by a Smart Turn / provider decision;
  // early_cut = turn ended while the person was still talking (a pause inside the sentence); timeout = needed the 3 s silence fallback
  for (const r of rows) r.class = r.latencyMs === null ? 'no_turn' : r.latencyMs < -300 ? 'early_cut' : r.reason === 'stop_secs_timeout' ? 'timeout' : 'ok';
  const okLat = (l: string) => summarize(rows.filter((r) => r.lang === l && r.class === 'ok').map((r) => r.latencyMs));
  const bad = (l: string) => rows.filter((r) => r.lang === l && r.class !== 'ok').length / rows.filter((r) => r.lang === l).length;
  const en = okLat('en'), ar = okLat('ar'), enBad = bad('en'), arBad = bad('ar');
  return verdict('S11', { allTurnsDelivered: rows.every((r) => r.ok), arabicTextIntact: rows.filter((r) => r.lang === 'ar').every((r) => r.text_ok), arabicOkLatencyWithin500msOfEnglish: ar.n > 0 && ar.p50 <= en.p50 + 500, arabicMishandledNotWorseThanEnglish: arBad <= enBad },
    { englishOkLatencyMs: { n: en.n, p50: Math.round(en.p50), max: en.max }, arabicOkLatencyMs: { n: ar.n, p50: Math.round(ar.p50), max: ar.max }, englishMishandledShare: enBad, arabicMishandledShare: arBad, rows, smartTurnLog: stats.smartTurn, caveat: '1 real Arabic speaker clip + 3 synthetic clips; fake STT text; mishandled = early cut in the middle of the clip, or the 3 s silence fallback; see clips/SOURCES.md' },
    `Arabic ok-latency p50 ${Math.round(ar.p50)} ms vs English ${Math.round(en.p50)} ms; mishandled ${arBad * 100}% vs ${enBad * 100}%`);
}

/** Extra protocol checks (not S rows): committed-only and retract. */
export async function X1(c: Ctx): Promise<Result> {
  await c.cfg({ greet: false });
  const sid = c.sid('x1'); const h = await c.human(sid, 'p1'); const t0 = now();
  const un = (await c.admin('say_uncommitted', { sessionId: sid, text: 'This is not committed and must stay silent.' })).segmentId; await sleep(1500);
  const pr = c.final(sid, un); const heardUn = h.audibleIn(t0).length;
  const a = (await c.admin('say', { sessionId: sid, text: LONG_TEXT })).segmentId; const b = (await c.admin('say', { sessionId: sid, text: 'Second queued line that is later withdrawn.' })).segmentId;
  await sleep(1000); await c.admin('retract', { sessionId: sid, segmentId: b }); await sleep(500);
  const bp = c.final(sid, b); const t1 = now(); await c.finished(sid, a, 12000); await sleep(1500);
  const heardAfterA = h.audibleIn(t1 + 500).length * 20; const fa = c.final(sid, a);
  await h.disconnect();
  return verdict('X1', { uncommittedRejected: pr?.reason === 'rejected' && heardUn === 0, retractedQueuedSegmentReported: bp?.reason === 'retract' && bp?.playedMs === 0, firstSegmentCompleted: !!fa && !fa.interrupted, retractedSegmentNeverPlayed: heardAfterA <= (fa?.totalMs ?? 0) },
    { uncommitted: pr, retract: bp }, 'uncommitted text stayed silent; retracted queued segment never played');
}

export async function S13(c: Ctx): Promise<Result> { // needs a stack started with --emotion-stub; compares with the default behaviour recorded in `noStubSeen`
  await c.cfg({ greet: false });
  const sid = c.sid('s13'); const h = await c.human(sid, 'p1'); const got: Record<string, any> = {}; const turnSeen: Record<string, boolean> = {};
  for (const [name, gain] of [['whisper', 0.08], ['quiet', 0.3], ['normal', 1], ['loud', 4]] as const) { const n = c.finals(sid).length; await h.speak('en_ls_power', { gain }); await until(() => c.finals(sid).length > n, 6000); got[name] = c.finals(sid)[n]?.msg.emotion ?? null; turnSeen[name] = c.finals(sid).length > n; await sleep(3000); }
  await h.disconnect();
  return verdict('S13', { quietIsCalm: got.quiet?.label === 'calm', loudIsExcited: got.loud?.label === 'excited', allMarkedStub: ['quiet', 'normal', 'loud'].every((k) => got[k]?.source === 'stub'), confidenceInRange: ['quiet', 'normal', 'loud'].every((k) => got[k] && got[k].confidence >= 0 && got[k].confidence <= 1) },
    { labels: got, turnSeen, note: 'whisper (gain 0.08, about -47 dBFS) is informational: shows whether the engine heard a turn at all' }, 'stub label rode on user.turn');
}
export { Human };
