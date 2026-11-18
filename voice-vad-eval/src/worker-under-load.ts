// The voice worker itself, started the way main.ts starts it (same settings from the environment), for load.ts to
// drive. The one stand-in is the speech-to-text provider: scripted fake ears, so today's whole hearing path runs
// (volume gate, turns, partials) with no provider and no key. Signals: USR2 = start measuring, USR1 = write the
// summary, TERM = close the worker and say how long that took. Memory and CPU are the container's own figures
// (cgroup), not this process's guess.
//   VOICE_SPEECH_OBSERVER_MODEL=... (and VOICE_SPEECH_OBSERVER=0 to switch it off) decide whether the observer is on, exactly as in production
//   WORKER_ROOT=/app runs the worker code of a built image (this file mounted into it) instead of the repository's
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const root = process.env.WORKER_ROOT ? pathToFileURL(`${process.env.WORKER_ROOT}/`).href : new URL('../../voice-worker/', import.meta.url).href;
const { optionsFromEnv } = (await import(`${root}src/config.ts`)) as typeof import('../../voice-worker/src/config.ts');
const { FakeEars } = (await import(`${root}src/recognizer.ts`)) as typeof import('../../voice-worker/src/recognizer.ts');
const { VoiceWorker } = (await import(`${root}src/server.ts`)) as typeof import('../../voice-worker/src/server.ts');

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
if (trace) writeFileSync(trace, 'uptime_s\tcontainer_mb\tcontainer_anon_mb\tprocess_rss_mb\tjs_heap_used_mb\tjs_external_mb\tsessions\tlanes\tobserver_streams\tobserver_waiting_ms\tloop_delay_max_ms\n');
const traceLoop = monitorEventLoopDelay({ resolution: 5 });
traceLoop.enable();
let mark = { at: performance.now(), box: container(), counters: worker.counters.snapshot() };
const samples: { t: number; currentMb: number; anonMb: number; rssMb: number; queuedMs: number; streams: number }[] = [];
const sampler = setInterval(() => {
    const observer = worker.stats().speechObserver as { queuedMs: number; streams: number } | undefined;
    const box = container();
    samples.push({ t: Math.round((performance.now() - mark.at) / 1000), currentMb: Math.round(box.currentMb), anonMb: Math.round(box.anonMb), rssMb: Math.round(process.memoryUsage().rss / MB), queuedMs: observer?.queuedMs ?? 0, streams: observer?.streams ?? 0 });
    // Kept as it goes, so a worker that is killed still leaves its memory curve behind
    if (trace && ++traced % 10 === 0) {
        const stats = worker.stats() as { sessions?: number; lanes?: number };
        const memory = process.memoryUsage();
        appendFileSync(
            trace,
            `${[process.uptime(), box.currentMb, box.anonMb, memory.rss / MB, memory.heapUsed / MB, memory.external / MB].map(Math.round).join('\t')}\t${stats.sessions ?? ''}\t${stats.lanes ?? ''}\t${observer?.streams ?? ''}\t${observer?.queuedMs ?? ''}\t${(traceLoop.max / 1e6).toFixed(0)}\n`
        );
        traceLoop.reset();
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
    const completed = since('observer_windows_completed');
    const accepted = since('observer_windows_accepted');
    const calls = since('observer_calls');
    const share = (part: number, whole: number): number | null => (whole ? Number((part / whole).toFixed(4)) : null);
    const beside = (path: 'lane' | 'room') => ({
        todaysGateSaidSpeaking: since(`observer_baseline_${path}`),
        observerFirings: since(`observer_firings_${path}`),
        within600msOfEachOther: since(`observer_agree_${path}`),
    });
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
                heard: { frames: since('frames_heard'), ms: Math.round(since('heard_ms')), speechTurns: since('speech_turns'), bargeIns: since('barge_ins'), lanesConnected: since('lanes_connected'), lanesClosed: since('lanes_closed'), roomsConnected: since('rooms_connected'), roomsClosed: since('rooms_closed') },
                observerWork: options.speechObserver
                    ? {
                          status: (worker.stats().speechObserver as { status: string }).status,
                          // What the sessions handed over, and how much of it got an answer that was kept. The rest is under lostMs, by why.
                          offeredMs: { lane: Math.round(since('observer_offered_ms_lane')), room: Math.round(since('observer_offered_ms_room')) },
                          acceptedMs: { lane: since('observer_accepted_ms_lane'), room: since('observer_accepted_ms_room') },
                          coverage: { lane: share(since('observer_accepted_ms_lane'), since('observer_offered_ms_lane')), room: share(since('observer_accepted_ms_room'), since('observer_offered_ms_room')) },
                          // Every window the detector answered for is in exactly one of accepted, revoked, stale, expired; failed ones never got an answer
                          windows: { completed, accepted, revoked: since('observer_windows_revoked'), stale: since('observer_windows_stale'), expired: since('observer_windows_expired'), failed: since('observer_windows_failed') },
                          audioSecondsJudged: Math.round((accepted * 512) / 16000),
                          // One call to the detector carries one window from each person who has one waiting
                          calls,
                          meanPeoplePerCall: calls ? Number((completed / calls).toFixed(1)) : 0,
                          mostPeopleInACall: counters.observer_peak_batch ?? 0,
                          meanCallMs: calls ? Number((since('observer_run_us') / 1000 / calls).toFixed(2)) : 0,
                          maxCallMs: counters.observer_max_run_ms ?? 0,
                          // Ages are of accepted answers only: from the newest sample of the window, and from its oldest
                          meanAgeMs: accepted ? Number((since('observer_age_ms') / accepted).toFixed(1)) : 0,
                          maxAgeMs: counters.observer_max_age_ms ?? 0,
                          maxOldestSampleAgeMs: counters.observer_max_oldest_age_ms ?? 0,
                          peakQueuedMs: counters.observer_peak_queued_ms ?? 0,
                          peakStreams: counters.observer_peak_streams ?? 0,
                          peakLine: counters.observer_peak_line ?? 0,
                          // Audio let go without an answer, by why: the observer's own bounds (overflow), too old by the clock (expired),
                          // a last bit shorter than a window (idle), the person no longer heard (revoked), a failed call, or a start afresh after missing audio (reset)
                          lostMs: Object.fromEntries(['overflow', 'expired', 'idle', 'revoked', 'failed', 'reset'].map((why) => [why, Math.round(since(`observer_${why}_ms`))])),
                          overloads: since('observer_overloads'),
                          timedOut: since('observer_timed_out'),
                          gaveUp: since('observer_gave_up'),
                          errors: since('observer_errors'),
                          refusedAfterClose: since('observer_refused_closed'),
                          streamsStarted: since('observer_streams'),
                          streamsEnded: since('observer_streams_ended'),
                          streamsRefused: since('observer_streams_refused'),
                          speechWindows: since('observer_speech_windows'),
                          // Counts only, beside today's gate. Not false stops: nobody labelled this audio, and the gate's "speaking" is not ground truth
                          besideTodaysGate: {
                              lane: beside('lane'),
                              room: beside('room'),
                              todaysGateStoppedTheVoice: since('observer_baseline_stops'),
                              observerFiringsWhileBotSpoke: since('observer_firings_bot_speaking'),
                              acceptedSecondsWhileBotSpoke: Math.round(since('observer_accepted_ms_bot_speaking') / 1000),
                          },
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
    // How long closing takes with whatever is still connected, and what the observer still held just before
    const before = worker.stats() as { sessions?: number; lanes?: number; speechObserver?: unknown };
    const started = performance.now();
    await worker.close();
    if (process.env.LOAD_SHUTDOWN) writeFileSync(process.env.LOAD_SHUTDOWN, JSON.stringify({ closeMs: Math.round(performance.now() - started), sessionsAtClose: before.sessions, lanesAtClose: before.lanes, observerAtClose: before.speechObserver ?? null, observerAfterClose: worker.stats().speechObserver ?? null }));
    process.exit(0);
});
console.log(`worker under load listening on ${port}, observer ${options.speechObserver ? 'on' : 'off'}`);
