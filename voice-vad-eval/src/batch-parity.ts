// Does the worker's detector give the same answers when several people's windows go in one call as when each goes alone?
// Real recordings of the report half (speech in every condition, and noise), through the worker's own loader
// (voice-worker/src/speechObserverRuntime.ts): each recording once alone, window by window, and once side by side with
// the others in calls of `people` at a time. Fails if any probability differs by more than 1e-5 or any verdict changes.
//   ORT_DISABLE_TELEMETRY=1 tsx src/batch-parity.ts <data dir> [people, default 20] [windows each, default 150]
import { createRequire } from 'node:module';
import { CONTEXT, STATE, WINDOW } from '../../voice-worker/src/speechObserver.ts';
import { sileroLoader } from '../../voice-worker/src/speechObserverRuntime.ts';
import { buildManifest } from './fixtures.ts';

const [data, peopleArg, windowsArg] = process.argv.slice(2);
const people = Number(peopleArg ?? 20);
const windows = Number(windowsArg ?? 150);
const manifest = buildManifest(data).filter((m) => m.split === 'report');
// A spread: every speech set and condition in turn, and every fourth one a noise recording
const speech = manifest.filter((m) => m.kind === 'speech');
const noise = manifest.filter((m) => m.kind === 'noise');
const picked = Array.from({ length: people }, (_, i) => (i % 4 === 3 ? noise[(i * 37) % noise.length] : speech[(i * 211) % speech.length]));
const audio = picked.map((item) => {
    const pcm = item.build().pcm;
    const x = new Float32Array(CONTEXT + windows * WINDOW);
    for (let i = 0; i < windows * WINDOW; i++) x[CONTEXT + i] = (pcm[i % pcm.length] ?? 0) / 32768;
    return x;
});
const model = await sileroLoader({ modelPath: `${data}/silero_vad_v6.2.3.onnx`, runtime: createRequire(import.meta.url).resolve('onnxruntime-node') })();
if (!model.runMany) throw new Error('the loader has no runMany');

const alone: number[][] = [];
for (const x of audio) {
    let state = new Float32Array(STATE);
    const row: number[] = [];
    for (let w = 0; w < windows; w++) {
        const result = await model.run(Float32Array.from(x.subarray(w * WINDOW, w * WINDOW + CONTEXT + WINDOW)), state);
        row.push(result.probability);
        state = Float32Array.from(result.state);
    }
    alone.push(row);
}
// Side by side, and not always the same people in a call: every third call leaves one person out, who catches up in a
// call of their own, as happens when someone's audio arrives late
const together: number[][] = audio.map(() => []);
let states = audio.map(() => new Float32Array(STATE));
const window = (p: number, w: number) => ({ input: Float32Array.from(audio[p].subarray(w * WINDOW, w * WINDOW + CONTEXT + WINDOW)), state: states[p] });
let calls = 0;
for (let w = 0; w < windows; w++) {
    const late = w % 3 === 2 ? w % people : -1;
    const now = audio.map((_, p) => p).filter((p) => p !== late);
    const answers = await model.runMany(now.map((p) => window(p, w)));
    calls++;
    now.forEach((p, i) => {
        together[p].push(answers[i].probability);
        states[p] = answers[i].state;
    });
    if (late >= 0) {
        const [answer] = await model.runMany([window(late, w)]);
        calls++;
        together[late].push(answer.probability);
        states[late] = answer.state;
    }
}
await model.release?.();
let maxDiff = 0;
let flips = 0;
let speechWindows = 0;
for (let p = 0; p < people; p++) {
    for (let w = 0; w < windows; w++) {
        maxDiff = Math.max(maxDiff, Math.abs(alone[p][w] - together[p][w]));
        if (alone[p][w] >= 0.5 !== together[p][w] >= 0.5) flips++;
        if (alone[p][w] >= 0.5) speechWindows++;
    }
}
const summary = { people, recordings: picked.map((m) => m.id), windowsEach: windows, windowsCompared: people * windows, calls, speechWindows, maxProbabilityDifference: maxDiff, verdictsChanged: flips };
console.log(JSON.stringify(summary, null, 2));
if (maxDiff > 1e-5 || flips > 0) {
    console.error('NOT the same');
    process.exit(1);
}
