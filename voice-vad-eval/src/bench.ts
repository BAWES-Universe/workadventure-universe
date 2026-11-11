// What the detector costs BY ITSELF, in a bare process: start-up, memory, CPU, event-loop delay. This is not the worker:
// the worker with its real audio work is measured by scripts/worker-load.sh (worker-under-load.ts and load.ts).
// N people are analysed at once, in real time (a 20 ms frame each, every 20 ms), for a number of seconds. The run only
// ends when every frame handed over has been answered, and fails if any was not.
//   tsx src/bench.ts <model> <native|wasm> <streams> <seconds> [noise wav]
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { SileroModel, type Runtime } from './silero.ts';
import { readWav16k } from './wav.ts';

const [modelPath, runtimeArg, streamsArg, secondsArg, wav] = process.argv.slice(2);
const runtime = runtimeArg as Runtime;
const streams = Number(streamsArg);
const seconds = Number(secondsArg);
const mb = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10;

const rssBefore = process.memoryUsage().rss;
const t0 = performance.now();
const model = await SileroModel.load(modelPath, runtime);
const warm = model.stream();
await warm.push(new Int16Array(512));
const loadMs = performance.now() - t0;
const rssLoaded = process.memoryUsage().rss;

// Each person hears a different part of a real noise clip (or a tone), so the model does real work
const source = wav ? readWav16k(wav) : Int16Array.from({ length: 16000 * 30 }, (_, i) => Math.round(3000 * Math.sin((2 * Math.PI * 220 * i) / 16000)));
const people = Array.from({ length: streams }, (_, i) => ({ stream: model.stream(), at: (i * 7919 * 320) % Math.max(320, source.length - 320) }));

const loop = monitorEventLoopDelay({ resolution: 1 });
loop.enable();
const cpu0 = process.cpuUsage();
const wall0 = performance.now();
const queueAges: number[] = [];
let inferences = 0;
let peakRss = rssLoaded;
let pending = 0;
let maxPending = 0;
let failed = 0;
const work: Promise<void>[] = [];
const frames = Math.round((seconds * 1000) / 20);
await new Promise<void>((resolve) => {
    let n = 0;
    const tick = (): void => {
        const due = wall0 + n * 20;
        for (const person of people) {
            const frame = source.subarray(person.at, person.at + 320);
            person.at = person.at + 640 < source.length ? person.at + 320 : 0;
            const arrived = performance.now();
            pending++;
            maxPending = Math.max(maxPending, pending);
            work.push(
                person.stream.push(frame).then(
                    (probs) => {
                        pending--;
                        if (probs.length) {
                            inferences += probs.length;
                            queueAges.push(performance.now() - arrived);
                        }
                    },
                    () => {
                        pending--;
                        failed++;
                    }
                )
            );
        }
        if (n % 5 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
        n++;
        if (n >= frames) return void resolve();
        setTimeout(tick, Math.max(0, due + 20 - performance.now()));
    };
    tick();
});
await Promise.all(work);
const expected = Math.floor((frames * 320) / 512) * streams;
if (failed || pending || inferences !== expected) throw new Error(`not all work was done: ${inferences} of ${expected} windows, ${failed} failed, ${pending} pending`);
const wallMs = performance.now() - wall0;
const cpu = process.cpuUsage(cpu0);
loop.disable();
const sorted = [...queueAges].sort((a, b) => a - b);
const q = (p: number): number => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN) * 100) / 100;
console.log(
    JSON.stringify({
        runtime,
        node: process.version,
        arch: process.arch,
        streams,
        seconds,
        loadMs: Math.round(loadMs),
        rssBeforeMb: mb(rssBefore),
        rssLoadedMb: mb(rssLoaded),
        rssPeakMb: mb(peakRss),
        cores: Math.round(((cpu.user + cpu.system) / 1000 / wallMs) * 1000) / 1000,
        inferences,
        frameToVerdictMs: { p50: q(0.5), p95: q(0.95), max: q(1) },
        eventLoopDelayMs: { p50: Math.round((loop.percentile(50) / 1e6) * 100) / 100, p99: Math.round((loop.percentile(99) / 1e6) * 100) / 100, max: Math.round((loop.max / 1e6) * 100) / 100 },
        maxPending,
    })
);
