// How long a voice bot takes to answer (#1865), in milliseconds, per provider. Times and provider names only: never a
// word anyone said, a name, or a key. Nothing here is kept past a few minutes, and reading it changes nothing.
//
// A spoken turn is timed in four steps (the bot server's own work is the one in the middle):
//   hear    the person stops talking             -> their last words are final         (the hearing provider)
//   think   their last words are final           -> the bot's reply is written          (the bot, its AI model)
//   speak   the reply is handed to the voice     -> the speaking provider's first audio (the speaking provider)
//   play    that first audio                     -> its first frame is on its way out   (this worker)
// and `total`, from the person stopping to the first frame of the answer going out, which is what they wait.

export type Stage = 'hear' | 'think' | 'speak' | 'play' | 'total';
export const STAGES: readonly Stage[] = ['hear', 'think', 'speak', 'play', 'total'];

/** How long a sample counts, and the most kept for one stage and provider. */
export const LATENCY_WINDOW_MS = 10 * 60 * 1000;
const MAX_SAMPLES = 200;
/** Provider names are bounded by the schema, but a misbehaving bot server must not grow this without end. */
const MAX_SERIES = 64;

export interface LatencyStats {
    /** Turns in the window. */
    samples: number;
    /** Median and 95th percentile, in milliseconds. */
    p50: number;
    p95: number;
}

/** Stage, then provider (for `total`, the hearing and the speaking provider as "soniox>elevenlabs"). */
export type LatencySnapshot = Partial<Record<Stage, Record<string, LatencyStats>>>;

/** The value at this share of the sorted samples (nearest rank). */
function percentile(sorted: readonly number[], share: number): number {
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

export class Latency {
    private readonly series = new Map<string, { at: number; ms: number }[]>();

    /** One timed step. Nothing that is not a finite, sensible time is kept. */
    record(stage: Stage, provider: string, ms: number, now: number = Date.now()): void {
        if (!Number.isFinite(ms) || ms < 0 || ms > LATENCY_WINDOW_MS) return;
        const key = `${stage}\n${provider.slice(0, 80)}`;
        let samples = this.series.get(key);
        if (!samples) {
            if (this.series.size >= MAX_SERIES) return;
            this.series.set(key, (samples = []));
        }
        samples.push({ at: now, ms: Math.round(ms) });
        if (samples.length > MAX_SAMPLES) samples.shift();
    }

    /** Medians and 95th percentiles of what happened in the last ten minutes. A stage nobody timed is left out. */
    snapshot(now: number = Date.now()): LatencySnapshot {
        const out: LatencySnapshot = {};
        for (const [key, samples] of this.series) {
            const recent = samples.filter((sample) => now - sample.at <= LATENCY_WINDOW_MS);
            // What fell out of the window is let go
            if (recent.length !== samples.length) {
                if (recent.length === 0) this.series.delete(key);
                else this.series.set(key, recent);
            }
            if (recent.length === 0) continue;
            const [stage, provider] = key.split('\n') as [Stage, string];
            const sorted = recent.map((sample) => sample.ms).sort((a, b) => a - b);
            (out[stage] ??= {})[provider] = { samples: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
        }
        return out;
    }
}
