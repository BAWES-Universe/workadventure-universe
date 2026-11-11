// Turns the raw per-clip outcomes into the comparison. Settings are picked on the "tune" half only and every number
// in the tables comes from the "report" half, which the pick never saw.
//   tsx src/report.ts <out dir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDER_PAUSE_MS } from './gate.ts';
import { applyRule, RULES } from './rules.ts';

interface Raw {
    id: string;
    kind: 'noise' | 'speech' | 'burst';
    set: string;
    label: string;
    condition: string;
    split: 'tune' | 'report';
    seconds: number;
    onset?: number;
    offset?: number;
    clipStart?: number;
    gate: Record<string, { triggers: number[]; turnsOpened: number; sttMs: number; talkingMs: number }>;
    probs: string;
}
const out = process.argv[2];
const raws: Raw[] = [];
for (const f of readdirSync(out).filter((f) => /^raw-\d+\.jsonl$/.test(f)).sort()) {
    for (const line of readFileSync(join(out, f), 'utf8').split('\n')) if (line) raws.push(JSON.parse(line));
}
const GATES = ['gate 100 ms', 'gate 200 ms', 'gate 300 ms'];
const detectors = [...GATES, ...RULES.map((r) => r.name)];
const triggers = new Map<string, Map<string, number[]>>();
for (const raw of raws) {
    const per = new Map<string, number[]>();
    for (const g of GATES) per.set(g, raw.gate[g].triggers);
    const probs = Float32Array.from(Buffer.from(raw.probs, 'base64'), (v) => v / 255);
    for (const rule of RULES) per.set(rule.name, applyRule(probs, rule, PROVIDER_PAUSE_MS));
    triggers.set(raw.id, per);
}
// Caught: the detector fires after the person's clip begins and no later than 0.6 s after their last sound. The clip's own
// start is used, not the energy-based onset, because soft first sounds ("s", "y") come before the energy rises.
const caughtAt = (raw: Raw, det: string): number | undefined => triggers.get(raw.id)!.get(det)!.find((t) => t >= raw.clipStart! - 0.05 && t <= raw.offset! + 0.6);
/** The detector had already fired on the background before the person made a sound. */
const firedBefore = (raw: Raw, det: string): boolean => triggers.get(raw.id)!.get(det)!.some((t) => t < raw.clipStart! - 0.05);
const pct = (xs: number[], p: number): number => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

function noiseStats(split: string, det: string, filter: (r: Raw) => boolean): { hours: number; episodes: number; perHour: number } {
    let seconds = 0;
    let episodes = 0;
    for (const r of raws) {
        if (r.split !== split || r.kind !== 'noise' || !filter(r)) continue;
        seconds += r.seconds;
        episodes += triggers.get(r.id)!.get(det)!.length;
    }
    return { hours: seconds / 3600, episodes, perHour: seconds ? episodes / (seconds / 3600) : NaN };
}
function speechStats(split: string, det: string, filter: (r: Raw) => boolean) {
    let n = 0;
    let caught = 0;
    let newlyMissed = 0;
    let before = 0;
    const lat: number[] = [];
    for (const r of raws) {
        if (r.split !== split || r.kind !== 'speech' || !filter(r)) continue;
        n++;
        if (firedBefore(r, det)) before++;
        const t = caughtAt(r, det);
        if (t !== undefined) {
            caught++;
            lat.push(Math.max(0, t - r.onset!) * 1000);
        } else if (caughtAt(r, 'gate 100 ms') !== undefined) newlyMissed++;
    }
    return { n, caught, missed: n - caught, newlyMissed, before, p50: Math.round(pct(lat, 0.5)), p95: Math.round(pct(lat, 0.95)), max: Math.round(Math.max(...lat, 0)) };
}

// Pick: on the tune half, the fewest newly missed interruptions first, then the fewest false stops on non-speech noise, then the quickest
const score = RULES.map((rule) => {
    const s = speechStats('tune', rule.name, () => true);
    const n = noiseStats('tune', rule.name, (r) => r.label === 'nonspeech');
    return { rule: rule.name, newlyMissed: s.newlyMissed, missed: s.missed, noisePerHour: n.perHour, p95: s.p95 };
}).sort((a, b) => a.newlyMissed - b.newlyMissed || a.noisePerHour - b.noisePerHour || a.p95 - b.p95);
// A second pick that allows a few new misses (at most 0.5% of clips today's gate catches) for less noise, to show the trade
const tuneCaughtToday = speechStats('tune', 'gate 100 ms', () => true).caught;
const balanced = [...score].filter((s) => s.newlyMissed <= 0.005 * tuneCaughtToday).sort((a, b) => a.noisePerHour - b.noisePerHour || a.newlyMissed - b.newlyMissed)[0];
const strict = score[0];
const shown = [...GATES, ...new Set([strict.rule, balanced.rule])];

const md: string[] = [];
const table = (head: string[], rows: (string | number)[][]): void => {
    md.push('| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map((r) => '| ' + r.join(' | ') + ' |'), '');
};
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');

md.push('# Offline comparison: today\'s volume gate and Silero (Stage 1)', '');
md.push(`Clips: ${raws.length} (${raws.filter((r) => r.split === 'report').length} in the report half). Every number below is from the report half; settings were picked on the other half.`, '');
md.push('## Picked on the tune half', '');
table(
    ['pick', 'rule', 'newly missed (tune)', 'all missed (tune)', 'false stops/h on non-speech noise (tune)', 'p95 delay ms (tune)'],
    [
        ['strict (fewest new misses)', strict.rule, strict.newlyMissed, strict.missed, f1(strict.noisePerHour), strict.p95],
        ['balanced (at most 0.5% new misses)', balanced.rule, balanced.newlyMissed, balanced.missed, f1(balanced.noisePerHour), balanced.p95],
    ]
);

md.push('## False stops on noise only (bot assumed speaking the whole time)', '');
for (const group of ['nonspeech', 'scene', 'speechlike']) {
    md.push(`### ${group}`, '');
    const rows: (string | number)[][] = [];
    for (const level of ['-45', '-35', '-25']) {
        for (const det of shown) {
            const s = noiseStats('report', det, (r) => r.label === group && r.condition === level);
            rows.push([level, det, s.hours.toFixed(2), s.episodes, f1(s.perHour)]);
        }
    }
    table(['noise level dBFS', 'detector', 'hours', 'stops', 'stops per hour'], rows);
}
md.push('### Share of noise-only time the worker holds "someone is speaking"', '', 'Today a spoken reply waits while this is held, and one that has started is cut. For Silero: the share of 32 ms windows at or above the rule\'s probability.', '');
{
    const rows: (string | number)[][] = [];
    for (const group of ['nonspeech', 'scene', 'speechlike']) {
        for (const level of ['-45', '-35', '-25']) {
            let seconds = 0;
            let talking = 0;
            let windows = 0;
            let speechWindows = 0;
            const on = RULES.find((r) => r.name === strict.rule)!.on;
            for (const r of raws) {
                if (r.split !== 'report' || r.kind !== 'noise' || r.label !== group || r.condition !== level) continue;
                seconds += r.seconds;
                talking += r.gate['gate 100 ms'].talkingMs / 1000;
                for (const v of Buffer.from(r.probs, 'base64')) {
                    windows++;
                    if (v / 255 >= on) speechWindows++;
                }
            }
            rows.push([group, level, ((100 * talking) / seconds).toFixed(0) + '%', ((100 * speechWindows) / windows).toFixed(1) + '%']);
        }
    }
    table(['noise', 'level dBFS', 'today\'s gate', strict.rule.replace(/ for .*/, '')], rows);
}
md.push('### Non-speech noise by class (all three levels together)', '');
{
    const classes = [...new Set(raws.filter((r) => r.kind === 'noise' && r.label === 'nonspeech' && r.split === 'report').map((r) => r.set))].sort();
    table(['class', 'hours', ...shown.map((d) => d + ' (stops/h)')], classes.map((c) => [c, noiseStats('report', shown[0], (r) => r.set === c).hours.toFixed(2), ...shown.map((d) => f1(noiseStats('report', d, (r) => r.set === c).perHour))]));
}
md.push('### Three 100 ms bursts with pauses (share of clips that stop the bot)', '');
{
    const rows: (string | number)[][] = [];
    for (const level of ['-30', '-20']) {
        const clips = raws.filter((r) => r.kind === 'burst' && r.condition === level && r.split === 'report');
        rows.push([level, clips.length, ...shown.map((d) => `${clips.filter((r) => triggers.get(r.id)!.get(d)!.length > 0).length}/${clips.length}`)]);
    }
    table(['burst level dBFS', 'clips', ...shown], rows);
}

md.push('## Real interruptions (speech)', '', 'Fired for the person = the detector fires after their clip begins and at most 0.6 s after their last sound. Delay = first sound (by energy) to firing, offline, with no network or playout. In the two noise conditions the background starts 1 s before the person: a detector that has already fired on it has already stopped the bot, and does not fire again for the person.', '');
for (const set of ['en-command', 'ar-command', 'en-sentence']) {
    md.push(`### ${set}`, '');
    const rows: (string | number)[][] = [];
    for (const condition of ['S20', 'S30', 'S40', 'N10', 'N5']) {
        for (const det of shown) {
            const s = speechStats('report', det, (r) => r.set === set && r.condition === condition);
            rows.push([condition, det, s.n, s.before, s.missed, s.newlyMissed, ((100 * s.caught) / s.n).toFixed(1) + '%', s.p50, s.p95, s.max]);
        }
    }
    table(['condition', 'detector', 'clips', 'already fired on the background', 'no new firing for the person', 'of those, caught by today\'s gate', 'fired for the person', 'delay p50 ms', 'p95', 'max'], rows);
}
md.push('### Short commands by word (all conditions)', '');
{
    const words = [...new Set(raws.filter((r) => r.kind === 'speech' && r.set !== 'en-sentence').map((r) => `${r.set}/${r.label}`))].sort();
    table(['word', 'clips', ...shown.map((d) => d + ' missed')], words.map((w) => {
        const f = (r: Raw): boolean => `${r.set}/${r.label}` === w;
        return [w, speechStats('report', shown[0], f).n, ...shown.map((d) => speechStats('report', d, f).missed)];
    }));
}

md.push('## Speech-to-text opened by noise today (report half, non-speech noise)', '');
{
    const rows: (string | number)[][] = [];
    for (const level of ['-45', '-35', '-25']) {
        let seconds = 0;
        let turns = 0;
        let stt = 0;
        for (const r of raws) {
            if (r.split !== 'report' || r.kind !== 'noise' || r.label !== 'nonspeech' || r.condition !== level) continue;
            seconds += r.seconds;
            turns += r.gate['gate 100 ms'].turnsOpened;
            stt += r.gate['gate 100 ms'].sttMs;
        }
        rows.push([level, (seconds / 3600).toFixed(2), turns, f1(turns / (seconds / 3600)), ((100 * stt) / 1000 / seconds).toFixed(0) + '%']);
    }
    table(['noise level dBFS', 'hours', 'streams opened', 'per hour', 'share of the noise sent to speech-to-text'], rows);
}

md.push('## Every Silero setting on the report half', '');
table(
    ['rule', 'newly missed', 'all missed', 'false stops/h non-speech', 'false stops/h speech-like', 'delay p50', 'p95'],
    RULES.map((rule) => {
        const s = speechStats('report', rule.name, () => true);
        return [rule.name, s.newlyMissed, s.missed, f1(noiseStats('report', rule.name, (r) => r.label === 'nonspeech').perHour), f1(noiseStats('report', rule.name, (r) => r.label === 'speechlike').perHour), s.p50, s.p95];
    })
);
{
    const rows = GATES.map((g) => {
        const s = speechStats('report', g, () => true);
        return [g, s.newlyMissed, s.missed, f1(noiseStats('report', g, (r) => r.label === 'nonspeech').perHour), f1(noiseStats('report', g, (r) => r.label === 'speechlike').perHour), s.p50, s.p95];
    });
    table(['today\'s gate', 'newly missed', 'all missed', 'false stops/h non-speech', 'false stops/h speech-like', 'delay p50', 'p95'], rows);
}
writeFileSync(join(out, 'results.md'), md.join('\n'));
// The clips today's gate catches and the picked rule does not, for a person to listen to
const review = raws.filter((r) => r.kind === 'speech' && caughtAt(r, strict.rule) === undefined && caughtAt(r, 'gate 100 ms') !== undefined).map((r) => `${r.split}\t${r.id}`).sort();
writeFileSync(join(out, 'newly-missed.tsv'), review.join('\n') + '\n');
writeFileSync(join(out, 'picks.json'), JSON.stringify({ strict, balanced, clips: raws.length }, null, 2));
console.log(md.join('\n'));
