// Small shared helpers for the TypeScript parts of the harness (loadgen, runner, ts-engine).
import { readFileSync } from 'node:fs';
import { Encoder, Decoder } from '@evan/opus';

export const ROOT = new URL('..', import.meta.url).pathname;
/** Epoch milliseconds with sub-ms precision. Same clock basis as Python time.time()*1000 on this host. */
export const now = () => performance.timeOrigin + performance.now();
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Wav { rate: number; channels: number; pcm: Int16Array }
export function readWav(path: string): Wav {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a wav: ${path}`);
  let off = 12, rate = 0, channels = 0, bits = 0, data: Buffer | undefined;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = b.readUInt16LE(off + 10); rate = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size & 1);
  }
  if (!data || bits !== 16) throw new Error(`need 16-bit pcm wav: ${path}`);
  const copy = Buffer.from(data); // aligned copy
  return { rate, channels, pcm: new Int16Array(copy.buffer, copy.byteOffset, copy.length >> 1) };
}

export interface ClipInfo { speechStartMs: number; speechEndMs: number; file: string; lang: string; durationMs: number; sha256: string; transcript: string; note: string }
export const manifest = (): { clips: Record<string, ClipInfo>; botVoice: any } => JSON.parse(readFileSync(ROOT + 'clips/manifest.json', 'utf8'));

/** Linear 16 kHz -> 48 kHz (x3). Good enough for test clips; the engine's own resampler is what we test. */
export function up3(pcm: Int16Array): Int16Array {
  const out = new Int16Array(pcm.length * 3);
  for (let i = 0; i < pcm.length; i++) {
    const a = pcm[i], b = i + 1 < pcm.length ? pcm[i + 1] : a;
    out[3 * i] = a; out[3 * i + 1] = a + (b - a) / 3; out[3 * i + 2] = a + ((b - a) * 2) / 3;
  }
  return out;
}

export function newOpusEncoder(bitrate = 32000) {
  const e = new Encoder({ channels: 1, sample_rate: 48000, application: 'voip' });
  e.bitrate = bitrate;
  return e;
}
export const newOpusDecoder = () => new Decoder({ channels: 1, sample_rate: 48000 });
export const asInt16 = (u8: Uint8Array) => new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);

/** Pre-encodes 16 kHz pcm to a list of 20 ms Opus packets. Pads the tail to a whole frame with silence. */
export function opusPackets(pcm16k: Int16Array, bitrate = 32000): Buffer[] {
  const p48 = up3(pcm16k); const enc = newOpusEncoder(bitrate); const out: Buffer[] = [];
  const frame = new Int16Array(960);
  for (let i = 0; i < p48.length; i += 960) { frame.fill(0); frame.set(p48.subarray(i, Math.min(i + 960, p48.length))); out.push(Buffer.from(enc.encode(frame))); }
  return out;
}

export const rms = (x: Int16Array) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };
export function pct(sorted: number[], p: number) { if (!sorted.length) return NaN; const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)); return sorted[i]; }
export function summarize(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b); const n = s.length; const mean = n ? s.reduce((a, b) => a + b, 0) / n : NaN;
  return { n, mean, p50: pct(s, 50), p95: pct(s, 95), min: s[0] ?? NaN, max: s[n - 1] ?? NaN };
}
/** Seeded PRNG (mulberry32) so loss patterns and schedules repeat. */
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
