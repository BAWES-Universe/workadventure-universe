// Does the detector behave the same on both ways audio reaches the worker?
//  1. Frame size: the same samples cut as a peer lane cuts them (20 ms), as a LiveKit room does (10 ms), and at odd
//     sizes must give exactly the same Silero probabilities (the FIFO re-chunks them).
//  2. The paths themselves: a fixed subset of the report half is sent through each path (see paths.ts) and through
//     the picked rule and today's gate.
//   tsx src/parity.ts <data dir> <out dir> "<rule name>"
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, LEAD, type Item } from './fixtures.ts';
import { PROVIDER_PAUSE_MS, runGate } from './gate.ts';
import { peerLanePath, roomPath, type PathAudio } from './paths.ts';
import { applyRule, RULES } from './rules.ts';
import { SileroModel } from './silero.ts';

const [data, out, ruleName] = process.argv.slice(2);
const rule = RULES.find((r) => r.name === ruleName);
if (!rule) throw new Error(`unknown rule: ${ruleName}`);
const model = await SileroModel.load(join(data, 'silero_vad_v6.2.3.onnx'), 'native');
const manifest = buildManifest(data).filter((i) => i.split === 'report');

async function probsIn(pcm: Int16Array, sizes: () => number): Promise<number[]> {
    const stream = model.stream();
    const probs: number[] = [];
    for (let at = 0; at < pcm.length; ) {
        const n = Math.min(sizes(), pcm.length - at);
        probs.push(...(await stream.push(pcm.subarray(at, at + n))));
        at += n;
    }
    return probs;
}

const md: string[] = ['# Both paths: proximity WebRTC (peer lane) and LiveKit room', ''];

// 1. Frame size
{
    const sample = manifest.filter((_, i) => i % 60 === 0).slice(0, 60);
    let windows = 0;
    let worst = 0;
    let seed = 7;
    const odd = (): number => 1 + ((seed = (seed * 1103515245 + 12345) >>> 0) % 997);
    for (const item of sample) {
        const pcm = item.build().pcm;
        const reference = await probsIn(pcm, () => 512);
        for (const sizes of [() => 320, () => 160, () => 480, odd]) {
            const other = await probsIn(pcm, sizes);
            if (other.length !== reference.length) throw new Error('window count differs');
            for (let i = 0; i < reference.length; i++) worst = Math.max(worst, Math.abs(other[i] - reference[i]));
        }
        windows += reference.length;
    }
    md.push('## Frame size', '', `${sample.length} clips, ${windows} windows, fed in 512, 320 (20 ms, peer lane), 160 (10 ms, room), 480 and random 1 to 997 samples at a time.`, '', `Largest difference in speech probability between any two ways of cutting the same audio: **${worst}**.`, '');
}

// 2. The paths
{
    const pickEvery = (items: Item[], n: number): Item[] => items.filter((_, i) => i % Math.max(1, Math.floor(items.length / n)) === 0).slice(0, n);
    const speech = [
        ...pickEvery(manifest.filter((i) => i.kind === 'speech' && i.set === 'en-command' && ['S30', 'S40', 'N10'].includes(i.condition)), 240),
        ...pickEvery(manifest.filter((i) => i.kind === 'speech' && i.set === 'ar-command' && ['S30', 'S40', 'N10'].includes(i.condition)), 240),
        ...pickEvery(manifest.filter((i) => i.kind === 'speech' && i.set === 'en-sentence' && ['S30', 'S40', 'N10'].includes(i.condition)), 90),
    ];
    const noise = pickEvery(manifest.filter((i) => i.kind === 'noise' && i.label === 'nonspeech' && i.condition === '-35'), 60);
    const paths: Record<string, (pcm: Int16Array) => PathAudio> = {
        'fixture as is (20 ms)': (pcm) => ({ pcm, frameSamples: 320 }),
        'peer lane: Opus 32 kbps + worker resampler (20 ms)': (pcm) => peerLanePath(pcm, 32000),
        'room: Opus 32 kbps + other resampler (10 ms)': (pcm) => roomPath(pcm, 32000),
        'peer lane: Opus 16 kbps (weak network)': (pcm) => peerLanePath(pcm, 16000),
    };
    const pct = (xs: number[], p: number): number => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN);
    const rows: (string | number)[][] = [];
    const verdicts: Record<string, Map<string, boolean>> = {};
    for (const [name, through] of Object.entries(paths)) {
        const stats = { silero: { caught: 0, lat: [] as number[], stops: 0 }, gate: { caught: 0, lat: [] as number[], stops: 0 } };
        verdicts[name] = new Map();
        for (const item of speech) {
            const built = item.build();
            const audio = through(built.pcm);
            const inWindow = (t: number): boolean => t >= LEAD - 0.05 && t <= built.offset! + 0.6;
            const s = applyRule(await probsIn(audio.pcm, () => audio.frameSamples), rule, PROVIDER_PAUSE_MS).find(inWindow);
            const g = runGate(audio.pcm, 100, audio.frameSamples).triggers.find(inWindow);
            verdicts[name].set(item.id, s !== undefined);
            if (s !== undefined) {
                stats.silero.caught++;
                stats.silero.lat.push(Math.max(0, s - built.onset!) * 1000);
            }
            if (g !== undefined) {
                stats.gate.caught++;
                stats.gate.lat.push(Math.max(0, g - built.onset!) * 1000);
            }
        }
        let seconds = 0;
        for (const item of noise) {
            const audio = through(item.build().pcm);
            seconds += audio.pcm.length / 16000;
            stats.silero.stops += applyRule(await probsIn(audio.pcm, () => audio.frameSamples), rule, PROVIDER_PAUSE_MS).length;
            stats.gate.stops += runGate(audio.pcm, 100, audio.frameSamples).triggers.length;
        }
        for (const [det, st] of [[rule.name, stats.silero], ['gate 100 ms', stats.gate]] as const) {
            rows.push([name, det, `${st.caught}/${speech.length}`, Math.round(pct(st.lat, 0.5)), Math.round(pct(st.lat, 0.95)), `${st.stops} in ${(seconds / 3600).toFixed(2)} h`]);
        }
        console.error(`path done: ${name}`);
    }
    md.push('## Same clips through each path', '', `${speech.length} speech clips (English and Arabic commands, English sentences; soft, very soft, and in noise) and ${noise.length} minutes of non-speech noise at -35 dBFS, all from the report half.`, '');
    md.push('| path | detector | fired for the person | delay p50 ms | p95 | false stops on the noise |', '| --- | --- | --- | --- | --- | --- |', ...rows.map((r) => '| ' + r.join(' | ') + ' |'), '');
    const names = Object.keys(paths);
    const base = verdicts[names[0]];
    md.push('Clips where the picked rule gives a different answer than on the plain fixture:', '');
    for (const name of names.slice(1)) {
        let lost = 0;
        let gained = 0;
        for (const [id, v] of base) {
            if (v && !verdicts[name].get(id)) lost++;
            if (!v && verdicts[name].get(id)) gained++;
        }
        md.push(`- ${name}: ${lost} no longer caught, ${gained} newly caught, of ${base.size}.`);
    }
    md.push('');
}
writeFileSync(join(out, 'parity.md'), md.join('\n'));
console.log(md.join('\n'));
