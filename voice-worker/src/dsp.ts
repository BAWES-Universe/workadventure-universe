// Streaming resamplers (windowed-sinc FIR, Kaiser window). 48 kHz -> 16 kHz for the microphone, 24 kHz -> 48 kHz for bot speech.

function bessel0(x: number): number {
    let s = 1;
    let t = 1;
    for (let k = 1; k < 40; k++) {
        t *= (x / (2 * k)) ** 2;
        s += t;
    }
    return s;
}

/** cutoffNorm: cutoff as a fraction of the sample rate (0..0.5). Unity gain at DC. */
function kaiserSinc(taps: number, cutoffNorm: number, beta: number): Float32Array {
    const h = new Float32Array(taps);
    const m = (taps - 1) / 2;
    let sum = 0;
    for (let n = 0; n < taps; n++) {
        const x = n - m;
        const sinc = x === 0 ? 2 * cutoffNorm : Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x);
        const w = bessel0(beta * Math.sqrt(1 - ((2 * n) / (taps - 1) - 1) ** 2)) / bessel0(beta);
        h[n] = sinc * w;
        sum += h[n];
    }
    for (let n = 0; n < taps; n++) h[n] /= sum;
    return h;
}

const clamp16 = (v: number): number => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));

/** 48 kHz -> 16 kHz. The input length must be a multiple of 3 per call (a 20 ms frame is 960 samples, giving 320). */
export class Down3 {
    private readonly h = kaiserSinc(96, 7200 / 48000, 8.0);
    private readonly hist = new Float32Array(95);

    process(x: Int16Array): Int16Array {
        const taps = this.h.length;
        const out = new Int16Array(Math.floor(x.length / 3));
        const buf = new Float32Array(this.hist.length + x.length);
        buf.set(this.hist);
        for (let i = 0; i < x.length; i++) buf[this.hist.length + i] = x[i];
        for (let o = 0; o < out.length; o++) {
            const base = o * 3;
            let acc = 0;
            for (let k = 0; k < taps; k++) acc += this.h[k] * buf[base + taps - 1 - k];
            out[o] = clamp16(acc);
        }
        this.hist.set(buf.subarray(buf.length - this.hist.length));
        return out;
    }
}

/** 24 kHz -> 48 kHz by polyphase interpolation (gain 2). */
export class Up2 {
    private readonly h: Float32Array;
    private readonly hist = new Float32Array(31);

    constructor() {
        this.h = kaiserSinc(64, 11000 / 48000, 8.0);
        for (let i = 0; i < this.h.length; i++) this.h[i] *= 2;
    }

    process(x: Int16Array): Int16Array {
        const n = x.length;
        const out = new Int16Array(n * 2);
        const phases = this.h.length / 2;
        const buf = new Float32Array(this.hist.length + n);
        buf.set(this.hist);
        for (let i = 0; i < n; i++) buf[this.hist.length + i] = x[i];
        for (let i = 0; i < n; i++) {
            let a = 0;
            let b = 0;
            for (let k = 0; k < phases; k++) {
                const v = buf[this.hist.length + i - k];
                a += this.h[2 * k] * v;
                b += this.h[2 * k + 1] * v;
            }
            out[2 * i] = clamp16(a);
            out[2 * i + 1] = clamp16(b);
        }
        this.hist.set(buf.subarray(buf.length - this.hist.length));
        return out;
    }
}
