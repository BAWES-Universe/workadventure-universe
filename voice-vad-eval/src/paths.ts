// The two ways a person's microphone reaches the worker, rebuilt offline from the same 16 kHz fixture.
//   peer lane (proximity WebRTC): Opus packets of 20 ms -> the worker's own decoder and its own 48->16 kHz resampler
//                                 (lane.ts does exactly this) -> 320-sample frames.
//   room (LiveKit):               Opus as well (the browser publishes Opus), decoded and resampled to 16 kHz by LiveKit's
//                                 native library, which hands over 10 ms frames. That resampler cannot be run here, so a
//                                 different, plain one stands in for it: the point is that the detector must not depend on
//                                 which resampler or frame size it gets.
import { Down3 } from '../../voice-worker/src/dsp.ts';
import { Decoder, Encoder } from '@evan/opus';

// The same three lines as the worker's opus.ts (which resolves the package from the worker's own install)
function newOpusEncoder(bitrate: number): Encoder {
    const encoder = new Encoder({ channels: 1, sample_rate: 48000, application: 'voip' });
    encoder.bitrate = bitrate;
    return encoder;
}
const newOpusDecoder = (): Decoder => new Decoder({ channels: 1, sample_rate: 48000 });
const asInt16 = (u8: Uint8Array): Int16Array => new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength >> 1);

function sincLowpass(taps: number, cutoffNorm: number): Float32Array {
    const h = new Float32Array(taps);
    const m = (taps - 1) / 2;
    let sum = 0;
    for (let n = 0; n < taps; n++) {
        const x = n - m;
        const sinc = x === 0 ? 2 * cutoffNorm : Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x);
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)); // Hann
        h[n] = sinc * w;
        sum += h[n];
    }
    for (let n = 0; n < taps; n++) h[n] /= sum;
    return h;
}
const clamp16 = (v: number): number => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));

/** 16 kHz -> 48 kHz, what a browser's capture would have been before it encodes. */
export function up3(x: Int16Array): Int16Array {
    const h = sincLowpass(145, 7600 / 48000);
    const out = new Int16Array(x.length * 3);
    const half = (h.length - 1) / 2;
    for (let o = 0; o < out.length; o++) {
        let acc = 0;
        // Only every third tap meets a real sample (zero stuffing), so the gain is 3
        for (let k = (o + half) % 3; k < h.length; k += 3) {
            const i = (o + half - k) / 3;
            if (i >= 0 && i < x.length) acc += h[k] * x[i];
        }
        out[o] = clamp16(3 * acc);
    }
    return out;
}

/** 48 kHz -> 16 kHz with a plain Hann filter: not the worker's resampler, on purpose. */
function down3Plain(x: Int16Array): Int16Array {
    const h = sincLowpass(73, 7000 / 48000);
    const half = (h.length - 1) / 2;
    const out = new Int16Array(Math.floor(x.length / 3));
    for (let o = 0; o < out.length; o++) {
        let acc = 0;
        for (let k = 0; k < h.length; k++) {
            const i = o * 3 + k - half;
            if (i >= 0 && i < x.length) acc += h[k] * x[i];
        }
        out[o] = clamp16(acc);
    }
    return out;
}

/** Through Opus at the given bitrate, back to 48 kHz. */
function throughOpus(pcm48: Int16Array, bitrate: number): Int16Array[] {
    const encoder = newOpusEncoder(bitrate);
    const decoder = newOpusDecoder();
    const frames: Int16Array[] = [];
    for (let at = 0; at + 960 <= pcm48.length; at += 960) {
        const packet = encoder.encode(pcm48.subarray(at, at + 960));
        frames.push(asInt16(decoder.decode(packet)).slice());
    }
    return frames;
}

export interface PathAudio {
    pcm: Int16Array;
    frameSamples: number;
}

export function peerLanePath(pcm16k: Int16Array, bitrate = 32000): PathAudio {
    const down = new Down3();
    const parts = throughOpus(up3(pcm16k), bitrate).map((f) => down.process(f));
    const pcm = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        pcm.set(p, at);
        at += p.length;
    }
    return { pcm, frameSamples: 320 };
}

export function roomPath(pcm16k: Int16Array, bitrate = 32000): PathAudio {
    const frames = throughOpus(up3(pcm16k), bitrate);
    const pcm48 = new Int16Array(frames.length * 960);
    frames.forEach((f, i) => pcm48.set(f, i * 960));
    return { pcm: down3Plain(pcm48), frameSamples: 160 };
}
