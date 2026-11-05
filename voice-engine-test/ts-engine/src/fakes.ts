// Fake STT and fake TTS. Same behaviour as the Python engine's fakes (pipecat-engine/engine/fakes.py, util.py).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROOT, manifest, readWav } from '../../common/util.ts';

export const FRAME_MS = 20, TTS_RATE = 24000, MS_PER_CHAR = 65;
/** Chunk bytes = rate x channels x bytes per sample x duration. 24 kHz mono s16 x 20 ms = 960. Never 1920. */
export const frameBytes = (rate: number, ch: number, width: number, ms: number) => Math.round((rate * ch * width * ms) / 1000);

export class FakeTts {
  private pcm: Buffer; readonly chunk = frameBytes(TTS_RATE, 1, 2, FRAME_MS);
  constructor() {
    const m = manifest().botVoice; const p = ROOT + 'clips/' + m.file;
    if (createHash('sha256').update(readFileSync(p)).digest('hex') !== m.sha256) throw new Error('bot voice checksum mismatch');
    const w = readWav(p); if (w.rate !== TTS_RATE || w.channels !== 1) throw new Error('bot voice must be 24 kHz mono');
    this.pcm = Buffer.from(w.pcm.buffer, w.pcm.byteOffset, w.pcm.byteLength);
  }
  durationMs(text: string) { return Math.max(400, Math.round((MS_PER_CHAR * [...text].length) / FRAME_MS) * FRAME_MS); } // [...text] = code points, like Python len()
  synth(text: string): Buffer {
    const n = (this.durationMs(text) / FRAME_MS) * this.chunk;
    const h = parseInt(createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 8), 16);
    const start = (h % (this.pcm.length / 2)) * 2;
    const parts: Buffer[] = [this.pcm.subarray(start), this.pcm]; let len = this.pcm.length - start + this.pcm.length;
    while (len < n) { parts.push(this.pcm); len += this.pcm.length; }
    return Buffer.concat(parts).subarray(0, n);
  }
}

const M = manifest().clips as Record<string, { transcript: string; durationMs: number }>;
export function clipInfo(hint?: { clipId: string; text?: string }): { text: string; durationMs: number } {
  if (!hint) return { text: '[no clip hint]', durationMs: 3000 };
  const c = M[hint.clipId]; return { text: hint.text ?? c?.transcript ?? '[unknown clip]', durationMs: c?.durationMs ?? 3000 };
}
