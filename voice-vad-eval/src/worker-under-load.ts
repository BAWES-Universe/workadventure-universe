// The voice worker itself, started the way main.ts starts it (same settings from the environment), for load.ts to
// drive. The one stand-in is the speech-to-text provider: scripted fake ears, so today's whole hearing path runs
// (volume gate, turns, partials) with no provider and no key. Signals: USR2 = start measuring, USR1 = write the
// summary. Memory and CPU are the container's own figures (cgroup), not this process's guess.
//   VOICE_SPEECH_OBSERVER=1 VOICE_SPEECH_OBSERVER_MODEL=... decide whether the observer is on, exactly as in production
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { optionsFromEnv } from '../../voice-worker/src/config.ts';
import { FakeEars } from '../../voice-worker/src/recognizer.ts';
import { VoiceWorker } from '../../voice-worker/src/server.ts';

const out = process.env.LOAD_SUMMARY ?? '/tmp/worker-summary.json';
const cgroup = (name: string): string | undefined => (existsSync(`/sys/fs/cgroup/${name}`) ? readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim() : undefined);
const keyed = (text?: string): Record<string, number> => Object.fromEntries((text ?? '').split('\n').filter(Boolean).map((line) => [line.split(' ')[0], Number(line.split(' ')[1])]));
const MB = 1048576;
/** The container's own accounting, whichever of the two cgroup layouts the host uses. Memory includes file cache; "anon" is without it. */
function container(): { currentMb: number; anonMb: number; peakMb: number; limitMb: number; oomKills: number; cpuSeconds: number; throttledSeconds: number; throttledPeriods: number } {
    if (existsSync('/sys/fs/cgroup/memory.current')) {
        const cpu = keyed(cgroup('cpu.stat'));
        return {
            currentMb: Number(cgroup('memory.current')) / MB,
            anonMb: (keyed(cgroup('memory.stat')).anon ?? 0) / MB,
            peakMb: Number(cgroup('memory.peak') ?? 0) / MB,
            limitMb: Number(cgroup('memory.max')) / MB,
            oomKills: keyed(cgroup('memory.events')).oom_kill ?? 0,
            cpuSeconds: (cpu.usage_usec ?? 0) / 1e6,
            throttledSeconds: (cpu.throttled_usec ?? 0) / 1e6,
            throttledPeriods: cpu.nr_throttled ?? 0,
        };
    }
    const cpu = keyed(cgroup('cpu/cpu.stat'));
    return {
        currentMb: Number(cgroup('memory/memory.usage_in_bytes') ?? 0) / MB,
        anonMb: (keyed(cgroup('memory/memory.stat')).total_rss ?? 0) / MB,
        peakMb: Number(cgroup('memory/memory.max_usage_in_bytes') ?? 0) / MB,
        limitMb: Number(cgroup('memory/memory.limit_in_bytes') ?? 0) / MB,
        oomKills: keyed(cgroup('memory/memory.oom_control')).oom_kill ?? 0,
        cpuSeconds: Number(cgroup('cpuacct/cpuacct.usage') ?? 0) / 1e9,
        throttledSeconds: (cpu.throttled_time ?? 0) / 1e9,
        throttledPeriods: cpu.nr_throttled ?? 0,
    };
}

const options = optionsFromEnv();
const ears = new FakeEars(Array.from({ length: 200000 }, () => 'which of them replied this week'));
const worker = new VoiceWorker({ ...options, recognizer: ears.factory });
const port = await worker.listen();
const loop = monitorEventLoopDelay({ resolution: 5 });
loop.enable();
const trace = process.env.LOAD_TRACE;
let traced = 0;
if (trace) writeFileSync(trace, 'uptime_s\tcontainer_mb\tcontainer_anon_mb\tprocess_rss_mb\tjs_heap_used_mb\tjs_external_mb\tsessions\n');
let mark = { at: performance.now(), box: container(), counters: worker.counters.snapshot() };
const samples: { t: number; currentMb: number; anonMb: number; rssMb: number; queuedMs: number; streams: number }[] = [];
const sampler = setInterval(() => {
    const observer = worker.stats().speechObserver as { queuedMs: number; streams: number } | undefined;
    const box = container();
    samples.push({ t: Math.round((performance.now() - mark.at) / 1000), currentMb: Math.round(box.currentMb), anonMb: Math.round(box.anonMb), rssMb: Math.round(process.memoryUsage().rss / MB), queuedMs: observer?.queuedMs ?? 0, streams: observer?.streams ?? 0 });
    // Kept as it goes, so a worker that is killed still leaves its memory curve behind
    if (trace && ++traced % 10 === 0) {
        const stats = worker.stats() as { sessions?: number };
        appendFileSync(trace, `${Math.round(process.uptime())}\t${Math.round(box.currentMb)}\t${Math.round(box.anonMb)}\t${Math.round(process.memoryUsage().rss / MB)}\t${Math.round(process.memoryUsage().heapUsed / MB)}\t${Math.round(process.memoryUsage().external / MB)}\t${stats.sessions ?? ''}\n`);
    }
}, 500);

process.on('SIGUSR2', () => {
    loop.reset();
    samples.length = 0;
    mark = { at: performance.now(), box: container(), counters: worker.counters.snapshot() };
});
process.on('SIGUSR1', () => {
    const seconds = (performance.now() - mark.at) / 1000;
    const box = container();
    const counters = worker.counters.snapshot();
    const since = (name: string): number => (counters[name] ?? 0) - (mark.counters[name] ?? 0);
    const windows = since('observer_windows');
    const calls = since('observer_calls');
    writeFileSync(
        out,
        JSON.stringify(
            {
                observer: options.speechObserver ? 'on' : 'off',
                node: process.version,
                arch: process.arch,
                cpuModel: os.cpus()[0]?.model,
                seconds: Math.round(seconds),
                // peakMb is the container's high-water mark since it started, file cache included (what the cap is enforced on)
                memory: {
                    limitMb: Math.round(box.limitMb),
                    peakMb: Math.round(box.peakMb),
                    peakShareOfLimit: Number((box.peakMb / box.limitMb).toFixed(3)),
                    peakAnonMbSampled: Math.max(0, ...samples.map((x) => x.anonMb)),
                    peakProcessRssMbSampled: Math.max(0, ...samples.map((x) => x.rssMb)),
                    endAnonMb: Math.round(box.anonMb),
                    oomKills: box.oomKills,
                },
                cpu: { coresUsed: Number(((box.cpuSeconds - mark.box.cpuSeconds) / seconds).toFixed(3)), throttledSeconds: Number((box.throttledSeconds - mark.box.throttledSeconds).toFixed(2)), throttledPeriods: box.throttledPeriods - mark.box.throttledPeriods },
                eventLoopDelayMs: { p50: Number((loop.percentile(50) / 1e6).toFixed(1)), p99: Number((loop.percentile(99) / 1e6).toFixed(1)), max: Number((loop.max / 1e6).toFixed(1)) },
                heard: { frames: since('frames_heard'), speechTurns: since('speech_turns'), lanesConnected: since('lanes_connected'), lanesClosed: since('lanes_closed') },
                observerWork: options.speechObserver
                    ? {
                          status: (worker.stats().speechObserver as { status: string }).status,
                          windows,
                          audioSecondsJudged: Math.round((windows * 512) / 16000),
                          // One call to the detector carries one window from each person who has one waiting
                          calls,
                          meanPeoplePerCall: calls ? Number((windows / calls).toFixed(1)) : 0,
                          mostPeopleInACall: counters.observer_peak_batch ?? 0,
                          meanCallMs: calls ? Number((since('observer_run_us') / 1000 / calls).toFixed(2)) : 0,
                          maxCallMs: counters.observer_max_run_ms ?? 0,
                          meanAgeMs: windows ? Number((since('observer_age_ms') / windows).toFixed(1)) : 0,
                          maxAgeMs: counters.observer_max_age_ms ?? 0,
                          peakQueuedMs: counters.observer_peak_queued_ms ?? 0,
                          peakStreams: counters.observer_peak_streams ?? 0,
                          droppedMs: since('observer_dropped_ms'),
                          overloads: since('observer_overloads'),
                          lateDiscarded: since('observer_late_discarded'),
                          errors: since('observer_errors'),
                          streamsStarted: since('observer_streams'),
                          streamsEnded: since('observer_streams_ended'),
                          speechWindows: since('observer_speech_windows'),
                          firings: since('observer_firings'),
                      }
                    : undefined,
                maxQueuedMsSeen: Math.max(0, ...samples.map((s) => s.queuedMs)),
            },
            null,
            2
        )
    );
});
process.on('SIGTERM', async () => {
    clearInterval(sampler);
    await worker.close();
    process.exit(0);
});
console.log(`worker under load listening on ${port}, observer ${options.speechObserver ? 'on' : 'off'}`);
