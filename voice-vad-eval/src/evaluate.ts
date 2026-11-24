// One pass over the fixtures: today's gate (three timer settings, 20 ms frames as a peer lane delivers them) and the
// Silero probabilities for every clip. Writes raw per-clip outcomes; report.ts turns them into the tables.
//   tsx src/evaluate.ts <data dir> <out dir> <shard> <shards> [native|wasm]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, LEAD } from './fixtures.ts';
import { runGate, type GateResult } from './gate.ts';
import { SileroModel, type Runtime } from './silero.ts';
import { sourceSha } from './sources.ts';

const [data, out, shardArg, shardsArg, runtimeArg] = process.argv.slice(2);
const shard = Number(shardArg ?? 0);
const shards = Number(shardsArg ?? 1);
// A type assertion checks nothing at run time: a misspelt runtime would load the wasm one and be written down as it was spelt
if (runtimeArg !== undefined && runtimeArg !== 'native' && runtimeArg !== 'wasm') throw new Error(`runtime must be "native" or "wasm", got "${runtimeArg}"`);
const runtime: Runtime = runtimeArg ?? 'native';
if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(shard) || shard < 0 || shard >= shards) throw new Error(`shard ${shardArg} of ${shardsArg} is not a shard`);
mkdirSync(out, { recursive: true });
// The marker of an earlier run of this shard goes first: a run that fails before it is written must not leave the old one saying
// the shard is done
rmSync(join(out, `done-${shard}.json`), { force: true });

const model = await SileroModel.load(join(data, 'silero_vad_v6.2.3.onnx'), runtime);
const manifest = buildManifest(data);
const lines: string[] = [];
let done = 0;
const started = Date.now();
// What each source recording was when it was scored: the report takes it from here and refuses a source that changed since
const shaBySource = new Map<string, string>();
function shaOfSource(source: string): string {
    let sha = shaBySource.get(source);
    if (sha === undefined) shaBySource.set(source, (sha = sourceSha(data, source)));
    return sha;
}
for (let index = 0; index < manifest.length; index++) {
    if (index % shards !== shard) continue;
    const item = manifest[index];
    // Every recording the clip is made from is hashed before anything of it is read (a speech clip mixed with noise reads a noise recording
    // too), so each hash is of what the clip was built from
    const sha = shaOfSource(item.source);
    const needs = item.inputs?.() ?? [];
    const inputs: Record<string, string> = {};
    for (const key of needs) inputs[key] = shaOfSource(key);
    const built = item.build();
    // What was read is what was hashed: a build that read another recording than the manifest names would be scored on unrecorded audio
    if ((built.inputs ?? []).join('|') !== needs.join('|')) throw new Error(`${item.id} was built from ${(built.inputs ?? []).join(', ') || 'no other recording'}, but its manifest names ${needs.join(', ') || 'none'}`);
    const gate: Record<string, GateResult> = {};
    for (const ms of [100, 200, 300]) gate[`gate ${ms} ms`] = runGate(built.pcm, ms, 320);
    // The provider-partial route: a provider that hears words in whatever it is sent
    gate['gate 100 ms, provider hears words'] = runGate(built.pcm, 100, 320, 'words');
    const probs = await model.stream().push(built.pcm);
    lines.push(
        JSON.stringify({
            id: item.id,
            kind: item.kind,
            set: item.set,
            label: item.label,
            condition: item.condition,
            split: item.split,
            source: item.source,
            sourceSha: sha,
            inputs,
            speaker: item.speaker,
            seconds: built.pcm.length / 16000,
            clipStart: item.kind === 'speech' ? LEAD : undefined,
            onset: built.onset,
            offset: built.offset,
            level: Math.round(built.level * 10) / 10,
            gate,
            // Full precision: the same numbers every report and every path check works from
            probs: Buffer.from(Float32Array.from(probs).buffer).toString('base64'),
        })
    );
    if (++done % 200 === 0) console.error(`shard ${shard}: ${done} clips, ${Math.round((Date.now() - started) / 1000)} s`);
}
// A recording that was replaced while this ran is not what its clips were scored from: nothing is written, and the shard did not finish
for (const [source, sha] of shaBySource) {
    const now = sourceSha(data, source);
    if (now !== sha) throw new Error(`the source ${source} changed while it was being scored (${sha} then, ${now} now): run the evaluation again`);
}
writeFileSync(join(out, `raw-${shard}.jsonl`), lines.join('\n') + '\n');
// Written last: a shard without this did not finish
writeFileSync(join(out, `done-${shard}.json`), JSON.stringify({ shard, shards, clips: done, runtime }));
console.error(`shard ${shard}: ${done} clips done in ${Math.round((Date.now() - started) / 1000)} s`);
