// Smart Turn parity: TypeScript log-mel + onnxruntime-node vs Pipecat's Python extractor + onnxruntime, on the SAME audio.
//   1) pipecat-engine/.venv/bin/python pipecat-engine/tools/parity_ref.py     (writes /tmp/parity)
//   2) npx tsx ts-engine/test/parity.ts [out.csv]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadModels, smartTurnProbability } from '../src/models.ts';

await loadModels();
const f32 = (p: string) => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const cases: any[] = JSON.parse(readFileSync('/tmp/parity/cases.json', 'utf8'));
const rows = ['case,audio_samples,max_abs_feature_diff,mean_abs_feature_diff,py_probability,ts_probability,prob_abs_diff,py_decision,ts_decision,decision_match'];
let maxDiff = 0, maxProb = 0, mismatches = 0, completeCount = 0;
for (const c of cases) {
  const py = f32(c.featureFile); const r = await smartTurnProbability(f32(c.audioFile));
  let md = 0, sd = 0; for (let i = 0; i < py.length; i++) { const d = Math.abs(py[i] - r.features[i]); if (d > md) md = d; sd += d; }
  const pd = Math.abs(r.probability - c.probability); const dec = r.probability > 0.5 ? 1 : 0;
  maxDiff = Math.max(maxDiff, md); maxProb = Math.max(maxProb, pd); if (dec !== c.prediction) mismatches++; completeCount += c.prediction;
  rows.push([c.case, c.samples, md.toExponential(3), (sd / py.length).toExponential(3), c.probability.toFixed(6), r.probability.toFixed(6), pd.toExponential(2), c.prediction, dec, dec === c.prediction].join(','));
}
const summary = { cases: cases.length, pythonSaysComplete: completeCount, pythonSaysIncomplete: cases.length - completeCount, maxAbsFeatureDiff: maxDiff, maxAbsProbabilityDiff: maxProb, decisionMismatches: mismatches };
console.log(JSON.stringify(summary, null, 1));
const out = process.argv[2] ?? '/tmp/parity/parity.csv';
writeFileSync(out, rows.join('\n') + '\n'); writeFileSync(out.replace(/\.csv$/, '.json'), JSON.stringify(summary, null, 1));
