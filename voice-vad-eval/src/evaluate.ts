// One pass over the fixtures: today's gate (three timer settings, 20 ms frames as a peer lane delivers them) and the
// Silero probabilities for every clip. Writes raw per-clip outcomes; report.ts turns them into the tables.
//   tsx src/evaluate.ts <data dir> <out dir> <shard> <shards> [native|wasm]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, LEAD } from './fixtures.ts';
import { runGate, type GateResult } from './gate.ts';
import { SileroModel, type Runtime } from './silero.ts';

const [data, out, shardArg, shardsArg, runtimeArg] = process.argv.slice(2);
const shard = Number(shardArg ?? 0);
const shards = Number(shardsArg ?? 1);
const runtime = (runtimeArg ?? 'native') as Runtime;
mkdirSync(out, { recursive: true });

const model = await SileroModel.load(join(data, 'silero_vad_v6.2.3.onnx'), runtime);
const manifest = buildManifest(data);
const lines: string[] = [];
let done = 0;
const started = Date.now();
for (let index = 0; index < manifest.length; index++) {
    if (index % shards !== shard) continue;
    const item = manifest[index];
    const built = item.build();
    const gate: Record<string, GateResult> = {};
    for (const ms of [100, 200, 300]) gate[`gate ${ms} ms`] = runGate(built.pcm, ms, 320);
    const probs = await model.stream().push(built.pcm);
    lines.push(
        JSON.stringify({
            id: item.id,
            kind: item.kind,
            set: item.set,
            label: item.label,
            condition: item.condition,
            split: item.split,
            seconds: built.pcm.length / 16000,
            clipStart: item.kind === 'speech' ? LEAD : undefined,
            onset: built.onset,
            offset: built.offset,
            level: Math.round(built.level * 10) / 10,
            gate,
            probs: Buffer.from(Uint8Array.from(probs, (p) => Math.round(p * 255))).toString('base64'),
        })
    );
    if (++done % 200 === 0) console.error(`shard ${shard}: ${done} clips, ${Math.round((Date.now() - started) / 1000)} s`);
}
writeFileSync(join(out, `raw-${shard}.jsonl`), lines.join('\n') + '\n');
console.error(`shard ${shard}: ${done} clips done in ${Math.round((Date.now() - started) / 1000)} s`);
