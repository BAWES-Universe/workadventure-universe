/** Watching how full the voice worker is (#1751): what goes to PostHog every minute, and when Sentry is warned. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_VOICE_LOAD,
    VoiceLoadWatch,
    pausedAtCapacityEvent,
    readWorkerLoad,
    universeOfRoom,
    voiceLoadSettings,
    workerStatsUrl,
    type WorkerLoad,
} from '../voice/VoiceLoad';

const MINUTE = 60_000;

function load(extra: Partial<WorkerLoad> = {}): WorkerLoad {
    return { connections: 2, sessions: 3, lanes: 10, maxLanes: 100, peakLanes: 12, cpuPercent: 20, memoryMb: 150, counters: {}, ...extra };
}

function watch(loads: (WorkerLoad | null)[], settings = DEFAULT_VOICE_LOAD) {
    let now = 0;
    const events: [string, Record<string, unknown>][] = [];
    const warnings: [string, Record<string, unknown>][] = [];
    const logs: string[] = [];
    const w = new VoiceLoadWatch(
        {
            read: async () => (loads.length > 1 ? loads.shift()! : loads[0]),
            capture: (event, properties) => events.push([event, properties]),
            warn: (message, details) => warnings.push([message, details]),
            log: (message) => logs.push(message),
            now: () => now,
        },
        settings
    );
    return {
        events, warnings, logs,
        /** One read, then the clock moves on a minute. */
        tick: async () => {
            await w.tick();
            now += MINUTE;
        },
        set: (next: (WorkerLoad | null)[]) => loads.splice(0, loads.length, ...next),
    };
}

describe('voice load settings', () => {
    it('reads every minute, warns at 80% of the cap or 70% CPU for 5 minutes, at most once an hour', () => {
        expect(voiceLoadSettings({})).toEqual(DEFAULT_VOICE_LOAD);
        expect(DEFAULT_VOICE_LOAD).toMatchObject({ intervalMs: MINUTE, capacityPercent: 80, cpuPercent: 70, cpuForMs: 5 * MINUTE, warnEveryMs: 60 * MINUTE });
    });

    it('takes each one from its setting, and ignores one that is not a positive number', () => {
        const s = voiceLoadSettings({
            VOICE_STATS_INTERVAL_SECONDS: '30',
            VOICE_ALERT_CAPACITY_PERCENT: '90',
            VOICE_ALERT_CPU_PERCENT: '60',
            VOICE_ALERT_CPU_MINUTES: '2',
            VOICE_ALERT_EVERY_MINUTES: '15',
            VOICE_STATS_TIMEOUT_SECONDS: 'soon',
        });
        expect(s).toEqual({ intervalMs: 30_000, capacityPercent: 90, cpuPercent: 60, cpuForMs: 2 * MINUTE, warnEveryMs: 15 * MINUTE, timeoutMs: DEFAULT_VOICE_LOAD.timeoutMs });
        expect(voiceLoadSettings({ VOICE_ALERT_CAPACITY_PERCENT: '-5' }).capacityPercent).toBe(80);
    });
});

describe('where the load is read', () => {
    it('is /stats next to the bridge address', () => {
        expect(workerStatsUrl('ws://voice-worker:8830')).toBe('http://voice-worker:8830/stats');
        expect(workerStatsUrl('wss://voice.example/bridge?x=1')).toBe('https://voice.example/stats');
        // A worker behind a path prefix is read under the same prefix as its bridge
        expect(workerStatsUrl('wss://host.example/voice')).toBe('https://host.example/voice/stats');
        expect(workerStatsUrl('wss://host.example/voice/')).toBe('https://host.example/voice/stats');
    });
});

describe('the load event every minute', () => {
    it('carries live and peak connections, the cap, CPU and memory', async () => {
        const t = watch([load()]);
        await t.tick();
        expect(t.events).toEqual([
            [
                'voice_worker_stats',
                {
                    bot_connections: 2,
                    sessions: 3,
                    audio_connections: 10,
                    peak_audio_connections: 12,
                    max_audio_connections: 100,
                    capacity_used_percent: 10,
                    turned_away: 0,
                    turned_away_total: 0,
                    cpu_percent: 20,
                    memory_mb: 150,
                },
            ],
        ]);
        expect(t.warnings).toEqual([]);
    });

    it('counts who was turned away since the last read, and starts again when the worker restarts', async () => {
        const t = watch([load({ counters: { lanes_refused: 4 } }), load({ counters: { lanes_refused: 6, sessions_refused: 1 } }), load({ counters: { lanes_refused: 2 } })]);
        await t.tick();
        await t.tick();
        await t.tick();
        expect(t.events.map(([, p]) => [p.turned_away, p.turned_away_total])).toEqual([
            [0, 4],
            [3, 7],
            [2, 2],
        ]);
    });

    it('sends nothing when the worker cannot be read, and says so once', async () => {
        const t = watch([null]);
        await t.tick();
        await t.tick();
        expect(t.events).toEqual([]);
        expect(t.logs).toHaveLength(1);
        t.set([load()]);
        await t.tick();
        expect(t.events).toHaveLength(1);
    });
});

describe('the Sentry warning', () => {
    it('fires when audio connections reach 80% of the cap, and not again within the hour', async () => {
        const t = watch([load({ lanes: 79 })]);
        await t.tick();
        expect(t.warnings).toEqual([]);
        t.set([load({ lanes: 80 })]);
        await t.tick();
        expect(t.warnings).toHaveLength(1);
        expect(t.warnings[0][0]).toContain('80% of the cap (80 of 100)');
        expect(t.warnings[0][1]).toMatchObject({ audio_connections: 80, max_audio_connections: 100 });
        for (let i = 0; i < 59; i++) await t.tick();
        expect(t.warnings).toHaveLength(1);
        await t.tick();
        expect(t.warnings).toHaveLength(2);
    });

    it('fires when CPU stays at 70% for 5 minutes, not for a short spike', async () => {
        const t = watch([load({ cpuPercent: 95 })]);
        for (let i = 0; i < 3; i++) await t.tick();
        t.set([load({ cpuPercent: 30 })]);
        await t.tick();
        t.set([load({ cpuPercent: 75 })]);
        for (let i = 0; i < 5; i++) await t.tick();
        expect(t.warnings).toEqual([]);
        await t.tick();
        expect(t.warnings).toHaveLength(1);
        expect(t.warnings[0][0]).toContain('CPU at 75% for 5 minutes');
    });

    it('uses the limits it is given', async () => {
        const t = watch([load({ lanes: 50 })], { ...DEFAULT_VOICE_LOAD, capacityPercent: 50 });
        await t.tick();
        expect(t.warnings).toHaveLength(1);
    });

    it('never fires for a worker that reports no cap', async () => {
        const t = watch([load({ lanes: 5, maxLanes: 0 })]);
        await t.tick();
        expect(t.warnings).toEqual([]);
    });
});

describe('reading the worker', () => {
    let server: http.Server | undefined;
    afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

    async function serve(handler: http.RequestListener): Promise<string> {
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}/stats`;
    }

    it('presents the worker secret and reads the figures', async () => {
        let auth: string | undefined;
        const url = await serve((req, res) => {
            auth = req.headers.authorization;
            res.end(JSON.stringify({ connections: 1, sessions: 2, lanes: 3, maxLanes: 200, peakLanes: 4, cpuPercent: 12.5, memoryMb: 140, counters: { lanes_refused: 1 }, engineId: 'x' }));
        });
        const got = await readWorkerLoad(url, 'shh', 2000);
        expect(auth).toBe('Bearer shh');
        expect(got).toEqual({ connections: 1, sessions: 2, lanes: 3, maxLanes: 200, peakLanes: 4, cpuPercent: 12.5, memoryMb: 140, counters: { lanes_refused: 1 } });
    });

    it('gives null for a refused read, a slow worker or no worker', async () => {
        const refused = await serve((_req, res) => {
            res.statusCode = 401;
            res.end('{}');
        });
        expect(await readWorkerLoad(refused, 'wrong', 2000)).toBeNull();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        const slow = await serve(() => undefined);
        expect(await readWorkerLoad(slow, undefined, 100)).toBeNull();
        server!.closeAllConnections();
        expect(await readWorkerLoad('http://127.0.0.1:1/stats', undefined, 500)).toBeNull();
    });
});

describe('the paused-at-capacity event', () => {
    it('names the bot, the universe and the room, and nothing anyone said', () => {
        expect(pausedAtCapacityEvent('bot-1', 'https://play.example/@/bawes/hq/lobby', 'connection')).toEqual({
            bot_id: 'bot-1',
            universe: 'bawes',
            room_url: 'https://play.example/@/bawes/hq/lobby',
            turned_away: 'connection',
        });
        expect(universeOfRoom('http://play.example.test/_/global/maps.example.test/lobby.tmj')).toBeUndefined();
        expect(universeOfRoom('not a url')).toBeUndefined();
    });
});
