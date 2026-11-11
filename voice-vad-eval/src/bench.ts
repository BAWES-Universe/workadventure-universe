// What the detector costs the worker: start-up, memory, CPU, and whether it gets in the way of the media loop.
// N people are analysed at once, in real time (a 20 ms frame each, every 20 ms), for a number of seconds.
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
            void person.stream.push(frame).then((probs) => {
                pending--;
                if (probs.length) {
                    inferences += probs.length;
                    queueAges.push(performance.now() - arrived);
                }
            });
        }
        if (n % 50 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
        n++;
        if (n >= frames) return void setTimeout(resolve, 200);
        setTimeout(tick, Math.max(0, due + 20 - performance.now()));
    };
    tick();
});
const wallMs = performance.now() - wall0;
const cpu = process.cpuUsage(cpu0);
loop.disable();
const sorted = [...queueAges].sort((a, b) => a - b);
const q = (p: number): number => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN) * 100) / 100;
console.log(
    JSON.stringify({
        runtime,
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
