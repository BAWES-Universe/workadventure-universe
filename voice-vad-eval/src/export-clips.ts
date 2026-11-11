// Writes chosen test clips as WAV files, exactly as the detectors were given them, so something other than the detectors
// can be asked what is in them (scripts/adjudicate.py).
//   tsx src/export-clips.ts <data dir> <wav dir> <list.tsv>      list: id [from seconds] [to seconds]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest, RATE } from './fixtures.ts';

const [data, dir, list] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const items = new Map(buildManifest(data).map((m) => [m.id, m]));
const index: string[] = ['file\tid\tfrom\tto'];
let n = 0;
for (const line of readFileSync(list, 'utf8').split('\n')) {
    if (!line) continue;
    const [id, from, to] = line.split('\t');
    const item = items.get(id);
    if (!item) throw new Error(`no such clip: ${id}`);
    const pcm = item.build().pcm;
    const a = Math.max(0, Math.round(Number(from ?? 0) * RATE));
    const b = Math.min(pcm.length, to ? Math.round(Number(to) * RATE) : pcm.length);
    const part = pcm.subarray(a, b);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + part.length * 2, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(part.length * 2, 40);
    const file = `${String(++n).padStart(4, '0')}.wav`;
    writeFileSync(join(dir, file), Buffer.concat([header, Buffer.from(part.buffer, part.byteOffset, part.length * 2)]));
    index.push(`${file}\t${id}\t${(a / RATE).toFixed(2)}\t${(b / RATE).toFixed(2)}`);
}
writeFileSync(join(dir, 'index.tsv'), index.join('\n') + '\n');
console.error(`${n} clips written`);
