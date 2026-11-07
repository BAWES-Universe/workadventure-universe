// Watches how full the voice worker is (#1751): one PostHog event a minute with its load, and a Sentry warning
// when it nears its cap or its CPU stays high. No words and no keys: the worker's /stats has neither.

/** How the load watch reads and when it warns. Ordinary settings with defaults. */
export interface VoiceLoadSettings {
    /** How often the worker's load is read and sent, in milliseconds. */
    intervalMs: number;
    /** Warn when the worker's audio connections reach this share of its cap, in percent. */
    capacityPercent: number;
    /** Warn when the worker's CPU stays at or above this, in percent of one core... */
    cpuPercent: number;
    /** ...for this long, in milliseconds. */
    cpuForMs: number;
    /** At most one warning in this long, in milliseconds. */
    warnEveryMs: number;
    /** How long one read of the worker's load may take, in milliseconds. */
    timeoutMs: number;
}

export const DEFAULT_VOICE_LOAD: VoiceLoadSettings = {
    intervalMs: 60_000,
    capacityPercent: 80,
    cpuPercent: 70,
    cpuForMs: 5 * 60_000,
    warnEveryMs: 60 * 60_000,
    timeoutMs: 5_000,
};

export function voiceLoadSettings(env: NodeJS.ProcessEnv = process.env): VoiceLoadSettings {
    const positive = (value: string | undefined, fallback: number): number => {
        const parsed = Number.parseFloat(value ?? '');
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const d = DEFAULT_VOICE_LOAD;
    return {
        intervalMs: positive(env.VOICE_STATS_INTERVAL_SECONDS, d.intervalMs / 1000) * 1000,
        capacityPercent: positive(env.VOICE_ALERT_CAPACITY_PERCENT, d.capacityPercent),
        cpuPercent: positive(env.VOICE_ALERT_CPU_PERCENT, d.cpuPercent),
        cpuForMs: positive(env.VOICE_ALERT_CPU_MINUTES, d.cpuForMs / 60_000) * 60_000,
        warnEveryMs: positive(env.VOICE_ALERT_EVERY_MINUTES, d.warnEveryMs / 60_000) * 60_000,
        timeoutMs: positive(env.VOICE_STATS_TIMEOUT_SECONDS, d.timeoutMs / 1000) * 1000,
    };
}

/** The part of the worker's GET /stats the watch reads. */
export interface WorkerLoad {
    connections: number;
    sessions: number;
    lanes: number;
    maxLanes: number;
    peakLanes: number;
    cpuPercent: number;
    memoryMb: number;
    counters: Record<string, number>;
    /** How long turns took in the last ten minutes, per stage and provider (#1865). Times and provider names only. */
    latency?: WorkerLatency;
}

/** Stage (`hear`, `think`, `speak`, `play`, `total`), then provider, then the turns timed and their median and 95th percentile in milliseconds. */
export type WorkerLatency = Record<string, Record<string, { samples: number; p50: number; p95: number }>>;

/** The most latency figures one event carries, so a worker that names many providers cannot make it huge. */
const MAX_LATENCY_SERIES = 40;

/**
 * The worker's timings as flat PostHog properties: `latency_<stage>_<provider>_p50_ms`, `_p95_ms` and `_turns`, with the provider
 * as a lowercase word (`total` joins the hearing and speaking provider: `soniox_to_elevenlabs`). Numbers only.
 */
export function latencyProperties(latency: WorkerLatency | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    let series = 0;
    for (const [stage, providers] of Object.entries(latency ?? {})) {
        for (const [provider, stats] of Object.entries(providers ?? {})) {
            if (series >= MAX_LATENCY_SERIES) return out;
            series++;
            const name = `latency_${word(stage)}_${word(provider.replace('>', '_to_'))}`;
            out[`${name}_p50_ms`] = stats.p50;
            out[`${name}_p95_ms`] = stats.p95;
            out[`${name}_turns`] = stats.samples;
        }
    }
    return out;
}

const word = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'unknown';

/** What the worker said about latency, keeping only the numbers we read: anything else in it is dropped. */
function readLatency(raw: unknown): WorkerLatency {
    const out: WorkerLatency = {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    for (const [stage, providers] of Object.entries(raw)) {
        if (typeof providers !== 'object' || providers === null) continue;
        for (const [provider, stats] of Object.entries(providers as Record<string, unknown>)) {
            const { samples, p50, p95 } = (stats ?? {}) as Record<string, unknown>;
            if (!finite(samples) || !finite(p50) || !finite(p95)) continue;
            (out[stage] ??= {})[provider] = { samples, p50, p95 };
        }
    }
    return out;
}

/** The worker's /stats address, next to the bridge address the bot server already has. */
export function workerStatsUrl(bridgeUrl: string): string {
    // Resolved the way the bridge address is (next to it), so a worker behind a path prefix (wss://host/voice) is read there
    const url = new URL('stats', bridgeUrl.endsWith('/') ? bridgeUrl : `${bridgeUrl}/`);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.search = '';
    return url.toString();
}

/** Reads the worker's load, or null when it cannot be read (down, slow, refused). Never throws. */
export async function readWorkerLoad(statsUrl: string, secret: string | undefined, timeoutMs: number): Promise<WorkerLoad | null> {
    try {
        const response = await fetch(statsUrl, {
            headers: secret ? { authorization: `Bearer ${secret}` } : {},
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as Partial<WorkerLoad>;
        const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const latency = readLatency((body as { latency?: unknown }).latency);
        return {
            connections: n(body.connections),
            sessions: n(body.sessions),
            lanes: n(body.lanes),
            maxLanes: n(body.maxLanes),
            peakLanes: n(body.peakLanes),
            cpuPercent: n(body.cpuPercent),
            memoryMb: n(body.memoryMb),
            counters: body.counters && typeof body.counters === 'object' ? body.counters : {},
            ...(Object.keys(latency).length > 0 ? { latency } : {}),
        };
    } catch {
        return null;
    }
}

export interface VoiceLoadSinks {
    read: () => Promise<WorkerLoad | null>;
    /** Sends one PostHog event. */
    capture: (event: string, properties: Record<string, unknown>) => void;
    /** Sends one Sentry warning. */
    warn: (message: string, details: Record<string, unknown>) => void;
    log?: (message: string) => void;
    now?: () => number;
}

/** Counters on the worker that mean someone was turned away because it was full. */
const TURNED_AWAY = ['lanes_refused', 'sessions_refused'];

export class VoiceLoadWatch {
    private timer: NodeJS.Timeout | undefined;
    private lastTurnedAway: number | undefined;
    private cpuHighSince: number | undefined;
    private lastWarnAt: number | undefined;
    private reachable = true;

    constructor(private readonly sinks: VoiceLoadSinks, private readonly settings: VoiceLoadSettings = DEFAULT_VOICE_LOAD) {}

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => void this.tick(), this.settings.intervalMs);
        this.timer.unref?.();
    }

    stop(): void {
        clearInterval(this.timer);
        this.timer = undefined;
    }

    /** One read: sends the load, and warns when it is time to. */
    async tick(): Promise<void> {
        const now = (this.sinks.now ?? Date.now)();
        const load = await this.sinks.read();
        if (!load) {
            // Said once when it goes, not every minute
            if (this.reachable) this.sinks.log?.('voice: could not read the voice worker load');
            this.reachable = false;
            this.cpuHighSince = undefined;
            return;
        }
        this.reachable = true;

        const turnedAwayTotal = TURNED_AWAY.reduce((sum, name) => sum + (load.counters[name] ?? 0), 0);
        // A worker that restarted counts from 0 again: its whole count is new
        const turnedAway = this.lastTurnedAway === undefined ? 0 : turnedAwayTotal >= this.lastTurnedAway ? turnedAwayTotal - this.lastTurnedAway : turnedAwayTotal;
        this.lastTurnedAway = turnedAwayTotal;
        const capacityUsedPercent = load.maxLanes > 0 ? Math.round((load.lanes / load.maxLanes) * 1000) / 10 : 0;

        this.sinks.capture('voice_worker_stats', {
            bot_connections: load.connections,
            sessions: load.sessions,
            audio_connections: load.lanes,
            peak_audio_connections: load.peakLanes,
            max_audio_connections: load.maxLanes,
            capacity_used_percent: capacityUsedPercent,
            turned_away: turnedAway,
            turned_away_total: turnedAwayTotal,
            cpu_percent: load.cpuPercent,
            memory_mb: load.memoryMb,
            // How fast bots answer, per provider (#1865): numbers only
            ...latencyProperties(load.latency),
        });

        if (load.cpuPercent >= this.settings.cpuPercent) this.cpuHighSince ??= now;
        else this.cpuHighSince = undefined;

        const reasons: string[] = [];
        if (load.maxLanes > 0 && capacityUsedPercent >= this.settings.capacityPercent) {
            reasons.push(`audio connections at ${capacityUsedPercent}% of the cap (${load.lanes} of ${load.maxLanes})`);
        }
        if (this.cpuHighSince !== undefined && now - this.cpuHighSince >= this.settings.cpuForMs) {
            reasons.push(`CPU at ${load.cpuPercent}% for ${Math.round((now - this.cpuHighSince) / 60_000)} minutes or more`);
        }
        if (reasons.length === 0) return;
        if (this.lastWarnAt !== undefined && now - this.lastWarnAt < this.settings.warnEveryMs) return;
        this.lastWarnAt = now;
        this.sinks.warn(`Voice worker is getting full: ${reasons.join('; ')}`, {
            audio_connections: load.lanes,
            max_audio_connections: load.maxLanes,
            capacity_used_percent: capacityUsedPercent,
            cpu_percent: load.cpuPercent,
            memory_mb: load.memoryMb,
            sessions: load.sessions,
        });
    }
}

/** The universe a room belongs to, from its address (…/@/universe/world/room), or undefined for any other room. */
export function universeOfRoom(roomUrl: string): string | undefined {
    try {
        const match = /^\/@\/([^/]+)\//.exec(new URL(roomUrl).pathname);
        return match ? decodeURIComponent(match[1]) : undefined;
    } catch {
        return undefined;
    }
}

/** The PostHog event for someone a voice bot could not take on because the worker was full. No words, no names. */
export function pausedAtCapacityEvent(botId: string, roomUrl: string, what: 'connection' | 'room' | 'bubble'): Record<string, unknown> {
    return { bot_id: botId, universe: universeOfRoom(roomUrl) ?? null, room_url: roomUrl, turned_away: what };
}
