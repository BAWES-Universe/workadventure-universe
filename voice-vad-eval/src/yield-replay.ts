// Replays today's rule and the three candidate behaviours on IDENTICAL inputs, through the worker's own code: the
// unchanged Recognition class and the real YieldControl (voice-worker/src/yieldControl.ts). The bot is taken to be
// speaking throughout every clip. Simulated time: every timer and clock the worker's code reads runs on a simulated
// clock, so 7,000 clips replay in minutes and every run gives the same numbers.
//
// What stands in, and what that means for the numbers:
//   - The speech detector: the SAME Silero probabilities as the offline evaluation (results/raw.jsonl.gz, one per
//     32 ms window), each answered 10 ms after its last sample arrives. The rule is the observer's (p>=0.5 for 64 ms,
//     96 ms gaps forgiven). No falling behind, no failures: those paths are covered by the worker's own tests.
//   - The speech-to-text provider: SCRIPTED, not a real one. Speech clips: one word per 300 ms of audio sent, the
//     clip's own word for a command ("stop", "no" ...), final 300 ms after a 1.8 s pause (Soniox's fallback). Noise
//     clips: run twice, once with a provider that hears nothing (a successful empty result) and once with one that hears
//     words in anything (background speech transcribed). Mocked accurate transcripts test the logic only; claims about
//     how a real provider rescues a missed interruption need recorded provider timing.
//   - The speaker: a recorder of what the bot's voice did (paused, turned down, stopped, went on).
// Clips are followed by 8 s of silence so every stretch can end.
//   tsx src/yield-replay.ts <data dir> <raw.jsonl.gz> <out dir> [report|all]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildManifest, type Item } from './fixtures.ts';

// ---- Simulated time, installed before any of the worker's code runs ----
interface SimTimer {
    id: number;
    at: number;
    fn: () => void;
    every?: number;
}
const sim = {
    now: 0,
    seq: 0,
    timers: new Map<number, SimTimer>(),
    handle(timer: SimTimer) {
        return { id: timer.id, unref() {}, ref() {}, hasRef: () => false, refresh() {}, [Symbol.toPrimitive]: () => timer.id };
    },
    advanceTo(to: number) {
        for (;;) {
            let next: SimTimer | undefined;
            for (const t of sim.timers.values()) if (t.at <= to && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
            if (!next) break;
            sim.now = next.at;
            if (next.every) next.at += next.every;
            else sim.timers.delete(next.id);
            next.fn();
        }
        sim.now = to;
    },
    reset() {
        sim.now = 0;
        sim.timers.clear();
    },
};
const g = globalThis as unknown as Record<string, unknown>;
g.setTimeout = (fn: () => void, ms = 0) => {
    const timer = { id: ++sim.seq, at: sim.now + Math.max(1, ms), fn };
    sim.timers.set(timer.id, timer);
    return sim.handle(timer);
};
g.setInterval = (fn: () => void, ms = 0) => {
    const timer = { id: ++sim.seq, at: sim.now + Math.max(1, ms), fn, every: Math.max(1, ms) };
    sim.timers.set(timer.id, timer);
    return sim.handle(timer);
};
g.clearTimeout = g.clearInterval = (h: { id?: number } | undefined) => {
    if (h?.id !== undefined) sim.timers.delete(h.id);
};
Object.defineProperty(performance, 'now', { value: () => sim.now, configurable: true });

const { Counters } = await import('../../voice-worker/src/counters.ts');
const { Recognition } = await import('../../voice-worker/src/recognition.ts');
const { YieldControl } = await import('../../voice-worker/src/yieldControl.ts');
type SessionObserver = import('../../voice-worker/src/speechObserver.ts').SessionObserver;
type RecognizerFactory = import('../../voice-worker/src/recognizer.ts').RecognizerFactory;

const RATE = 16000;
const FRAME = 320;
const WINDOW_MS = 32;
const ANSWER_MS = 10;
const TAIL_MS = 8000;
const PROVIDER_PAUSE_MS = 1800;
const FINAL_DELAY_MS = 300;
const ON = 0.5;
const OFF = 0.35;
const MIN_MS = 64;
const GAP_MS = 96;

export type Policy = 'today' | 'confirm' | 'hold' | 'dip';
const POLICIES: Policy[] = ['today', 'confirm', 'hold', 'dip'];
type Provider = 'empty' | 'words';

/** The detector, answering from precomputed probabilities as simulated time passes. */
class ReplayDetector implements SessionObserver {
    private answered = 0;
    private evidence = 0;
    private gap = 0;
    private quiet = 0;
    private answeredAt = -Infinity;
    private asks: { go: (fallback: boolean) => void; live: boolean }[] = [];
    constructor(private readonly probs: Float32Array) {}

    /** Answers every window whose last sample arrived by `now - ANSWER_MS`. */
    catchUp(now: number): void {
        while (((this.answered + 1) * WINDOW_MS) + ANSWER_MS <= now) {
            const p = this.answered < this.probs.length ? this.probs[this.answered] : 0.01;
            this.answered++;
            this.answeredAt = this.answered * WINDOW_MS;
            if (p >= ON) {
                this.evidence += WINDOW_MS;
                this.gap = 0;
                this.quiet = 0;
            } else {
                this.gap += WINDOW_MS;
                if (this.gap > GAP_MS) this.evidence = 0;
                this.quiet = p < OFF ? this.quiet + WINDOW_MS : 0;
            }
            if (this.evidence >= MIN_MS) {
                const asks = this.asks.splice(0);
                for (const ask of asks) if (ask.live) ask.go(false);
            }
        }
    }

    frame(): void {}
    drop(): void {}
    baseline(): void {}
    close(): void {}
    confirm(_: string, __: number, go: (fallback: boolean) => void): () => void {
        if (this.evidence >= MIN_MS) {
            go(false);
            return () => undefined;
        }
        const ask = { go, live: true };
        this.asks.push(ask);
        return () => (ask.live = false);
    }
    heard(): { ageMs: number; quietMs: number; speech: boolean } | undefined {
        if (this.answeredAt === -Infinity) return undefined;
        return { ageMs: sim.now - this.answeredAt, quietMs: this.quiet, speech: this.evidence >= MIN_MS };
    }
}

/** A scripted provider: words (one per 300 ms of audio sent, `word` for a command clip) or nothing at all. */
function provider(kind: Provider, word: string | undefined): RecognizerFactory {
    return (events) => {
        let heardMs = 0;
        let shown = 0;
        const text = (n: number) => (word ? word : Array.from({ length: n }, () => 'word').join(' '));
        return {
            pauseMs: PROVIDER_PAUSE_MS,
            push: (pcm) => {
                if (kind === 'empty') return;
                heardMs += pcm.length / 16;
                const n = Math.floor(heardMs / 300);
                if (n > shown) {
                    shown = n;
                    events.partial(text(n));
                }
            },
            finish: () => {
                setTimeout(() => events.final(kind === 'empty' || shown === 0 ? '' : text(shown)), FINAL_DELAY_MS);
            },
            close: () => undefined,
        };
    };
}

interface Outcome {
    /** When the bot's voice first changed for the person (stopped, paused or turned down), ms into the clip. */
    yieldAt?: number;
    /** When it stopped for good, ms into the clip. */
    stopAt?: number;
    pauses: number;
    heldMs: number;
    resumes: number;
    /** What ended each pause: the control's own counters (confirmed_detector, watchdog ...). */
    why: Record<string, number>;
}

function replay(pcm: Int16Array, probs: Float32Array, policy: Policy, kind: Provider, word: string | undefined): Outcome {
    sim.reset();
    const outcome: Outcome = { pauses: 0, heldMs: 0, resumes: 0, why: {} };
    let state: 'playing' | 'held' | 'dipped' | 'stopped' = 'playing';
    let heldFrom = 0;
    const yielded = () => (outcome.yieldAt ??= sim.now);
    const stop = (): boolean => {
        if (state === 'stopped') return false;
        if (state === 'held') outcome.heldMs += sim.now - heldFrom;
        state = 'stopped';
        outcome.stopAt = sim.now;
        yielded();
        return true;
    };
    const detector = new ReplayDetector(probs);
    const counters = new Counters();
    const control =
        policy === 'today'
            ? undefined
            : new YieldControl({
                  policy,
                  counters,
                  observer: detector,
                  speaker: {
                      get playingId() {
                          return state === 'stopped' ? undefined : 'r1';
                      },
                      hold: () => {
                          if (state === 'playing') {
                              state = 'held';
                              heldFrom = sim.now;
                              outcome.pauses++;
                              yielded();
                          }
                          return 'r1';
                      },
                      resume: () => {
                          if (state !== 'held') return false;
                          outcome.heldMs += sim.now - heldFrom;
                          outcome.resumes++;
                          state = 'playing';
                          return true;
                      },
                      setGain: (gain) => {
                          if (state === 'stopped') return;
                          if (gain < 1 && state === 'playing') {
                              state = 'dipped';
                              outcome.pauses++;
                              yielded();
                          } else if (gain >= 1 && state === 'dipped') {
                              state = 'playing';
                          }
                      },
                  },
              });
    if (control) control.onStopHeld = () => void stop();
    const recognition = new Recognition({
        factory: provider(kind, word),
        maxUtteranceMs: 180000,
        counters,
        send: () => undefined,
        bargeInMs: 100,
        ...(control ? { interruptions: control } : {}),
        onSpeaking: (_, stopVoice) => {
            if (stopVoice) stop();
        },
    });
    const total = pcm.length + (TAIL_MS * RATE) / 1000;
    const silence = new Int16Array(FRAME);
    for (let at = 0; at + FRAME <= total; at += FRAME) {
        const frame = at + FRAME <= pcm.length ? pcm.subarray(at, at + FRAME) : silence;
        const end = ((at + FRAME) * 1000) / RATE;
        sim.advanceTo(end);
        recognition.sink({ participantId: 'p', epoch: 1, pcm16k: frame, droppedMs: 0 });
        detector.catchUp(end);
    }
    sim.advanceTo(sim.now + 1);
    if (state === 'held') outcome.heldMs += sim.now - heldFrom;
    control?.close();
    recognition.dispose();
    sim.reset();
    for (const [name, value] of Object.entries(counters.snapshot() as Record<string, number>)) {
        if (/^yield_(confirmed_|watchdog|reply_gone|person_gone|stops_held)/.test(name) && value) outcome.why[name.slice(6)] = value;
    }
    return outcome;
}

// ---- Run ----
const [data, rawPath, out, which = 'report'] = process.argv.slice(2);
if (!data || !rawPath || !out) throw new Error('usage: yield-replay.ts <data dir> <raw.jsonl.gz> <out dir> [report|all]');
mkdirSync(out, { recursive: true });
const probsById = new Map<string, Float32Array>();
for (const line of gunzipSync(readFileSync(rawPath)).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const raw = JSON.parse(line) as { id: string; probs: string };
    const bytes = Buffer.from(raw.probs, 'base64');
    probsById.set(raw.id, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
}
const manifest = buildManifest(data)
    .filter((item) => which === 'all' || item.split === 'report')
    .slice(0, Number(process.env.REPLAY_LIMIT ?? Infinity));
const ARABIC: Record<string, string> = { stop: 'توقف', cancel: 'الغاء', close: 'اغلق', ok: 'تمام', yes: 'نعم', no: 'لا' };
const wordOf = (item: Item): string | undefined => (item.set === 'en-command' ? item.label : item.set === 'ar-command' ? ARABIC[item.label] : undefined);

const rows: string[] = [];
let done = 0;
for (const item of manifest) {
    const probs = probsById.get(item.id);
    if (!probs) throw new Error(`no probabilities for ${item.id}`);
    const built = item.build();
    const providers: Provider[] = item.kind === 'speech' ? ['words'] : ['empty', 'words'];
    for (const kind of providers) {
        const result: Record<string, Outcome> = {};
        for (const policy of POLICIES) result[policy] = replay(built.pcm, probs, policy, kind, wordOf(item));
        rows.push(
            JSON.stringify({
                id: item.id,
                kind: item.kind,
                set: item.set,
                label: item.label,
                condition: item.condition,
                provider: kind,
                seconds: built.pcm.length / RATE,
                onsetMs: built.onset !== undefined ? Math.round(built.onset * 1000) : undefined,
                result,
            })
        );
    }
    if (++done % 500 === 0) console.error(`${done}/${manifest.length}`);
}
writeFileSync(join(out, 'yield-replay.jsonl'), rows.join('\n') + '\n');
console.error(`done: ${done} clips, ${rows.length} rows`);
