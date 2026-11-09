// Audio pieces every connector needs: turning a company's bytes into whole 16-bit samples, and bringing them to the
// worker's rates (24 kHz for speaking, 16 kHz for hearing) when a company only offers another one.

/** Joins two byte arrays. */
export function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
    if (first.length === 0) return second;
    if (second.length === 0) return first;
    const out = new Uint8Array(first.length + second.length);
    out.set(first);
    out.set(second, first.length);
    return out;
}

/** A WAV header is 44 bytes when it has no extra chunks, which is what most speech services send. */
export const WAV_HEADER_BYTES = 44;

/** A header with extra chunks (Resemble's timestamps) is read up to this size; past it, the plain 44 bytes are dropped. */
const MAX_WAV_HEADER_BYTES = 1024 * 1024;

/**
 * Where a WAV's samples start: after the header's chunks (fmt, and any cue, LIST or other chunk a company puts first), at the
 * "data" chunk. undefined while the header hasn't all come yet. A header whose chunks can't be read is taken as the plain 44 bytes.
 */
export function wavDataStart(head: Uint8Array): number | undefined {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let offset = 12;
    while (offset + 8 <= head.length) {
        const name = head.subarray(offset, offset + 4);
        if (!name.every((byte) => byte >= 0x20 && byte <= 0x7e)) return head.length >= WAV_HEADER_BYTES ? WAV_HEADER_BYTES : undefined;
        const id = String.fromCharCode(...name);
        if (id === 'data') return offset + 8;
        const size = view.getUint32(offset + 4, true);
        offset += 8 + size + (size % 2);
    }
    return undefined;
}

/**
 * Turns pieces of a little-endian s16 byte stream into whole samples. A piece can end half-way through a sample, so that
 * byte waits for the next piece. With `skipWavHeader`, a stream that starts with "RIFF" has its header dropped up to its
 * "data" chunk, even when the header arrives in pieces; a stream without one plays from its first byte.
 */
export class PcmReader {
    private carry?: Uint8Array;
    private head?: Uint8Array;

    constructor(options: { skipWavHeader?: boolean } = {}) {
        if (options.skipWavHeader) this.head = new Uint8Array(0);
    }

    take(piece: Uint8Array): Int16Array | undefined {
        let bytes = piece;
        if (this.head) {
            this.head = concatBytes(this.head, piece);
            if (this.head.length < 4) return undefined;
            const riff = this.head[0] === 0x52 && this.head[1] === 0x49 && this.head[2] === 0x46 && this.head[3] === 0x46;
            if (riff) {
                const start = wavDataStart(this.head) ?? (this.head.length >= MAX_WAV_HEADER_BYTES ? WAV_HEADER_BYTES : undefined);
                if (start === undefined) return undefined;
                bytes = this.head.subarray(start);
            } else bytes = this.head;
            this.head = undefined;
        }
        if (this.carry) {
            bytes = concatBytes(this.carry, bytes);
            this.carry = undefined;
        }
        const even = bytes.length - (bytes.length % 2);
        if (even < bytes.length) this.carry = bytes.slice(even);
        if (even === 0) return undefined;
        // Copied into an aligned buffer: Int16Array needs an even offset
        const samples = new Int16Array(even / 2);
        new Uint8Array(samples.buffer).set(bytes.subarray(0, even));
        return samples;
    }

    /** Bytes held back at the end of the stream: a short header-less stream still plays. */
    flush(): Int16Array | undefined {
        const rest = this.head ?? new Uint8Array(0);
        this.head = undefined;
        if (rest.length < 2) return undefined;
        return this.take(rest);
    }
}

/** Audio a company sends inside text: base64 (most) or hex (MiniMax). */
export function decodeAudioText(text: string, encoding: 'base64' | 'hex'): Uint8Array {
    if (encoding === 'hex') return new Uint8Array(Buffer.from(text, 'hex'));
    return new Uint8Array(Buffer.from(text, 'base64'));
}

/** Little-endian bytes of samples, without copying. */
export const pcmBytes = (samples: Int16Array): Buffer => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

const clamp16 = (v: number): number => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));

/**
 * A streaming resampler for any pair of rates: a windowed-sinc filter (Blackman window) evaluated at each output time,
 * with the cutoff at the lower of the two Nyquist rates so nothing folds back. Used when a company can't give the rate
 * the worker needs (Polly speaks at 16 kHz, some services at 22.05 or 44.1 kHz). Equal rates pass through untouched.
 */
export class Resampler {
    private readonly step: number;
    private readonly cutoff: number;
    private readonly half = 16;
    /** Input samples kept from earlier calls, with the time (in input samples) of the next output. */
    private hist = new Float32Array(0);
    private histStart = 0;
    private next = 0;

    constructor(readonly from: number, readonly to: number) {
        this.step = from / to;
        this.cutoff = Math.min(1, to / from) * 0.95;
    }

    process(x: Int16Array): Int16Array {
        if (this.from === this.to) return x;
        const buf = new Float32Array(this.hist.length + x.length);
        buf.set(this.hist);
        for (let i = 0; i < x.length; i++) buf[this.hist.length + i] = x[i];
        const end = this.histStart + buf.length;
        const out: number[] = [];
        // An output needs `half` input samples after it before it can be made
        while (this.next + this.half < end) {
            const t = this.next;
            const centre = Math.floor(t);
            let acc = 0;
            for (let k = centre - this.half + 1; k <= centre + this.half; k++) {
                const at = k - this.histStart;
                if (at < 0 || at >= buf.length) continue;
                const d = t - k;
                const sinc = d === 0 ? 1 : Math.sin(Math.PI * d * this.cutoff) / (Math.PI * d * this.cutoff);
                const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / this.half) + 0.08 * Math.cos((2 * Math.PI * d) / this.half);
                acc += buf[at] * sinc * w * this.cutoff;
            }
            out.push(clamp16(acc));
            this.next += this.step;
        }
        // Keep what the next outputs still reach back to
        const keepFrom = Math.max(this.histStart, Math.floor(this.next) - this.half);
        this.hist = buf.slice(keepFrom - this.histStart);
        this.histStart = keepFrom;
        return Int16Array.from(out);
    }
}

/** A mono 16-bit WAV file of these samples, for companies that take a file upload. */
export function wavFile(samples: Int16Array, sampleRate: number): Uint8Array {
    const data = pcmBytes(samples);
    const out = Buffer.alloc(WAV_HEADER_BYTES + data.length);
    out.write('RIFF', 0, 'ascii');
    out.writeUInt32LE(36 + data.length, 4);
    out.write('WAVE', 8, 'ascii');
    out.write('fmt ', 12, 'ascii');
    out.writeUInt32LE(16, 16);
    out.writeUInt16LE(1, 20);
    out.writeUInt16LE(1, 22);
    out.writeUInt32LE(sampleRate, 24);
    out.writeUInt32LE(sampleRate * 2, 28);
    out.writeUInt16LE(2, 32);
    out.writeUInt16LE(16, 34);
    out.write('data', 36, 'ascii');
    out.writeUInt32LE(data.length, 40);
    data.copy(out, WAV_HEADER_BYTES);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
