// Runs every shard and fails loudly if any of them fails: a half-finished run must never reach a report.
//   tsx src/run-all.ts <data dir> <out dir> [shards]
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [data, out, shardsArg] = process.argv.slice(2);
const shards = Number(shardsArg ?? 4);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^(raw|done)-\d+\.(jsonl|json)$/.test(f)) rmSync(join(out, f));
const codes = await Promise.all(
    Array.from({ length: shards }, (_, i) => new Promise<number>((resolve) => spawn('node', ['--import', 'tsx', 'src/evaluate.ts', data, out, String(i), String(shards), 'native'], { stdio: 'inherit' }).on('exit', (code) => resolve(code ?? 1))))
);
if (codes.some((c) => c !== 0)) {
    console.error(`evaluation failed: shard exit codes ${codes.join(', ')}`);
    process.exit(1);
}
console.error('all shards finished');
