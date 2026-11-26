// Whisper-style log-mel features for Smart Turn v3. Port of pipecat/audio/turn/smart_turn/_whisper_features.py
// (itself vendored from transformers' WhisperFeatureExtractor, chunk_length=8). Parity against Python is tested in test/parity.ts.
const N_FFT = 400, HOP = 160, N_MELS = 80, SR = 16000, N_SAMPLES = SR * 8, N_BINS = N_FFT / 2 + 1, MEL_FLOOR = 1e-10, EPS = 1e-7;

const hz2mel = (f: number) => (f >= 1000 ? 15 + Math.log(f / 1000) * (27 / Math.log(6.4)) : (3 * f) / 200);
const mel2hz = (m: number) => (m >= 15 ? 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)) : (200 * m) / 3);

function buildMelFilters(): Float64Array { // [mel][bin], i.e. already transposed: 80 x 201
  const melMin = hz2mel(0), melMax = hz2mel(SR / 2);
  const filterFreqs = Array.from({ length: N_MELS + 2 }, (_, i) => mel2hz(melMin + ((melMax - melMin) * i) / (N_MELS + 1)));
  const fftFreqs = Array.from({ length: N_BINS }, (_, i) => ((SR / 2) * i) / (N_BINS - 1));
  const out = new Float64Array(N_MELS * N_BINS);
  for (let m = 0; m < N_MELS; m++) {
    const enorm = 2 / (filterFreqs[m + 2] - filterFreqs[m]);
    for (let b = 0; b < N_BINS; b++) {
      const down = -(filterFreqs[m] - fftFreqs[b]) / (filterFreqs[m + 1] - filterFreqs[m]);
      const up = (filterFreqs[m + 2] - fftFreqs[b]) / (filterFreqs[m + 2] - filterFreqs[m + 1]);
      out[m * N_BINS + b] = Math.max(0, Math.min(down, up)) * enorm;
    }
  }
  return out;
}
const MEL = buildMelFilters();
// periodic Hann: np.hanning(N+1)[:-1] = 0.5 - 0.5 cos(2 pi n / N)
const HANN = Float64Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));

// Mixed-radix complex FFT for N = 400 = 2^4 * 5^2 (recursive, out of place).
const FACTORS = [2, 2, 2, 2, 5, 5];
const TW_RE = Float64Array.from({ length: N_FFT }, (_, k) => Math.cos((-2 * Math.PI * k) / N_FFT));
const TW_IM = Float64Array.from({ length: N_FFT }, (_, k) => Math.sin((-2 * Math.PI * k) / N_FFT));
function fftRec(inRe: Float64Array, inIm: Float64Array, inOff: number, stride: number, outRe: Float64Array, outIm: Float64Array, outOff: number, n: number, fi: number) {
  if (n === 1) { outRe[outOff] = inRe[inOff]; outIm[outOff] = inIm[inOff]; return; }
  const p = FACTORS[fi], m = n / p;
  for (let r = 0; r < p; r++) fftRec(inRe, inIm, inOff + r * stride, stride * p, outRe, outIm, outOff + r * m, m, fi + 1);
  const twStep = N_FFT / n;
  const tr = new Float64Array(p), ti = new Float64Array(p);
  for (let k = 0; k < m; k++) {
    for (let r = 0; r < p; r++) { // twiddle sub-FFT r by W_n^{rk}
      const idx = (r * k * twStep) % N_FFT; const re = outRe[outOff + r * m + k], im = outIm[outOff + r * m + k];
      tr[r] = re * TW_RE[idx] - im * TW_IM[idx]; ti[r] = re * TW_IM[idx] + im * TW_RE[idx];
    }
    for (let q = 0; q < p; q++) { // radix-p butterfly: X[k + q m] = sum_r t[r] W_p^{rq}
      let sr = 0, si = 0;
      for (let r = 0; r < p; r++) { const idx = ((r * q * (N_FFT / p)) % N_FFT); sr += tr[r] * TW_RE[idx] - ti[r] * TW_IM[idx]; si += tr[r] * TW_IM[idx] + ti[r] * TW_RE[idx]; }
      outRe[outOff + k + q * m] = sr; outIm[outOff + k + q * m] = si;
    }
  }
}

/** numpy's pairwise float32 sum (loops_utils.h pairwise_sum_FLOAT), step by step in float32. */
function pairwiseSumF32(a: Float32Array, off: number, n: number): number {
  const f = Math.fround;
  if (n < 8) { let r = 0; for (let i = 0; i < n; i++) r = f(r + a[off + i]); return r; }
  if (n <= 128) {
    const r = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => a[off + j]); let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] = f(r[j] + a[off + i + j]);
    let res = f(f(f(r[0] + r[1]) + f(r[2] + r[3])) + f(f(r[4] + r[5]) + f(r[6] + r[7])));
    for (; i < n; i++) res = f(res + a[off + i]);
    return res;
  }
  let n2 = Math.floor(n / 2); n2 -= n2 % 8;
  return f(pairwiseSumF32(a, off, n2) + pairwiseSumF32(a, off + n2, n - n2));
}

export function logMel(audio: Float32Array): Float32Array {
  // 1. pad/truncate to 8 s (callers already pass exactly 8 s)
  const x = new Float32Array(N_SAMPLES); x.set(audio.length > N_SAMPLES ? audio.subarray(0, N_SAMPLES) : audio);
  // 2. zero-mean unit-variance normalisation. numpy does this in float32 with pairwise summation; emulate that exactly,
  //    because the Smart Turn model reacts to feature differences of 1e-5 (see test/parity.ts).
  const f = Math.fround; const N = N_SAMPLES;
  const mean = f(pairwiseSumF32(x, 0, N) / N);
  const sq = new Float32Array(N); for (let i = 0; i < N; i++) { const d = f(x[i] - mean); sq[i] = f(d * d); }
  const variance = f(pairwiseSumF32(sq, 0, N) / N);
  const den = f(Math.sqrt(f(variance + f(EPS))));
  const xn = new Float64Array(N); for (let i = 0; i < N; i++) xn[i] = f(f(x[i] - mean) / den);
  // 3. reflect-pad 200 each side, frame, window, FFT, power
  const pad = N_FFT / 2, padded = new Float64Array(N_SAMPLES + 2 * pad);
  padded.set(xn, pad); for (let i = 0; i < pad; i++) { padded[pad - 1 - i] = xn[i + 1]; padded[pad + N_SAMPLES + i] = xn[N_SAMPLES - 2 - i]; }
  const nFrames = 1 + Math.floor((padded.length - N_FFT) / HOP); // 801
  const power = new Float64Array(N_BINS * nFrames); // [bin][frame]
  const inRe = new Float64Array(N_FFT), inIm = new Float64Array(N_FFT), oRe = new Float64Array(N_FFT), oIm = new Float64Array(N_FFT);
  for (let f = 0; f < nFrames; f++) {
    for (let i = 0; i < N_FFT; i++) { inRe[i] = padded[f * HOP + i] * HANN[i]; inIm[i] = 0; }
    fftRec(inRe, inIm, 0, 1, oRe, oIm, 0, N_FFT, 0);
    for (let b = 0; b < N_BINS; b++) power[b * nFrames + f] = oRe[b] * oRe[b] + oIm[b] * oIm[b];
  }
  // 4. mel, log10, drop last frame, clamp to max-8, scale
  const nOut = nFrames - 1; const out = new Float32Array(N_MELS * nOut); const lg = new Float64Array(N_MELS * nOut); let mx = -Infinity;
  for (let m = 0; m < N_MELS; m++) for (let f = 0; f < nOut; f++) {
    let s = 0; for (let b = 0; b < N_BINS; b++) s += MEL[m * N_BINS + b] * power[b * nFrames + f];
    const l = Math.log10(Math.max(MEL_FLOOR, s)); lg[m * nOut + f] = l; if (l > mx) mx = l;
  }
  for (let i = 0; i < lg.length; i++) out[i] = (Math.max(lg[i], mx - 8) + 4) / 4;
  return out; // shape (80, 800) row-major
}
export const FEATURE_SHAPE = [1, N_MELS, 800] as const;
