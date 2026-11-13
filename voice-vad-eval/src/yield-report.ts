// Turns the replay's rows (yield-replay.ts) into tables.
//   tsx src/yield-report.ts sweep <dir>              the tune half at each quiet window: picks one by the rule below
//   tsx src/yield-report.ts report <rows.jsonl> <out.md>   every table, for one run (the report half, once, after the pick)
// Speech clips should stop the bot; noise clips should not. "Stopped" is for good (the answer is lost); "paused",
// "turned down" and "went on" are the reversible steps. The person's recording starts 1.0 s into every speech clip (LEAD in
// fixtures.ts): a stop before that came from the background, not from them. Onset is ESTIMATED from energy (fixtures.ts).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEAD } from './fixtures.ts';
import { percentile } from './scoring.ts';

type Event = [number, string];
interface Outcome {
    yieldAt?: number;
    stopAt?: number;
    pauses: number;
    heldMs: number;
    resumes: number;
    continues: number;
    spanMs: number;
    events: Event[];
    why: Record<string, number>;
}
interface Row {
    id: string;
    kind: 'noise' | 'speech' | 'burst';
    set: string;
    label: string;
    condition: string;
    split: string;
    provider: 'empty' | 'words';
    seconds: number;
    onsetMs?: number;
    offsetMs?: number;
    result: Record<string, Outcome>;
}
const BEHAVIOURS = ['today', 'confirm', 'dip', 'strict', 'hold'] as const;
const NAMES: Record<string, string> = {
    today: "today's rule",
    confirm: 'stop only when confirmed',
    dip: 'turn down, then stop or back up',
    strict: 'pause; go on only after an empty result',
    hold: 'pause; also go on, watched, over steady noise',
};
/** Timing windows for a genuine interruption, from the person's (estimated) onset. */
const CHANGE_WINDOW_MS = 400;
const STOP_WINDOW_MS = 1000;
/** A candidate's stop counted as "as fast as today" when within this of today's. */
const MATCH_SLACK_MS = 200;
const clipStartMs = LEAD * 1000;

const read = (path: string): Row[] =>
    readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const ms = (x: number) => (Number.isNaN(x) ? '-' : `${Math.round(x)} ms`);
const sec = (x: number) => (Number.isNaN(x) ? '-' : `${(x / 1000).toFixed(1)} s`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const whyMatch = (o: Outcome, key: RegExp) => sum(Object.entries(o.why ?? {}).filter(([k]) => key.test(k)).map(([, v]) => v));
const GOING_ON = new Set(['resume', 'continue', 'up']);

/** Speech clips: what each behaviour did for the person. */
function speechStats(rows: Row[], b: string) {
    const speech = rows.filter((r) => r.kind === 'speech');
    let forPerson = 0;
    let never = 0;
    let background = 0;
    let timelyChange = 0;
    let timelyStop = 0;
    let falseResumeClips = 0;
    let falseResumes = 0;
    let watchdogStops = 0;
    const changes: number[] = [];
    const stops: number[] = [];
    const overlaps: number[] = [];
    for (const r of speech) {
        const o = r.result[b];
        const onset = r.onsetMs!;
        if (o.stopAt === undefined) never++;
        else if (o.stopAt < clipStartMs) background++;
        else {
            forPerson++;
            stops.push(o.stopAt - onset);
            if (o.stopAt - onset <= STOP_WINDOW_MS) timelyStop++;
            if (whyMatch(o, /^watchdog$/)) watchdogStops++;
        }
        // The first change the person could hear once they started (a background pause already in place counts from onset)
        const before = o.events.filter(([t]) => t < onset);
        const heldAtOnset = before.length > 0 && !GOING_ON.has(before[before.length - 1][1]) && before[before.length - 1][1] !== 'stop';
        const firstAfter = heldAtOnset ? onset : o.events.find(([t, e]) => t >= onset && !GOING_ON.has(e) && !e.startsWith('ended_'))?.[0];
        if (firstAfter !== undefined && (o.stopAt === undefined || o.stopAt >= clipStartMs)) {
            changes.push(firstAfter - onset);
            if (firstAfter - onset <= CHANGE_WINDOW_MS) timelyChange++;
        }
        // Going on again while the person is speaking or about to be stopped for them: a false resume
        const end = o.stopAt ?? o.spanMs;
        const wrong = o.events.filter(([t, e]) => GOING_ON.has(e) && t >= onset && t < end).length;
        if (o.stopAt === undefined || o.stopAt >= clipStartMs) {
            falseResumes += wrong;
            if (wrong) falseResumeClips++;
        }
        // Overlap: the bot audible (playing or turned down) after its first change since onset, until it stops for good
        if (firstAfter !== undefined && (o.stopAt === undefined || o.stopAt >= clipStartMs)) {
            let talking = false;
            let from = firstAfter;
            let total = 0;
            for (const [t, e] of o.events) {
                if (t < firstAfter) continue;
                if (GOING_ON.has(e) && !talking) {
                    talking = true;
                    from = t;
                } else if ((e === 'pause' || e === 'stop') && talking) {
                    talking = false;
                    total += t - from;
                }
            }
            if (talking) total += end - from;
            overlaps.push(total);
        }
    }
    return { n: speech.length, forPerson, never, background, timelyChange, timelyStop, falseResumeClips, falseResumes, watchdogStops, changes, stops, overlaps };
}

/** Matched against today, clip by clip: among clips today stops for the person, does the candidate too, and as fast. */
function matched(rows: Row[], b: string) {
    let base = 0;
    let same = 0;
    let later = 0;
    let missed = 0;
    let gained = 0;
    for (const r of rows.filter((x) => x.kind === 'speech')) {
        const t = r.result.today;
        const o = r.result[b];
        const todayStops = t.stopAt !== undefined && t.stopAt >= clipStartMs;
        const candStops = o.stopAt !== undefined && o.stopAt >= clipStartMs;
        if (todayStops) {
            base++;
            if (!candStops) missed++;
            else if (o.stopAt! - t.stopAt! <= MATCH_SLACK_MS) same++;
            else later++;
        } else if (candStops) gained++;
    }
    return { base, same, later, missed, gained };
}

/** Noise clips: stops, pauses and held time per minute of the bot talking (until it stopped, or to the end of the clip and its tail). */
function noiseStats(members: Row[], b: string) {
    const talkMin = sum(members.map((r) => r.result[b].stopAt ?? r.result[b].spanMs)) / 60000;
    const stopped = members.filter((r) => r.result[b].stopAt !== undefined);
    return {
        clips: members.length,
        stopped: stopped.length,
        watchdog: stopped.filter((r) => whyMatch(r.result[b], /^watchdog$/) > 0).length,
        pausesPerMin: sum(members.map((r) => r.result[b].pauses)) / talkMin,
        heldPerMin: sum(members.map((r) => r.result[b].heldMs)) / 1000 / talkMin,
        resumes: sum(members.map((r) => r.result[b].resumes)),
        continues: sum(members.map((r) => r.result[b].continues)),
        firstStop: percentile(
            stopped.map((r) => r.result[b].stopAt!),
            0.5
        ),
        detector: sum(members.map((r) => whyMatch(r.result[b], /^confirmed_(detector|fallback)/))),
        words: sum(members.map((r) => whyMatch(r.result[b], /^confirmed_(words|stt_failed|command)/))),
        viewLost: sum(members.map((r) => whyMatch(r.result[b], /^continuing_view_lost$/))),
    };
}

/** One knock trial: how long the bot was held, and when the recognizer finished, from the pause. */
function knockTrial(o: Outcome) {
    const pause = o.events.find(([, e]) => e === 'pause' || e === 'dip');
    if (!pause) return undefined;
    const back = o.events.find(([t, e]) => t >= pause[0] && (GOING_ON.has(e) || e === 'stop'));
    const empties = o.events.filter(([t, e]) => t >= pause[0] && e.startsWith('ended_'));
    return {
        held: o.heldMs,
        back: back ? back[0] - pause[0] : NaN,
        how: back?.[1] ?? 'none',
        sttDone: empties.length ? empties[empties.length - 1][0] - pause[0] : NaN,
    };
}

const groupOf = (r: Row) => (r.kind === 'burst' ? 'three knocks' : r.label);

// ---- Sweep: the tune half at each quiet window ----
/**
 * THE PICK, declared before any sweep was run: among 300, 600, 1000 and 1500 ms, the SHORTEST quiet window for which,
 * on the tune half, behaviour `hold`:
 *   (a) leaves no more speech clips never stopped than today's rule;
 *   (b) has no more speech clips with a false resume than at 1500 ms;
 *   (c) has no more total overlap (the bot audible again after its first change) on speech clips than at 1500 ms;
 *   (d) stops no more noise clips (provider hears nothing) than at 1500 ms.
 * If no shorter window meets all four, 1500 ms stays.
 */
const WINDOWS = [300, 600, 1000, 1500];
function sweep(dir: string): void {
    const lines: string[] = [];
    const say = (s = '') => lines.push(s);
    const runs = new Map<number, Row[]>();
    for (const w of WINDOWS) {
        const file = readdirSync(dir).find((f) => f === `yield-replay-tune-${w}.jsonl`);
        if (!file) throw new Error(`missing the tune run for ${w} ms`);
        const rows = read(join(dir, file));
        if (rows.some((r) => r.split !== 'tune')) throw new Error(`${file} holds clips outside the tune half`);
        runs.set(w, rows);
    }
    const stat = new Map<number, { s: ReturnType<typeof speechStats>; overlap: number; noiseStopped: number; heldPerMin: number; knockHold: number; today: ReturnType<typeof speechStats> }>();
    for (const [w, rows] of runs) {
        const s = speechStats(rows, 'hold');
        const noise = rows.filter((r) => r.kind !== 'speech' && r.provider === 'empty');
        const knocks = noise.filter((r) => r.kind === 'burst').map((r) => knockTrial(r.result.hold)?.held ?? 0);
        stat.set(w, { s, overlap: sum(s.overlaps), noiseStopped: noiseStats(noise, 'hold').stopped, heldPerMin: noiseStats(noise, 'hold').heldPerMin, knockHold: percentile(knocks, 0.5), today: speechStats(rows, 'today') });
    }
    const ref = stat.get(1500)!;
    const meets = (w: number) => {
        const x = stat.get(w)!;
        return { a: x.s.never <= x.today.never, b: x.s.falseResumeClips <= ref.s.falseResumeClips, c: x.overlap <= ref.overlap, d: x.noiseStopped <= ref.noiseStopped };
    };
    const picked = WINDOWS.find((w) => Object.values(meets(w)).every(Boolean)) ?? 1500;
    say('# Quiet window: tune half only');
    say();
    say(`${runs.get(1500)!.filter((r) => r.kind === 'speech').length} speech clips, ${runs.get(1500)!.filter((r) => r.kind !== 'speech' && r.provider === 'empty').length} noise clips. Behaviour: pause, and go on watched over steady noise.`);
    say('The rule, declared before the runs: the shortest window that (a) misses no more people than today, and is no worse than 1500 ms on');
    say('(b) false resumes, (c) overlap on speech, (d) noise clips stopped. Otherwise 1500 ms stays.');
    say();
    say('| quiet window | (a) people never stopped (today) | (b) speech clips with a false resume | (c) overlap on speech, total | (d) noise clips stopped | held s per min of noise | three knocks: held, median | meets all |');
    say('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const w of WINDOWS) {
        const x = stat.get(w)!;
        const m = meets(w);
        say(`| ${w} ms | ${x.s.never} (${x.today.never}) | ${x.s.falseResumeClips} | ${sec(x.overlap)} | ${x.noiseStopped} | ${x.heldPerMin.toFixed(1)} | ${sec(x.knockHold)} | ${Object.values(m).every(Boolean) ? 'yes' : 'no: ' + Object.entries(m).filter(([, v]) => !v).map(([k]) => k).join(', ')} |`);
    }
    say();
    say(`**Picked and frozen: ${picked} ms.**`);
    writeFileSync(join(dir, 'yield-sweep.md'), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
}

// ---- Report: every table for one run ----
function report(path: string, outPath: string): void {
    const rows = read(path);
    const lines: string[] = [];
    const say = (s = '') => lines.push(s);
    const halves = [...new Set(rows.map((r) => r.split))].join(', ');
    say('# Interruption replay: today vs the candidates, same inputs');
    say();
    say(`Half: ${halves}. Generated by \`src/yield-replay.ts\` + \`src/yield-report.ts\`. The worker's own Recognition and YieldControl code, simulated`);
    say("time, Silero probabilities from `results/raw.jsonl.gz`. The speech-to-text provider is SCRIPTED (see yield-replay.ts), and on speech clips it");
    say("hears words only from the person's estimated onset: these numbers test the logic, not a real provider's timing. The bot is taken to be");
    say('speaking throughout every clip. Each clip is followed by 8 s of silence.');
    say();

    const speechN = rows.filter((r) => r.kind === 'speech').length;
    say(`## People speaking over the bot (${speechN} clips): should stop`);
    say();
    say('First change: the first pause, dip or stop after the person\'s onset; a pause already in place at onset counts as 0 ms.');
    say();
    say(`| behaviour | stopped for the person | never stopped | stopped by background first | first change after onset, median / p95 | within ${CHANGE_WINDOW_MS} ms | stopped for good after onset, median / p95 | within ${STOP_WINDOW_MS} ms | by the 6 s deadline |`);
    say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const b of BEHAVIOURS) {
        const s = speechStats(rows, b);
        say(`| ${NAMES[b]} | ${s.forPerson} (${pct(s.forPerson, s.n)}) | ${s.never} | ${s.background} | ${ms(percentile(s.changes, 0.5))} / ${ms(percentile(s.changes, 0.95))} | ${s.timelyChange} | ${ms(percentile(s.stops, 0.5))} / ${ms(percentile(s.stops, 0.95))} | ${s.timelyStop} | ${s.watchdogStops} |`);
    }
    say();
    say(`Matched clip by clip against today's rule (clips today stops for the person; "as fast" = within ${MATCH_SLACK_MS} ms of today's stop):`);
    say();
    say('| behaviour | today stops for the person | also stopped, as fast | also stopped, later | not stopped for the person | stopped where today did not |');
    say('| --- | --- | --- | --- | --- | --- |');
    for (const b of BEHAVIOURS.filter((x) => x !== 'today')) {
        const m = matched(rows, b);
        say(`| ${NAMES[b]} | ${m.base} | ${m.same} | ${m.later} | ${m.missed} | ${m.gained} |`);
    }
    say();
    say('False resumes and overlap: the bot back at full volume after its first change since the person started (a pause already in place at their onset counts as a change at 0 ms; time turned down is not counted as overlap):');
    say();
    say('| behaviour | clips with a false resume | false resumes | overlap per clip, median / p95 | overlap, total |');
    say('| --- | --- | --- | --- | --- |');
    for (const b of BEHAVIOURS) {
        const s = speechStats(rows, b);
        say(`| ${NAMES[b]} | ${s.falseResumeClips} | ${s.falseResumes} | ${ms(percentile(s.overlaps, 0.5))} / ${ms(percentile(s.overlaps, 0.95))} | ${sec(sum(s.overlaps))} |`);
    }
    say();
    say('Never stopped, by set and condition:');
    say();
    say('| set | condition | clips | ' + BEHAVIOURS.map((b) => NAMES[b]).join(' | ') + ' |');
    say('| --- | --- | --- | ' + BEHAVIOURS.map(() => '---').join(' | ') + ' |');
    const groups = new Map<string, Row[]>();
    for (const r of rows.filter((x) => x.kind === 'speech')) groups.set(`${r.set}|${r.condition}`, [...(groups.get(`${r.set}|${r.condition}`) ?? []), r]);
    for (const [key, group] of [...groups].sort()) {
        const [set, condition] = key.split('|');
        const counts = BEHAVIOURS.map((b) => group.filter((r) => r.result[b].stopAt === undefined).length);
        if (counts.some(Boolean)) say(`| ${set} | ${condition} | ${group.length} | ${counts.join(' | ')} |`);
    }
    say();

    for (const provider of ['empty', 'words'] as const) {
        const noise = rows.filter((r) => r.kind !== 'speech' && r.provider === provider);
        say(`## Noise and knocks (${noise.length} clips), provider ${provider === 'empty' ? 'hears nothing (a successful empty result)' : 'hears words in anything (background speech transcribed)'}: should not stop`);
        say();
        say('Rates are per minute of reply-active elapsed time: from the start of the clip to the stop, or to the end of the clip and its 8 s');
        say('tail. Time spent paused and the silent tail are included, not subtracted: this is not time the bot was actually heard talking.');
        say();
        say('| behaviour | group | clips stopped for good | of which by the 6 s deadline | pauses or dips per min | held s per min | went on after an empty result | went on, watched |');
        say('| --- | --- | --- | --- | --- | --- | --- | --- |');
        const byGroup = new Map<string, Row[]>();
        for (const r of noise) byGroup.set(groupOf(r), [...(byGroup.get(groupOf(r)) ?? []), r]);
        for (const b of BEHAVIOURS) {
            for (const [group, members] of [...byGroup].sort()) {
                const x = noiseStats(members, b);
                say(`| ${NAMES[b]} | ${group} (${x.clips}) | ${x.stopped} (${pct(x.stopped, x.clips)}) | ${x.watchdog} | ${x.pausesPerMin.toFixed(2)} | ${x.heldPerMin.toFixed(1)} | ${x.resumes} | ${x.continues} |`);
            }
        }
        say();
        const steady = noise.filter((x) => x.kind === 'noise');
        const byLevel = (title: string, pool: Row[]) => {
            say(title);
            say();
            say('| behaviour | level (dBFS) | clips | stopped | first stop after | detector heard speech | words or failure | 6 s deadline | view lost while going on | went on, watched |');
            say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
            for (const b of BEHAVIOURS) {
                const levels = new Map<string, Row[]>();
                for (const r of pool) levels.set(r.condition, [...(levels.get(r.condition) ?? []), r]);
                for (const [level, members] of [...levels].sort((p, q) => Number(p[0]) - Number(q[0]))) {
                    const x = noiseStats(members, b);
                    const t = b === 'today';
                    say(`| ${NAMES[b]} | ${level} | ${x.clips} | ${x.stopped} | ${sec(x.firstStop)} | ${t ? '-' : x.detector} | ${t ? '-' : x.words} | ${t ? '-' : x.watchdog} | ${t ? '-' : x.viewLost} | ${t ? '-' : x.continues} |`);
                }
            }
            say();
        };
        const nonSpeech = steady.filter((x) => x.label === 'nonspeech');
        byLevel(`Steady non-speech noise only (${nonSpeech.length} clips), by level: what stopped it, and how long the bot could talk first (median over clips that stopped):`, nonSpeech);
        byLevel(`All ${steady.length} steady fixtures pooled (non-speech, scenes and speech-like noise together), by level:`, steady);
        const knocks = noise.filter((r) => r.kind === 'burst');
        if (knocks.length) {
            say(`Three knocks in 1.3 s, one trial per clip (${knocks.length} trials): from the pause, how long until the bot went on, and when the recognizer finished.`);
            say();
            say('| behaviour | trials paused | went on | stopped | held, median / p95 | recognizer finished after, median | bot went on after, median |');
            say('| --- | --- | --- | --- | --- | --- | --- |');
            for (const b of BEHAVIOURS.filter((x) => x === 'strict' || x === 'hold' || x === 'dip')) {
                const trials = knocks.map((r) => knockTrial(r.result[b])).filter((x): x is NonNullable<typeof x> => !!x);
                const went = trials.filter((x) => GOING_ON.has(x.how));
                say(`| ${NAMES[b]} | ${trials.length} | ${went.length} | ${trials.filter((x) => x.how === 'stop').length} | ${sec(percentile(trials.map((x) => x.held), 0.5))} / ${sec(percentile(trials.map((x) => x.held), 0.95))} | ${sec(percentile(trials.map((x) => x.sttDone), 0.5))} | ${sec(percentile(went.map((x) => x.back), 0.5))} |`);
            }
            say();
        }
    }
    writeFileSync(outPath, lines.join('\n') + '\n');
    console.log(lines.join('\n'));
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'sweep' && a) sweep(a);
else if (mode === 'report' && a && b) report(a, b);
else throw new Error('usage: yield-report.ts sweep <dir> | report <rows.jsonl> <out.md>');
