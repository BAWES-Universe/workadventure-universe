// Turns the raw per-clip outcomes into the comparison. Every number in the tables comes from the "report" half.
//   tsx src/report.ts <data dir> <out dir> [adjudication.tsv]
//
// VALID / EARLY / BACKGROUND / NONE are defined in scoring.ts. None of it is a human label.
// The rule under test is FROZEN: it was picked on the tune half in the first run (commit acb21806) and is not re-picked
// here, so no finding on the report half can move it.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest } from './fixtures.ts';
import { PROVIDER_PAUSE_MS, runLifecycleOnVerdicts, type GateResult } from './gate.ts';
import { applyRule, RULES, ruleName } from './rules.ts';
import { percentile, scoreSpeech, type Scored } from './scoring.ts';

const FROZEN_RULE = ruleName(0.5, 64);

interface Raw {
    id: string;
    kind: 'noise' | 'speech' | 'burst';
    set: string;
    label: string;
    condition: string;
    split: 'tune' | 'report';
    source: string;
    speaker?: string;
    seconds: number;
    onset?: number;
    offset?: number;
    clipStart?: number;
    gate: Record<string, GateResult>;
    probs: string;
}
const [data, out, adjudicationPath] = process.argv.slice(2);
if (!data || !out) throw new Error('usage: report.ts <data dir> <out dir> [adjudication.tsv]');

// ---- Integrity: every shard finished, every expected clip is there exactly once ----
const doneFiles = readdirSync(out).filter((f) => /^done-\d+\.json$/.test(f));
const dones = doneFiles.map((f) => JSON.parse(readFileSync(join(out, f), 'utf8')) as { shard: number; shards: number; clips: number; runtime: string });
if (!dones.length) throw new Error('no finished shard found');
const shards = dones[0].shards;
if (dones.length !== shards || dones.some((d) => d.shards !== shards) || new Set(dones.map((d) => d.shard)).size !== shards) throw new Error(`expected ${shards} finished shards, found ${dones.length}`);
const raws: Raw[] = [];
const rawHash = createHash('sha256');
for (let s = 0; s < shards; s++) {
    const text = readFileSync(join(out, `raw-${s}.jsonl`), 'utf8');
    rawHash.update(text);
    for (const line of text.split('\n')) if (line) raws.push(JSON.parse(line));
}
const manifest = buildManifest(data);
{
    const seen = new Map<string, number>();
    for (const r of raws) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    const missing = manifest.filter((m) => !seen.has(m.id)).map((m) => m.id);
    const doubled = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    const extra = [...seen.keys()].filter((id) => !manifest.some((m) => m.id === id));
    if (missing.length || doubled.length || extra.length || dones.reduce((a, d) => a + d.clips, 0) !== manifest.length) {
        throw new Error(`run is not complete: ${missing.length} missing, ${doubled.length} doubled, ${extra.length} unexpected (first: ${[...missing, ...doubled, ...extra][0]})`);
    }
}
const byId = new Map(raws.map((r) => [r.id, r]));
const probsOf = (raw: Raw): Float32Array => {
    const b = Buffer.from(raw.probs, 'base64');
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

const BASE = 'gate 100 ms';
const GATES = [BASE, 'gate 200 ms', 'gate 300 ms'];
const triggers = new Map<string, Map<string, number[]>>();
let quantisedDiffers = 0;
for (const raw of raws) {
    const per = new Map<string, number[]>();
    for (const g of GATES) per.set(g, raw.gate[g].triggers);
    const probs = probsOf(raw);
    for (const rule of RULES) per.set(rule.name, applyRule(probs, rule, PROVIDER_PAUSE_MS));
    // The first run stored probabilities as 8-bit values: how many clips' frozen-rule firings that rounding changes
    const rounded = Float32Array.from(probs, (p) => Math.round(p * 255) / 255);
    if (applyRule(rounded, RULES.find((r) => r.name === FROZEN_RULE)!, PROVIDER_PAUSE_MS).join() !== per.get(FROZEN_RULE)!.join()) quantisedDiffers++;
    triggers.set(raw.id, per);
}

const score = (raw: Raw, det: string): Scored => scoreSpeech(triggers.get(raw.id)!.get(det)!, raw.clipStart!, raw.onset!, raw.offset!);
const pct = percentile;

// ---- Adjudication (a second opinion on doubtful clips; see ADJUDICATION.md). Applied the same way to both detectors ----
/** source -> label. "no speech": the recording holds no audible speech, so it cannot be a missed interruption for anyone. */
const adjudged = new Map<string, string>();
if (adjudicationPath && existsSync(adjudicationPath)) {
    for (const line of readFileSync(adjudicationPath, 'utf8').split('\n').slice(1)) {
        const [source, label] = line.split('\t');
        if (source && label) adjudged.set(source, label);
    }
}

function noiseStats(split: string, det: string, filter: (r: Raw) => boolean): { hours: number; episodes: number; perHour: number; sources: number; firing: number } {
    let seconds = 0;
    let episodes = 0;
    const sources = new Set<string>();
    const firing = new Set<string>();
    for (const r of raws) {
        if (r.split !== split || r.kind !== 'noise' || !filter(r)) continue;
        seconds += r.seconds;
        sources.add(r.source);
        const n = triggers.get(r.id)!.get(det)!.length;
        episodes += n;
        if (n) firing.add(r.source);
    }
    return { hours: seconds / 3600, episodes, perHour: seconds ? episodes / (seconds / 3600) : NaN, sources: sources.size, firing: firing.size };
}
function speechStats(split: string, det: string, filter: (r: Raw) => boolean) {
    let n = 0;
    let valid = 0;
    let early = 0;
    let none = 0;
    let background = 0;
    let newlyMissedStrict = 0;
    let newlyMissedLenient = 0;
    let newlyCaught = 0;
    const lat: number[] = [];
    const missSources = new Set<string>();
    for (const r of raws) {
        if (r.split !== split || r.kind !== 'speech' || !filter(r)) continue;
        n++;
        const s = score(r, det);
        const b = score(r, BASE);
        if (s.background) background++;
        if (s.outcome === 'valid') {
            valid++;
            lat.push(s.delay! * 1000);
            if (b.outcome !== 'valid') newlyCaught++;
        } else {
            if (s.outcome === 'early') early++;
            else none++;
            if (b.outcome === 'valid') {
                newlyMissedStrict++;
                missSources.add(r.source);
            }
            if (b.outcome !== 'none' && s.outcome === 'none') newlyMissedLenient++;
        }
    }
    const round = (x: number): number => Math.round(x);
    return { n, valid, early, none, background, newlyMissedStrict, newlyMissedLenient, newlyCaught, missSources: missSources.size, p50: round(pct(lat, 0.5)), p95: round(pct(lat, 0.95)), max: lat.length ? round(Math.max(...lat)) : NaN, within400: lat.filter((x) => x <= 400).length };
}

const shown = [...GATES, FROZEN_RULE];
const md: string[] = [];
const table = (head: string[], rows: (string | number)[][]): void => {
    md.push('| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map((r) => '| ' + r.join(' | ') + ' |'), '');
};
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const share = (a: number, b: number): string => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');
const report = (r: Raw): boolean => r.split === 'report';

md.push('# Offline comparison: today\'s volume gate and Silero (Stage 1, corrected)', '');
md.push(
    `Run check: ${raws.length} clips from ${shards} finished shards; every clip of the fixture list is present exactly once. Raw results sha256 \`${rawHash.digest('hex').slice(0, 16)}\`. Probabilities are kept at full precision; rounding them to 8 bits (as the first run did) changes the frozen rule's firings in ${quantisedDiffers} of ${raws.length} clips.`,
    '',
    `Rule under test: **${FROZEN_RULE}** (frozen from the first run). Baseline: the worker's own Recognition class with a **specified fake provider** (waits 1.8 s of quiet, no end-of-speech events), not every deployed provider.`,
    ''
);

md.push('## What the test set is made of (report half)', '', 'Variants of one recording are not independent: the same recording appears at several levels or conditions. Rates below are measured on this set only; they are not field rates and carry no confidence interval for production.', '');
{
    const rows: (string | number)[][] = [];
    const noise = raws.filter((r) => report(r) && r.kind === 'noise');
    for (const group of ['nonspeech', 'scene', 'speechlike']) {
        const g = noise.filter((r) => r.label === group);
        const unique = new Map<string, number>();
        for (const r of g) unique.set(r.source, r.seconds);
        rows.push([`noise: ${group}`, unique.size, 'n/a', ([...unique.values()].reduce((a, b) => a + b, 0) / 60).toFixed(1) + ' min', g.length, (g.reduce((a, r) => a + r.seconds, 0) / 60).toFixed(1) + ' min (3 levels)']);
    }
    for (const set of ['en-command', 'ar-command', 'en-sentence']) {
        const g = raws.filter((r) => report(r) && r.kind === 'speech' && r.set === set);
        const unique = new Map<string, number>();
        for (const r of g) unique.set(r.source, r.offset! - r.onset!);
        const speakers = new Set(g.map((r) => r.speaker).filter(Boolean));
        rows.push([`speech: ${set}`, unique.size, set === 'en-sentence' ? 'not known' : speakers.size, ([...unique.values()].reduce((a, b) => a + b, 0) / 60).toFixed(1) + ' min of speech', g.length, '5 conditions']);
    }
    table(['part', 'distinct recordings', 'distinct speakers', 'unique duration', 'clips after variants', 'variants'], rows);
    const tuneSpeakers = new Set(raws.filter((r) => r.split === 'tune' && r.speaker).map((r) => r.speaker));
    const overlap = new Set(raws.filter((r) => report(r) && r.speaker && tuneSpeakers.has(r.speaker)).map((r) => r.speaker));
    md.push(`Speakers of short commands found on both halves: ${overlap.size} (the file name starts with the contributor id in both datasets). Sentences are split by file only; their speakers are not known, so "unseen speaker" is NOT claimed for them. The background mixed under speech comes from one shared pool on both halves.`, '');
}

md.push('## Detector firings on noise only', '', 'The bot is assumed to be speaking the whole time, so each firing would be one stop. Playback itself was not exercised. Groups come from the source\'s class name.', '');
for (const group of ['nonspeech', 'scene', 'speechlike']) {
    md.push(`### ${group}`, '');
    const rows: (string | number)[][] = [];
    for (const level of ['-45', '-35', '-25', 'all']) {
        for (const det of shown) {
            const s = noiseStats('report', det, (r) => r.label === group && (level === 'all' || r.condition === level));
            rows.push([level, det, s.sources, s.hours.toFixed(2), s.episodes, f1(s.perHour), s.firing]);
        }
    }
    table(['noise level dBFS', 'detector', 'distinct recordings', 'hours incl. variants', 'firings', 'per hour', 'recordings with a firing'], rows);
}

md.push(
    '### Time a reply would be held, through the same lifecycle',
    '',
    'Both columns go through the worker\'s unchanged Recognition class and the same two fake providers; "held" runs from user.speech_started to the end of that stretch. For Silero only the per-frame verdict is swapped (a 20 ms frame counts as speech when the last complete 32 ms window is at or above 0.50); the 100 ms total, the 1.8 s quiet and the events are today\'s code. "Provider hears words" is the worst case: a provider that returns a word for every 300 ms of whatever it is sent, so every opened stream announces speech. The last column is only detector activity (share of windows at or above 0.50), not hold time.',
    ''
);
const candidateLife = new Map<string, { silent: GateResult; words: GateResult }>();
{
    const rows: (string | number)[][] = [];
    for (const group of ['nonspeech', 'scene', 'speechlike']) {
        for (const level of ['-45', '-35', '-25']) {
            let seconds = 0;
            let windows = 0;
            let active = 0;
            const held = { baseSilent: 0, baseWords: 0, candSilent: 0, candWords: 0 };
            for (const r of raws) {
                if (!report(r) || r.kind !== 'noise' || r.label !== group || r.condition !== level) continue;
                const probs = probsOf(r);
                const life = { silent: runLifecycleOnVerdicts(probs, 0.5, r.seconds, 100, 'silent'), words: runLifecycleOnVerdicts(probs, 0.5, r.seconds, 100, 'words') };
                candidateLife.set(r.id, life);
                seconds += r.seconds;
                held.baseSilent += r.gate[BASE].talkingMs / 1000;
                held.baseWords += r.gate['gate 100 ms, provider hears words'].talkingMs / 1000;
                held.candSilent += life.silent.talkingMs / 1000;
                held.candWords += life.words.talkingMs / 1000;
                windows += probs.length;
                for (const p of probs) if (p >= 0.5) active++;
            }
            rows.push([group, level, share(held.baseSilent, seconds), share(held.candSilent, seconds), share(held.baseWords, seconds), share(held.candWords, seconds), share(active, windows)]);
        }
    }
    table(['noise', 'level dBFS', 'held: gate, silent provider', 'held: Silero verdict, silent provider', 'held: gate, provider hears words', 'held: Silero verdict, provider hears words', 'Silero windows at or above 0.50'], rows);
}

md.push('### Non-speech noise by class (all three levels together)', '');
{
    const classes = [...new Set(raws.filter((r) => r.kind === 'noise' && r.label === 'nonspeech' && report(r)).map((r) => r.set))].sort();
    table(
        ['class', 'recordings', 'hours incl. variants', ...shown.map((d) => d + ' (firings, per hour)')],
        classes.map((c) => {
            const first = noiseStats('report', shown[0], (r) => r.set === c);
            return [c, first.sources, first.hours.toFixed(2), ...shown.map((d) => {
                const s = noiseStats('report', d, (r) => r.set === c);
                return `${s.episodes}, ${f1(s.perHour)}`;
            })];
        })
    );
}
md.push('### Three 100 ms bursts with pauses (synthetic; share of clips with a firing)', '');
{
    const rows: (string | number)[][] = [];
    for (const level of ['-30', '-20']) {
        const clips = raws.filter((r) => r.kind === 'burst' && r.condition === level && report(r));
        rows.push([level, clips.length, ...shown.map((d) => `${clips.filter((r) => triggers.get(r.id)!.get(d)!.length > 0).length}/${clips.length}`)]);
    }
    table(['burst level dBFS', 'clips', ...shown], rows);
}

md.push(
    '## Speech: three outcomes',
    '',
    'VALID / EARLY / NONE as defined in scoring.ts and RESULTS.md. "Fired on background" = fired before the person\'s recording begins; in the two noise conditions the background starts 1 s before the person, and a detector that has fired on it does not fire again for the person. Delay = estimated onset to the VALID firing, offline, no network or playout, not clamped (negative = fired on a soft first sound).',
    ''
);
for (const set of ['en-command', 'ar-command', 'en-sentence']) {
    md.push(`### ${set}`, '');
    const rows: (string | number)[][] = [];
    for (const condition of ['S20', 'S30', 'S40', 'N10', 'N5']) {
        for (const det of shown) {
            const s = speechStats('report', det, (r) => r.set === set && r.condition === condition);
            rows.push([condition, det, s.n, s.background, s.valid, s.early, s.none, share(s.valid, s.n), s.p50, s.p95, s.max, share(s.within400, s.valid)]);
        }
    }
    table(['condition', 'detector', 'clips', 'fired on background', 'VALID', 'EARLY only', 'NONE', 'VALID share', 'delay p50 ms', 'p95', 'max', 'VALID within 400 ms'], rows);
}
md.push('### All speech together (report half)', '');
{
    const rows = shown.map((det) => {
        const s = speechStats('report', det, () => true);
        return [det, s.n, s.background, s.valid, s.early, s.none, s.newlyMissedStrict, s.missSources, s.newlyMissedLenient, s.newlyCaught, s.p50, s.p95, s.max];
    });
    table(['detector', 'clips', 'fired on background', 'VALID', 'EARLY only', 'NONE', 'newly missed (baseline VALID, this not VALID)', 'from distinct recordings', 'newly missed, lenient (baseline VALID or EARLY, this NONE)', 'newly caught', 'delay p50 ms', 'p95', 'max'], rows);
}
md.push(
    '### Delay where the estimated onset can be believed',
    '',
    'A single spoken word does not last 0.7 s. Where the energy estimate says a one-word recording is "speech" for longer than that, the estimate is the whole noisy file, its "onset" is the start of the file and not the word, and a delay measured from it says nothing about either detector. This rule looks only at the recording, not at any detector. Sentences are all kept.',
    ''
);
{
    const rows: (string | number)[][] = [];
    for (const set of ['en-command', 'ar-command', 'en-sentence']) {
        for (const [name, keep] of [['estimate believable', (r: Raw) => set === 'en-sentence' || r.offset! - r.onset! <= 0.7], ['estimate is the whole file', (r: Raw) => set !== 'en-sentence' && r.offset! - r.onset! > 0.7]] as const) {
            for (const det of [BASE, FROZEN_RULE]) {
                const s = speechStats('report', det, (r) => r.set === set && keep(r));
                if (s.n) rows.push([set, name, det, s.n, s.valid, s.p50, s.p95, s.max, share(s.within400, s.valid)]);
            }
        }
    }
    table(['set', 'onset', 'detector', 'clips', 'VALID', 'delay p50 ms', 'p95', 'max', 'VALID within 400 ms'], rows);
    const believable = (r: Raw): boolean => r.set === 'en-sentence' || r.offset! - r.onset! <= 0.7;
    table(['all sets, estimate believable', 'clips', 'VALID', 'delay p50 ms', 'p95', 'max', 'VALID within 400 ms'], [BASE, FROZEN_RULE].map((det) => {
        const s = speechStats('report', det, believable);
        return [det, s.n, s.valid, s.p50, s.p95, s.max, share(s.within400, s.valid)];
    }));
}
md.push('### Short commands by word (all conditions)', '');
{
    const words = [...new Set(raws.filter((r) => r.kind === 'speech' && r.set !== 'en-sentence').map((r) => `${r.set}/${r.label}`))].sort();
    table(['word', 'clips', ...shown.map((d) => d + ' not VALID')], words.map((w) => {
        const f = (r: Raw): boolean => `${r.set}/${r.label}` === w;
        return [w, speechStats('report', shown[0], f).n, ...shown.map((d) => {
            const s = speechStats('report', d, f);
            return s.n - s.valid;
        })];
    }));
}

md.push('## Speech-to-text opened by non-speech noise (report half)', '', 'Same lifecycle for both, silent fake provider. A stream opens on the first frame counted as speech and stays open until 1.8 s of quiet.', '');
{
    const rows: (string | number)[][] = [];
    for (const level of ['-45', '-35', '-25']) {
        let seconds = 0;
        const base = { turns: 0, stt: 0 };
        const cand = { turns: 0, stt: 0 };
        for (const r of raws) {
            if (!report(r) || r.kind !== 'noise' || r.label !== 'nonspeech' || r.condition !== level) continue;
            seconds += r.seconds;
            base.turns += r.gate[BASE].turnsOpened;
            base.stt += r.gate[BASE].sttMs;
            cand.turns += candidateLife.get(r.id)!.silent.turnsOpened;
            cand.stt += candidateLife.get(r.id)!.silent.sttMs;
        }
        const hours = seconds / 3600;
        rows.push([level, hours.toFixed(2), base.turns, f1(base.turns / hours), share(base.stt / 1000, seconds), cand.turns, f1(cand.turns / hours), share(cand.stt / 1000, seconds)]);
    }
    table(['noise level dBFS', 'hours incl. variants', 'gate: streams opened', 'per hour', 'share of noise sent', 'Silero verdict: streams opened', 'per hour', 'share of noise sent'], rows);
}

md.push('## Every Silero setting on the report half (for information; the rule is not re-picked)', '');
table(
    ['rule', 'newly missed', 'lenient', 'not VALID', 'firings/h non-speech', 'firings/h speech-like', 'delay p50', 'p95'],
    [...RULES.map((r) => r.name), ...GATES].map((name) => {
        const s = speechStats('report', name, () => true);
        return [name, s.newlyMissedStrict, s.newlyMissedLenient, s.n - s.valid, f1(noiseStats('report', name, (r) => r.label === 'nonspeech').perHour), f1(noiseStats('report', name, (r) => r.label === 'speechlike').perHour), s.p50, s.p95];
    })
);

// ---- After adjudication ----
if (adjudged.size) {
    const label = (r: Raw): string | undefined => adjudged.get(r.source);
    const reportSources = (kind: string, group: string | undefined, wanted: string): number => new Set(raws.filter((r) => report(r) && r.kind === kind && (group === undefined || r.label === group) && label(r) === wanted).map((r) => r.source)).size;
    md.push(
        '## The same scores after the second opinion',
        '',
        'ADJUDICATION.md says which recordings were looked at, by what, and the fixed rules for each label. It is a machine opinion (Whisper and a second voice detector), not a person listening. The scores above are the originals and stay as they are. Below, the same rule is applied to both detectors.',
        '',
        `### Speech: recordings labelled "no speech" taken out (${reportSources('speech', undefined, 'no speech')} on the report half; ${reportSources('speech', undefined, 'uncertain')} "uncertain" ones stay in as speech)`,
        ''
    );
    table(['detector', 'clips', 'VALID', 'EARLY only', 'NONE', 'newly missed', 'from distinct recordings', 'newly missed, lenient', 'newly caught', 'delay p50 ms', 'p95'], shown.map((det) => {
        const s = speechStats('report', det, (r) => label(r) !== 'no speech');
        return [det, s.n, s.valid, s.early, s.none, s.newlyMissedStrict, s.missSources, s.newlyMissedLenient, s.newlyCaught, s.p50, s.p95];
    }));
    md.push(
        '### Non-speech noise: recordings where a voice was found taken out',
        '',
        `Only recordings where the frozen rule fired were looked at (${new Set(raws.filter((r) => report(r) && r.kind === 'noise' && r.label === 'nonspeech' && triggers.get(r.id)!.get(FROZEN_RULE)!.length > 0).map((r) => r.source)).size} of the non-speech ones), so a voice in a recording where only the gate fired would not have been found. A recording taken out is taken out whole, for both detectors, with its time.`,
        ''
    );
    const rows: (string | number)[][] = [];
    for (const [name, keep] of [
        ['as labelled by the source (original)', () => true],
        ['without "background voice" recordings', (r: Raw) => label(r) !== 'background voice'],
        ['also without "uncertain" recordings', (r: Raw) => label(r) !== 'background voice' && label(r) !== 'uncertain'],
    ] as const) {
        for (const det of [BASE, FROZEN_RULE]) {
            const s = noiseStats('report', det, (r) => r.label === 'nonspeech' && keep(r));
            rows.push([name, det, s.sources, s.hours.toFixed(2), s.episodes, f1(s.perHour), s.firing]);
        }
    }
    table(['non-speech set', 'detector', 'distinct recordings', 'hours incl. variants', 'firings', 'per hour', 'recordings with a firing'], rows);
}
writeFileSync(join(out, 'results.md'), md.join('\n'));

// ---- Evidence files: one line per clip, readable without the audio ----
const sourceSha = new Map<string, string>();
const shaOf = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
const sourcePath = (source: string): string | undefined => {
    if (source.startsWith('synthetic/')) return undefined;
    if (source.startsWith('en/')) return join(data, 'mini_speech_commands', source.slice(3));
    if (source.startsWith('ar/')) return join(data, 'asc/dataset', source.slice(3));
    if (source.startsWith('sent/')) return join(data, 'ms-snsd/clean_test', source.slice(5));
    return join(data, source);
};
const perClip = ['id\tsplit\tkind\tset\tlabel\tcondition\tsource\tsource_sha256_16\tspeaker\tseconds\tclip_start\test_onset\test_offset\tgate_firings\tgate_outcome\tsilero_firings\tsilero_outcome\tadjudged'];
for (const m of manifest) {
    const r = byId.get(m.id)!;
    if (!sourceSha.has(r.source)) {
        const p = sourcePath(r.source);
        sourceSha.set(r.source, p ? shaOf(p) : 'synthetic');
    }
    const g = triggers.get(r.id)!.get(BASE)!;
    const c = triggers.get(r.id)!.get(FROZEN_RULE)!;
    const outcome = (det: string): string => {
        if (r.kind !== 'speech') return '';
        const s = score(r, det);
        return s.outcome + (s.background ? '+background' : '');
    };
    const n3 = (x?: number): string => (x === undefined ? '' : x.toFixed(3));
    perClip.push([r.id, r.split, r.kind, r.set, r.label, r.condition, r.source, sourceSha.get(r.source), r.speaker ?? '', r.seconds.toFixed(2), n3(r.clipStart), n3(r.onset), n3(r.offset), g.map((t) => t.toFixed(2)).join(' '), outcome(BASE), c.map((t) => t.toFixed(2)).join(' '), outcome(FROZEN_RULE), adjudged.get(r.source) ?? ''].join('\t'));
}
writeFileSync(join(out, 'per-clip.tsv'), perClip.join('\n') + '\n');
// The clips today's gate catches and the frozen rule does not
const review = raws
    .filter((r) => r.kind === 'speech' && score(r, BASE).outcome === 'valid' && score(r, FROZEN_RULE).outcome !== 'valid')
    .map((r) => `${r.split}\t${r.id}\t${score(r, FROZEN_RULE).outcome}`)
    .sort();
writeFileSync(join(out, 'newly-missed.tsv'), review.join('\n') + '\n');
console.log(md.join('\n'));
