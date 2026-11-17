// Silero probabilities (one per 32 ms window) for the audio as the real-provider run played it, in the same form as
// results/raw.jsonl.gz, so the replay's detector answers from the audio that was actually sent.
//   tsx src/played-probs.ts <data dir> <soniox-record.jsonl> <out raw.jsonl.gz>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildManifest } from './fixtures.ts';
import { audioOf } from './played.ts';
import { SileroModel } from './silero.ts';

const [data, recordPath, outPath] = process.argv.slice(2);
if (!data || !recordPath || !outPath) throw new Error('usage: played-probs.ts <data dir> <soniox-record.jsonl> <out raw.jsonl.gz>');
const ids = new Set(readFileSync(recordPath, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { id: string }).id));
const items = buildManifest(data).filter((i) => ids.has(i.id));
const model = await SileroModel.load(join(data, 'silero_vad_v6.2.3.onnx'), 'native');
const lines: string[] = [];
for (const item of items) {
    const probs = await model.stream().push(audioOf(item).pcm);
    lines.push(JSON.stringify({ id: item.id, probs: Buffer.from(Float32Array.from(probs).buffer).toString('base64') }));
}
writeFileSync(outPath, gzipSync(lines.join('\n') + '\n'));
console.error(`${lines.length} clips -> ${outPath}`);
