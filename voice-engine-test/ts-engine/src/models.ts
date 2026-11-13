// onnxruntime-node wrappers. One InferenceSession per process is shared by all lanes (sessions are thread safe); per-lane state lives in the wrapper objects.
import * as ort from 'onnxruntime-node';
import { fileURLToPath } from 'node:url';
import { logMel } from './features.ts';

const MODELS = fileURLToPath(new URL('../models/', import.meta.url));
let sileroSession: ort.InferenceSession | undefined, turnSession: ort.InferenceSession | undefined;
const opts: ort.InferenceSession.SessionOptions = { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all' };

export async function loadModels() {
  sileroSession ??= await ort.InferenceSession.create(MODELS + 'silero_vad.onnx', opts);
  turnSession ??= await ort.InferenceSession.create(MODELS + 'smart-turn-v3.2-cpu.onnx', opts);
}

/** Silero VAD, 16 kHz, 512-sample windows with a 64-sample context (same arrangement as pipecat's SileroOnnxModel). */
export class SileroModel {
  private state = new Float32Array(2 * 128); private ctx = new Float32Array(64); private sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  resetStates() { this.state = new Float32Array(2 * 128); this.ctx = new Float32Array(64); }
  async score(win512: Float32Array): Promise<number> {
    const x = new Float32Array(64 + 512); x.set(this.ctx); x.set(win512, 64);
    const out = await sileroSession!.run({ input: new ort.Tensor('float32', x, [1, 576]), state: new ort.Tensor('float32', this.state, [2, 1, 128]), sr: this.sr });
    this.state = new Float32Array((out.stateN as ort.Tensor).data as Float32Array);
    this.ctx = x.slice(x.length - 64);
    return ((out.output as ort.Tensor).data as Float32Array)[0];
  }
}

/** Smart Turn v3.2 (cpu): features -> probability that the turn is complete. */
export async function smartTurnProbability(audio16k: Float32Array): Promise<{ probability: number; features: Float32Array }> {
  // keep the last 8 s, or left-pad with zeros to 8 s (pipecat: truncate_audio_to_last_n_seconds)
  const n = 128000; let a = audio16k;
  if (a.length > n) a = a.subarray(a.length - n); else if (a.length < n) { const p = new Float32Array(n); p.set(a, n - a.length); a = p; }
  const features = logMel(a);
  const out = await turnSession!.run({ input_features: new ort.Tensor('float32', features, [1, 80, 800]) });
  return { probability: (out.logits as ort.Tensor).data[0] as number, features };
}
