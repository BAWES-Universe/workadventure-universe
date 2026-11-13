// Tables for the real-provider run: what Soniox heard (soniox-record.ts) and what the pause did with it (yield-replay.ts,
// `recorded`).
//   tsx src/soniox-report.ts <soniox-record.jsonl> <soniox-record-cost.json> <yield-replay-recorded.jsonl> <out.md>
// "Words" are any partial or final text. A command counts as heard right when the final text holds the word (English) or
// one of its usual Arabic spellings; this is a string check, nobody listened. The person starts at 1.0 s plus the varied
// lead-in (played.ts); a stop before that came from the background.
import { readFileSync, writeFileSync } from 'node:fs';
import { percentile } from './scoring.ts';

type Ev = [number, string, string?, number?];
interface Stream { openAt: number; finishAt?: number; events: Ev[]; sentMs: number }
interface Rec { id: string; kind: string; set: string; label: string; condition: string; group: string; language: string; seconds: number; leadExtraMs: number; onsetMs?: number; offsetMs?: number; streams: Stream[]; sentMs: number }
interface Outcome { stopAt?: number; heldMs: number; pauses: number; resumes: number; continues: number; spanMs: number; events: [number, string][]; why: Record<string, number> }
interface Row { id: string; kind: string; group: string; onsetMs?: number; leadExtraMs: number; result: Record<string, Outcome> }

const [recPath, costPath, rowsPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: soniox-report.ts <soniox-record.jsonl> <cost.json> <yield-replay-recorded.jsonl> <out.md>');
const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const recs = lines(recPath).map((l) => JSON.parse(l) as Rec);
const rows = new Map(lines(rowsPath).map((l) => JSON.parse(l) as Row).map((r) => [r.id, r]));
const cost = JSON.parse(readFileSync(costPath, 'utf8')) as Record<string, number>;
const out: string[] = [];
const say = (s = '') => out.push(s);
const ms = (x: number) => (Number.isNaN(x) ? '-' : `${Math.round(x)} ms`);
const sec = (x: number) => (Number.isNaN(x) ? '-' : `${(x / 1000).toFixed(1)} s`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const p = (xs: number[], q: number) => (xs.length ? percentile(xs, q) : NaN);
const GOING_ON = new Set(['resume', 'continue', 'up']);

const norm = (t: string) => t.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const ARABIC: Record<string, string[]> = { stop: ['توقف', 'وقف', 'قف'], no: ['لا'], yes: ['نعم', 'ايوه', 'اي'], cancel: ['الغاء', 'الغي', 'لغي'], close: ['اغلق', 'اغلاق', 'سكر'], ok: ['تمام', 'اوكي', 'ok', 'okay', 'طيب'] };
function heardRight(r: Rec, text: string): boolean {
    const words = ` ${norm(text)} `;
    if (r.set === 'en-command') return words.includes(` ${r.label} `);
    if (r.set === 'ar-command') return (ARABIC[r.label] ?? []).some((w) => words.includes(` ${norm(w)} `) || words.includes(` و${norm(w)} `));
    return text.trim() !== '';
}
const allText = (r: Rec) => r.streams.flatMap((s) => s.events.filter((e) => (e[1] === 'partial' || e[1] === 'final') && (e[2] ?? '').trim()).map((e) => e[2]!));
const finals = (r: Rec) => r.streams.map((s) => s.events.find((e) => e[1] === 'final')?.[2] ?? '').filter((t) => t.trim()).join(' ');
const endOf = (s: Stream) => {
    const f = s.events.find((e) => e[1] === 'final' || e[1] === 'failed');
    if (!f) return 'none';
    if (f[1] === 'failed') return 'failed';
    if ((f[2] ?? '').trim()) return 'text';
    return s.events.some((e) => e[1] === 'partial' && (e[2] ?? '').trim()) ? 'retracted' : 'empty';
};
const groups = [...new Set(recs.map((r) => r.group))];

say('# Real-provider check: Soniox, recorded, then replayed through the pause');
say();
say(`Clips: ${recs.length}, all from the report half (never used to pick the quiet window). Streams opened: ${cost.streams}. Audio sent to Soniox: ${cost.sentMinutes} min,`);
say(`about $${cost.estimatedUsd} at $${cost.pricePerHourUsd} per hour (real-time). Model stt-rt-v6, the worker's own connector and settings, played in`);
say('real time from this machine. Noise is played for its first 10 s; speech over noise gets 0 to 2 s more noise before the person starts.');
say();
say('## What Soniox heard');
say();
say('| group | clips | any words heard | streams: text / taken back / empty / failed |');
say('| --- | --- | --- | --- |');
for (const g of groups) {
    const rs = recs.filter((r) => r.group === g);
    const ends = rs.flatMap((r) => r.streams.map(endOf));
    const n = (k: string) => ends.filter((e) => e === k).length;
    say(`| ${g} | ${rs.length} | ${rs.filter((r) => allText(r).length).length} | ${n('text')} / ${n('retracted')} / ${n('empty')} / ${n('failed')}${n('none') ? ` (no end: ${n('none')})` : ''} |`);
}
say();
const noiseWords = recs.filter((r) => r.kind !== 'speech' && allText(r).length);
if (noiseWords.length) {
    say('Words Soniox wrote down for noise (first final or partial per clip):');
    say();
    for (const r of noiseWords.slice(0, 40)) say(`- ${r.group}, ${r.id.split('|')[1]} ${r.condition}: "${(finals(r) || allText(r)[0]).slice(0, 80)}"`);
    say();
}
say('Speech: heard right (string check), and when the words came, from the estimated onset and offset:');
say();
say('| group | clips | heard right | first words after onset, median / p95 | final words after offset, median / p95 |');
say('| --- | --- | --- | --- | --- |');
for (const g of groups.filter((x) => recs.some((r) => r.group === x && r.kind === 'speech'))) {
    const rs = recs.filter((r) => r.group === g && r.kind === 'speech');
    const first: number[] = [];
    const last: number[] = [];
    for (const r of rs) {
        const e = r.streams.flatMap((s) => s.events).filter((x) => (x[1] === 'partial' || x[1] === 'final') && (x[2] ?? '').trim() && x[0] >= (r.onsetMs ?? 0) - 200);
        if (e.length) first.push(e[0][0] - (r.onsetMs ?? 0));
        const f = r.streams.flatMap((s) => s.events).filter((x) => x[1] === 'final' && (x[2] ?? '').trim() && x[0] >= (r.onsetMs ?? 0) - 200);
        if (f.length) last.push(f[f.length - 1][0] - (r.offsetMs ?? 0));
    }
    say(`| ${g} | ${rs.length} | ${rs.filter((r) => heardRight(r, finals(r))).length} | ${ms(p(first, 0.5))} / ${ms(p(first, 0.95))} | ${ms(p(last, 0.5))} / ${ms(p(last, 0.95))} |`);
}
say();

// ---- The replay with these answers ----
say("## The pause, replayed with Soniox's recorded answers");
say();
say("The worker's own Recognition and YieldControl on simulated time; the detector answers from Silero on the audio as played; each stream says");
say('what Soniox said, when it said it. Quiet window 1,500 ms (frozen). "Today" is the stop on the volume gate; "hold" is the candidate.');
say();
const startOf = (r: Row) => 1000 + (r.leadExtraMs ?? 0);
say('Speech over the bot (should stop):');
say();
say('| group | clips | never stopped: today / hold (of which Soniox heard the words) | stopped by background first: today / hold | first change after onset, hold, median / p95 | stopped for good after onset: today / hold, median / p95 | false resumes, hold (bot playback after the apparent interruption, to its stop or the end of the replay tail) |');
say('| --- | --- | --- | --- | --- | --- | --- |');
for (const g of groups.filter((x) => recs.some((r) => r.group === x && r.kind === 'speech'))) {
    const rs = recs.filter((r) => r.group === g && r.kind === 'speech').map((r) => ({ r, row: rows.get(r.id)! }));
    const never = (b: string) => rs.filter(({ row }) => row.result[b].stopAt === undefined);
    const bg = (b: string) => rs.filter(({ row }) => row.result[b].stopAt !== undefined && row.result[b].stopAt! < startOf(row)).length;
    const stops = (b: string) => rs.filter(({ row }) => row.result[b].stopAt !== undefined && row.result[b].stopAt! >= startOf(row)).map(({ row }) => row.result[b].stopAt! - row.onsetMs!);
    const changes: number[] = [];
    let fr = 0;
    let overlap = 0;
    for (const { row } of rs) {
        const o = row.result.hold;
        const onset = row.onsetMs!;
        if (o.stopAt !== undefined && o.stopAt < startOf(row)) continue;
        const before = o.events.filter(([t]) => t < onset);
        const held = before.length > 0 && !GOING_ON.has(before[before.length - 1][1]) && before[before.length - 1][1] !== 'stop' && !before[before.length - 1][1].startsWith('ended_');
        const firstAfter = held ? onset : o.events.find(([t, e]) => t >= onset && !GOING_ON.has(e) && !e.startsWith('ended_'))?.[0];
        if (firstAfter !== undefined) changes.push(firstAfter - onset);
        const end = o.stopAt ?? o.spanMs;
        const wrong = o.events.filter(([t, e]) => GOING_ON.has(e) && t >= onset && t < end);
        fr += wrong.length;
        for (const [t] of wrong) {
            const next = o.events.find(([u, e]) => u > t && (e === 'pause' || e === 'stop'));
            overlap += (next ? next[0] : end) - t;
        }
    }
    const nh = never('hold');
    const rescued = nh.filter(({ r }) => heardRight(r, finals(r))).length;
    say(`| ${g} | ${rs.length} | ${never('today').length} / ${nh.length} (${rescued}) | ${bg('today')} / ${bg('hold')} | ${ms(p(changes, 0.5))} / ${ms(p(changes, 0.95))} | ${ms(p(stops('today'), 0.5))} / ${ms(p(stops('today'), 0.95))}; ${ms(p(stops('hold'), 0.5))} / ${ms(p(stops('hold'), 0.95))} | ${fr} (${sec(overlap)}) |`);
}
say();
say('The playback time after a false resume runs from going on to the next pause or stop, or to the end of the replay, which');
say('includes the 3 s tail after the clip. It is not limited to a checked span of the person speaking, so it is not the time');
say('both were talking at once. Onsets and offsets are energy estimates, not checked by a person.');
say();
say('Noise and knocks over the bot (should not stop):');
say();
say('| group | clips | stopped: today / hold | hold stopped by: words or a failed stream / the detector / 6 s deadline / view lost | hold went on: watched / after an empty end | held, median |');
say('| --- | --- | --- | --- | --- | --- |');
for (const g of groups.filter((x) => recs.some((r) => r.group === x && r.kind !== 'speech'))) {
    const rs = recs.filter((r) => r.group === g).map((r) => rows.get(r.id)!);
    const by = (re: RegExp) => rs.filter((row) => row.result.hold.stopAt !== undefined && Object.keys(row.result.hold.why).some((k) => re.test(k))).length;
    say(
        `| ${g} | ${rs.length} | ${rs.filter((x) => x.result.today.stopAt !== undefined).length} / ${rs.filter((x) => x.result.hold.stopAt !== undefined).length} | ${by(/^confirmed_(words|stt_failed|command)/)} / ${by(/^confirmed_(detector|fallback)/)} / ${by(/^watchdog$/)} / ${by(/^continuing_view_lost$/)} | ${sum(rs.map((x) => x.result.hold.continues))} / ${sum(rs.map((x) => x.result.hold.resumes))} | ${sec(p(rs.map((x) => x.result.hold.heldMs), 0.5))} |`
    );
}
say();
writeFileSync(outPath, out.join('\n') + '\n');
console.error(`-> ${outPath}`);
