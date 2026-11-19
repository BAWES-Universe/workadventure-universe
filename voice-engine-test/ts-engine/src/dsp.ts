// Streaming resamplers (windowed-sinc FIR, Kaiser window). 48 kHz -> 16 kHz for the mic, 24 kHz -> 48 kHz for bot speech.

function bessel0(x: number) { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; }
function kaiserSinc(taps: number, cutoffNorm: number, beta: number): Float32Array {
  // cutoffNorm: cutoff as a fraction of the sample rate (0..0.5)
  const h = new Float32Array(taps); const m = (taps - 1) / 2; let sum = 0;
  for (let n = 0; n < taps; n++) {
    const x = n - m; const sinc = x === 0 ? 2 * cutoffNorm : Math.sin(2 * Math.PI * cutoffNorm * x) / (Math.PI * x);
    const w = bessel0(beta * Math.sqrt(1 - ((2 * n) / (taps - 1) - 1) ** 2)) / bessel0(beta);
    h[n] = sinc * w; sum += h[n];
  }
  for (let n = 0; n < taps; n++) h[n] /= sum; // unity DC gain
  return h;
}

/** 48 kHz -> 16 kHz. Input length must be a multiple of 3 per call (we feed 960 -> 320). */
export class Down3 {
  private h = kaiserSinc(96, 7200 / 48000, 8.0); private hist = new Float32Array(95);
  process(x: Int16Array): Int16Array {
    const T = this.h.length, n = x.length, out = new Int16Array(Math.floor(n / 3));
    const buf = new Float32Array(this.hist.length + n); buf.set(this.hist); for (let i = 0; i < n; i++) buf[this.hist.length + i] = x[i];
    for (let o = 0; o < out.length; o++) {
      const base = o * 3; let acc = 0;
      for (let k = 0; k < T; k++) acc += this.h[k] * buf[base + T - 1 - k];
      out[o] = acc > 32767 ? 32767 : acc < -32768 ? -32768 : Math.round(acc);
    }
    this.hist.set(buf.subarray(buf.length - this.hist.length));
    return out;
  }
}

/** 24 kHz -> 48 kHz via polyphase interpolation (gain 2). */
export class Up2 {
  private h = kaiserSinc(64, 11000 / 48000, 8.0); private hist = new Float32Array(31);
  constructor() { for (let i = 0; i < this.h.length; i++) this.h[i] *= 2; }
  process(x: Int16Array): Int16Array {
    const n = x.length, out = new Int16Array(n * 2), P = this.h.length / 2;
    const buf = new Float32Array(this.hist.length + n); buf.set(this.hist); for (let i = 0; i < n; i++) buf[this.hist.length + i] = x[i];
    for (let i = 0; i < n; i++) {
      let a = 0, b = 0;
      for (let k = 0; k < P; k++) { const v = buf[this.hist.length + i - k]; a += this.h[2 * k] * v; b += this.h[2 * k + 1] * v; }
      out[2 * i] = Math.max(-32768, Math.min(32767, Math.round(a))); out[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(b)));
    }
    this.hist.set(buf.subarray(buf.length - this.hist.length));
    return out;
  }
}
