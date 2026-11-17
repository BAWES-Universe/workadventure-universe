import { readFileSync } from 'node:fs';

/** Reads a 16 kHz mono 16-bit PCM WAV. Anything else is refused: fixtures are never silently resampled. */
export function readWav16k(path: string): Int16Array {
    const b = readFileSync(path);
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`not a WAV: ${path}`);
    let at = 12;
    let rate = 0;
    let channels = 0;
    let bits = 0;
    let format = 0;
    while (at + 8 <= b.length) {
        const id = b.toString('ascii', at, at + 4);
        const size = b.readUInt32LE(at + 4);
        if (id === 'fmt ') {
            format = b.readUInt16LE(at + 8);
            channels = b.readUInt16LE(at + 10);
            rate = b.readUInt32LE(at + 12);
            bits = b.readUInt16LE(at + 22);
        } else if (id === 'data') {
            if (rate !== 16000 || channels !== 1 || bits !== 16 || (format !== 1 && format !== 0xfffe)) throw new Error(`need 16 kHz mono 16-bit PCM: ${path} (${rate} Hz, ${channels} ch, ${bits} bit)`);
            const n = Math.floor(Math.min(size, b.length - at - 8) / 2);
            const out = new Int16Array(n);
            for (let i = 0; i < n; i++) out[i] = b.readInt16LE(at + 8 + i * 2);
            return out;
        }
        at += 8 + size + (size % 2);
    }
    throw new Error(`no data chunk: ${path}`);
}
