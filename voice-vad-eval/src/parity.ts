// Does the detector behave the same on both ways audio reaches the worker? SIMULATED: no real peer connection and no
// real LiveKit room is used here, and nothing here tests a weak network (no loss, jitter, silence suppression, reconnects).
//  1. Frame size: the same samples cut as a peer lane cuts them (20 ms), as a LiveKit room does (10 ms), and at odd
//     sizes must give exactly the same Silero probabilities (the FIFO re-chunks them). This part is exact.
//  2. Codec and resampler: a fixed subset of the report half is sent through a reconstruction of each path (see
//     paths.ts) and scored for today's gate and for the frozen rule ON THAT PATH, with the scoring of scoring.ts.
//   tsx src/parity.ts <data dir> <out dir> "<rule name>"
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, LEAD, type Item } from './fixtures.ts';
import { PROVIDER_PAUSE_MS, runGate } from './gate.ts';
import { peerLanePath, roomPath, type PathAudio } from './paths.ts';
import { applyRule, RULES } from './rules.ts';
import { percentile, scoreSpeech } from './scoring.ts';
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

const md: string[] = ['# Both paths: proximity WebRTC (peer lane) and LiveKit room', '', 'Status: **partial, simulated**. Frame-size sameness is exact. The codec and resampler part is a reconstruction; the real transports, packet loss, jitter and reconnects are not exercised here.', ''];

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
        'room: Opus 32 kbps + stand-in resampler (10 ms)': (pcm) => roomPath(pcm, 32000),
        'peer lane: Opus 16 kbps (low bitrate only)': (pcm) => peerLanePath(pcm, 16000),
    };
    const rows: (string | number)[][] = [];
    const valid: Record<string, Map<string, boolean>> = {};
    const notes: string[] = [];
    for (const [name, through] of Object.entries(paths)) {
        const stats = { silero: { valid: 0, early: 0, lat: [] as number[], stops: 0 }, gate: { valid: 0, early: 0, lat: [] as number[], stops: 0 } };
        const newlyMissed: string[] = [];
        valid[name] = new Map();
        for (const item of speech) {
            const built = item.build();
            const audio = through(built.pcm);
            const s = scoreSpeech(applyRule(await probsIn(audio.pcm, () => audio.frameSamples), rule, PROVIDER_PAUSE_MS), LEAD, built.onset!, built.offset!);
            const g = scoreSpeech(runGate(audio.pcm, 100, audio.frameSamples).triggers, LEAD, built.onset!, built.offset!);
            valid[name].set(item.id, s.outcome === 'valid');
            for (const [st, sc] of [[stats.silero, s], [stats.gate, g]] as const) {
                if (sc.outcome === 'valid') {
                    st.valid++;
                    st.lat.push(sc.delay! * 1000);
                } else if (sc.outcome === 'early') st.early++;
            }
            if (g.outcome === 'valid' && s.outcome !== 'valid') newlyMissed.push(item.id);
        }
        let seconds = 0;
        for (const item of noise) {
            const audio = through(item.build().pcm);
            seconds += audio.pcm.length / 16000;
            stats.silero.stops += applyRule(await probsIn(audio.pcm, () => audio.frameSamples), rule, PROVIDER_PAUSE_MS).length;
            stats.gate.stops += runGate(audio.pcm, 100, audio.frameSamples).triggers.length;
        }
        for (const [det, st] of [[rule.name, stats.silero], ['gate 100 ms', stats.gate]] as const) {
            rows.push([name, det, `${st.valid}/${speech.length}`, st.early, det === rule.name ? newlyMissed.length : '', Math.round(percentile(st.lat, 0.5)), Math.round(percentile(st.lat, 0.95)), `${st.stops} in ${(seconds / 60).toFixed(1)} min`]);
        }
        notes.push(`- ${name}: newly missed on this path (gate VALID, rule not VALID): ${newlyMissed.length ? newlyMissed.map((id) => '`' + id + '`').join(', ') : 'none'}.`);
        console.error(`path done: ${name}`);
    }
    md.push('## Same clips through each path', '', `${speech.length} speech clips (English and Arabic commands, English sentences; soft, very soft, and in noise) and ${noise.length} non-speech noise recordings at -35 dBFS, all from the report half. Delays include the codec's own delay, which the estimated onset does not.`, '');
    md.push('| path | detector | VALID | EARLY only | newly missed on this path | delay p50 ms | p95 | firings on the noise |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows.map((r) => '| ' + r.join(' | ') + ' |'), '');
    md.push(...notes, '');
    const names = Object.keys(paths);
    const base = valid[names[0]];
    md.push('Clips where the frozen rule answers differently than on the plain fixture:', '');
    for (const name of names.slice(1)) {
        const lost: string[] = [];
        const gained: string[] = [];
        for (const [id, v] of base) {
            if (v && !valid[name].get(id)) lost.push(id);
            if (!v && valid[name].get(id)) gained.push(id);
        }
        md.push(`- ${name}: ${lost.length} no longer VALID${lost.length ? ' (' + lost.map((id) => '`' + id + '`').join(', ') + ')' : ''}, ${gained.length} newly VALID${gained.length ? ' (' + gained.map((id) => '`' + id + '`').join(', ') + ')' : ''}, of ${base.size}.`);
    }
    md.push('');
}
writeFileSync(join(out, 'parity.md'), md.join('\n'));
console.log(md.join('\n'));
