// Optional "emotion from audio" step (STUB). Receives the person's 16 kHz audio for the turn, returns {label, confidence, source:"stub"}.
// Loudness only. No model, no download. Same rule as pipecat-engine/engine/emotion_stub.py. A real model replaces labelFor() and nothing else.
export interface Emotion { label: string; confidence: number; source: 'stub' }
export function labelFor(pcm: Int16Array): Emotion {
  const n = Math.floor(pcm.length / 320) * 320; if (!n) return { label: 'neutral', confidence: 0, source: 'stub' };
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i += 320) { let e = 0; for (let k = 0; k < 320; k++) { const v = pcm[i + k] / 32768; e += v * v; } const db = 10 * Math.log10(e / 320 + 1e-12); if (db > -45) { sum += db; cnt++; } }
  const m = cnt ? sum / cnt : -90;
  if (m >= -19) return { label: 'excited', confidence: Math.round(Math.min(1, 0.5 + (m + 19) / 10) * 1000) / 1000, source: 'stub' };
  if (m <= -30) return { label: 'calm', confidence: Math.round(Math.min(1, 0.5 + (-30 - m) / 10) * 1000) / 1000, source: 'stub' };
  return { label: 'neutral', confidence: 0.5, source: 'stub' };
}
