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
// Splits: `tune` picks settings (the quiet window), `report` is run once, after the pick is frozen. They are checked to be
// disjoint (no clip, recording or contributor on both sides) before anything runs.
//   tsx src/yield-replay.ts <data dir> <raw.jsonl.gz> <out dir> <tune|report|all> [quiet window ms, default the worker's]
// Writes <out>/yield-replay-<split>-<window>.jsonl: one row per clip and provider, with each behaviour's timeline.
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

type Provider = 'empty' | 'words' | 'recorded';
/** One Soniox stream as the real-provider run recorded it (soniox-record.ts): ms from the start of the clip. */
interface RecordedStream {
    openAt: number;
    finishAt?: number;
    events: [number, 'partial' | 'endpoint' | 'final' | 'failed', string?, number?][];
}

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
    heard(): { ageMs: number; quietMs: number; speech: boolean; stream: number; droppedMs: number } | undefined {
        if (this.answeredAt === -Infinity) return undefined;
        // One unbroken view for the whole clip: nothing is dropped in the replay
        return { ageMs: sim.now - this.answeredAt, quietMs: this.quiet, speech: this.evidence >= MIN_MS, stream: 1, droppedMs: 0 };
    }
}

/**
 * The recorded provider: the n-th stream the replay opens in a clip says what the n-th recorded stream said, at the same
 * time after it opened (partials, endpoint, a failure) or after it was told the audio ended (the final words). A stream
 * the recording has no counterpart for hears nothing.
 */
let streamsWithoutRecording = 0;
function recordedProvider(streams: RecordedStream[]): RecognizerFactory {
    let n = 0;
    return (events) => {
        const rec = streams[n++];
        if (!rec) streamsWithoutRecording++;
        const openedAt = sim.now;
        let done = false;
        const say = (e: RecordedStream['events'][number]) => {
            if (done) return;
            if (e[1] === 'partial') events.partial(e[2] ?? '');
            else if (e[1] === 'endpoint') events.endpoint?.();
            else if (e[1] === 'final') (done = true), events.final(e[2] ?? '');
            else (done = true), events.failed(e[2] ?? '', e[3] === undefined || e[3] === null ? undefined : { status: e[3] });
        };
        const afterFinish = (e: RecordedStream['events'][number]) => rec?.finishAt !== undefined && e[0] >= rec.finishAt && (e[1] === 'final' || e[1] === 'failed');
        if (rec) for (const e of rec.events) if (!afterFinish(e)) setTimeout(() => say(e), Math.max(1, e[0] - rec.openAt));
        return {
            pauseMs: PROVIDER_PAUSE_MS,
            push: () => undefined,
            finish: () => {
                const last = rec?.events.filter(afterFinish) ?? [];
                if (!rec || !last.length) setTimeout(() => say([0, 'final', '']), FINAL_DELAY_MS);
                for (const e of last) setTimeout(() => say(e), Math.max(1, e[0] - rec.finishAt!));
            },
            close: () => {
                done = true;
            },
        };
    };
}

/**
 * A scripted provider: words (one per 300 ms of audio sent, `word` for a command clip) or nothing at all. On a speech clip
 * it counts only audio from the person's onset on: background before they start never turns into their words.
 */
function provider(kind: Provider, word: string | undefined, fromMs: number): RecognizerFactory {
    return (events) => {
        let heardMs = 0;
        let shown = 0;
        const text = (n: number) => (word ? word : Array.from({ length: n }, () => 'word').join(' '));
        return {
            pauseMs: PROVIDER_PAUSE_MS,
            push: (pcm) => {
                if (kind === 'empty' || sim.now < fromMs) return;
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

/** What the bot's voice did, and how each watched stretch ended, ms into the clip. */
export type Event = [number, 'pause' | 'dip' | 'up' | 'resume' | 'continue' | 'stop' | `ended_${string}`];
interface Outcome {
    /** When the bot's voice first changed for the person (stopped, paused or turned down), ms into the clip. */
    yieldAt?: number;
    /** When it stopped for good, ms into the clip. */
    stopAt?: number;
    pauses: number;
    heldMs: number;
    resumes: number;
    continues: number;
    /** Simulated time covered: the clip and its silent tail. */
    spanMs: number;
    events: Event[];
    /** What ended it: the control's own counters (confirmed_detector, watchdog ...). */
    why: Record<string, number>;
}

/** today: the gate stops at once. strict: pause, go on only after an empty result. hold: strict plus going on, watched, over steady noise. */
export type Behaviour = 'today' | 'confirm' | 'dip' | 'strict' | 'hold';
export const BEHAVIOURS: Behaviour[] = ['today', 'confirm', 'dip', 'strict', 'hold'];

function replay(pcm: Int16Array, probs: Float32Array, behaviour: Behaviour, kind: Provider, word: string | undefined, onsetMs: number, silenceMs: number | undefined, recorded?: RecordedStream[]): Outcome {
    sim.reset();
    const outcome: Outcome = { pauses: 0, heldMs: 0, resumes: 0, continues: 0, spanMs: 0, events: [], why: {} };
    let state: 'playing' | 'held' | 'dipped' | 'stopped' = 'playing';
    let heldFrom = 0;
    const log = (what: Event[1]) => outcome.events.push([Math.round(sim.now), what]);
    const yielded = () => (outcome.yieldAt ??= sim.now);
    const stop = (): boolean => {
        if (state === 'stopped') return false;
        if (state === 'held') outcome.heldMs += sim.now - heldFrom;
        state = 'stopped';
        outcome.stopAt = sim.now;
        log('stop');
        yielded();
        return true;
    };
    const detector = new ReplayDetector(probs);
    const counters = new Counters();
    const policy = behaviour === 'strict' ? 'hold' : behaviour;
    const control =
        policy === 'today'
            ? undefined
            : new YieldControl({
                  policy,
                  counters,
                  observer: detector,
                  ...(silenceMs !== undefined ? { silenceMs } : {}),
                  provisional: behaviour === 'hold',
                  speaker: {
                      get playingId() {
                          return state === 'stopped' ? undefined : 'r1';
                      },
                      hold: () => {
                          if (state === 'playing') {
                              state = 'held';
                              heldFrom = sim.now;
                              outcome.pauses++;
                              log('pause');
                              yielded();
                          }
                          return 'r1';
                      },
                      resume: () => {
                          if (state !== 'held') return false;
                          outcome.heldMs += sim.now - heldFrom;
                          // The control counts which it is just before it lets the voice go on
                          const going = counters.get('yield_continues') > outcome.continues;
                          if (going) outcome.continues++;
                          else outcome.resumes++;
                          log(going ? 'continue' : 'resume');
                          state = 'playing';
                          return true;
                      },
                      setGain: (gain) => {
                          if (state === 'stopped') return;
                          if (gain < 1 && state === 'playing') {
                              state = 'dipped';
                              outcome.pauses++;
                              log('dip');
                              yielded();
                          } else if (gain >= 1 && state === 'dipped') {
                              outcome.resumes++;
                              log('up');
                              state = 'playing';
                          }
                      },
                  },
              });
    if (control) control.onStopHeld = () => void stop();
    // The worker's control, with how each watched stretch ended noted on the timeline
    const watched = control && {
        owns: (participantId: string) => control.owns(participantId),
        loud: (turn: Parameters<typeof control.loud>[0], speech: Parameters<typeof control.loud>[1]) => control.loud(turn, speech),
        words: (turnId: string, text: string) => control.words(turnId, text),
        missing: (turnId: string, ms: number) => control.missing(turnId, ms),
        ended: (turnId: string, how: Parameters<typeof control.ended>[1]) => {
            log(`ended_${how}`);
            control.ended(turnId, how);
        },
    };
    const recognition = new Recognition({
        factory: kind === 'recorded' ? recordedProvider(recorded ?? []) : provider(kind, word, onsetMs),
        maxUtteranceMs: 180000,
        counters,
        send: () => undefined,
        bargeInMs: 100,
        ...(watched ? { interruptions: watched } : {}),
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
    outcome.spanMs = Math.round(sim.now);
    if (state === 'held') outcome.heldMs += sim.now - heldFrom;
    control?.close();
    recognition.dispose();
    sim.reset();
    for (const [name, value] of Object.entries(counters.snapshot() as Record<string, number>)) {
        if (/^yield_(confirmed_|watchdog|reply_gone|person_gone|stops_held|continuing_|repauses)/.test(name) && value) outcome.why[name.slice(6)] = value;
    }
    return outcome;
}

// ---- Run ----
const [data, rawPath, out, which, windowArg, recordPath] = process.argv.slice(2);
if (!data || !rawPath || !out || !['tune', 'report', 'all', 'recorded'].includes(which ?? '') || (which === 'recorded' && !recordPath))
    throw new Error('usage: yield-replay.ts <data dir> <raw.jsonl.gz> <out dir> <tune|report|all> [quiet window ms]\n   or: yield-replay.ts <data dir> <played raw.jsonl.gz> <out dir> recorded <quiet window ms> <soniox-record.jsonl>');
const silenceMs = windowArg === undefined ? undefined : Number(windowArg);
if (silenceMs !== undefined && !(silenceMs > 0)) throw new Error(`not a quiet window: ${windowArg}`);
mkdirSync(out, { recursive: true });
const probsById = new Map<string, Float32Array>();
for (const line of gunzipSync(readFileSync(rawPath)).toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    const raw = JSON.parse(line) as { id: string; probs: string };
    const bytes = Buffer.from(raw.probs, 'base64');
    probsById.set(raw.id, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
}
const everything = buildManifest(data);
// The halves must not share a clip, a recording, or (commands) a contributor
const sides = new Map<string, Set<string>>();
const side = (key: string, split: string) => sides.set(key, (sides.get(key) ?? new Set()).add(split));
for (const item of everything) {
    side(`id:${item.id}`, item.split);
    side(`source:${item.source}`, item.split);
    if (item.speaker) side(`speaker:${item.set}/${item.speaker}`, item.split);
}
const crossing = [...sides].filter(([, s]) => s.size > 1).map(([k]) => k);
if (crossing.length) throw new Error(`the tune and report halves overlap: ${crossing.slice(0, 5).join(', ')}`);
if (new Set(everything.map((i) => i.id)).size !== everything.length) throw new Error('duplicate clip ids');
if (which === 'recorded') {
    // The real-provider run: its clips, the audio as it was played, and what Soniox said when
    const { audioOf } = await import('./played.ts');
    const records = readFileSync(recordPath!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; group: string; leadExtraMs: number; streams: RecordedStream[] });
    const byId = new Map(everything.map((i) => [i.id, i]));
    const rows: string[] = [];
    for (const rec of records) {
        const item = byId.get(rec.id);
        const probs = probsById.get(rec.id);
        if (!item || !probs) throw new Error(`missing clip or probabilities for ${rec.id}`);
        if (item.split !== 'report') throw new Error(`not a report-half clip: ${rec.id}`);
        const played = audioOf(item);
        const result: Record<string, Outcome> = {};
        for (const behaviour of BEHAVIOURS) result[behaviour] = replay(played.pcm, probs, behaviour, 'recorded', undefined, played.onsetMs ?? 0, silenceMs, rec.streams);
        rows.push(JSON.stringify({ id: item.id, kind: item.kind, set: item.set, label: item.label, condition: item.condition, split: item.split, group: rec.group, provider: 'recorded', seconds: played.pcm.length / RATE, onsetMs: played.onsetMs, offsetMs: played.offsetMs, leadExtraMs: played.leadExtraMs, result }));
    }
    writeFileSync(join(out, `yield-replay-recorded-${silenceMs ?? 'default'}.jsonl`), rows.join('\n') + '\n');
    console.error(`done: ${rows.length} recorded clips; streams opened in the replay with no recorded counterpart: ${streamsWithoutRecording} (over all behaviours)`);
    process.exit(0);
}
const stride = Number(process.env.REPLAY_STRIDE ?? 1);
const manifest = everything
    .filter((item) => which === 'all' || item.split === which)
    .filter((_, i) => i % stride === 0)
    .slice(0, Number(process.env.REPLAY_LIMIT ?? Infinity));
const counts = (split: string) => everything.filter((i) => i.split === split).length;
console.error(`halves: tune ${counts('tune')}, report ${counts('report')}, disjoint; replaying ${which}: ${manifest.length} clips, quiet window ${silenceMs ?? 'default'}`);
const ARABIC: Record<string, string> = { stop: 'توقف', cancel: 'الغاء', close: 'اغلق', ok: 'تمام', yes: 'نعم', no: 'لا' };
const wordOf = (item: Item): string | undefined => (item.set === 'en-command' ? item.label : item.set === 'ar-command' ? ARABIC[item.label] : undefined);

const rows: string[] = [];
let done = 0;
for (const item of manifest) {
    const probs = probsById.get(item.id);
    if (!probs) throw new Error(`no probabilities for ${item.id}`);
    const built = item.build();
    const onsetMs = built.onset !== undefined ? Math.round(built.onset * 1000) : undefined;
    const offsetMs = built.offset !== undefined ? Math.round(built.offset * 1000) : undefined;
    const providers: Provider[] = item.kind === 'speech' ? ['words'] : ['empty', 'words'];
    for (const kind of providers) {
        const result: Record<string, Outcome> = {};
        for (const behaviour of BEHAVIOURS) result[behaviour] = replay(built.pcm, probs, behaviour, kind, wordOf(item), onsetMs ?? 0, silenceMs);
        rows.push(
            JSON.stringify({
                id: item.id,
                kind: item.kind,
                set: item.set,
                label: item.label,
                condition: item.condition,
                split: item.split,
                provider: kind,
                seconds: built.pcm.length / RATE,
                onsetMs,
                offsetMs,
                result,
            })
        );
    }
    if (++done % 500 === 0) console.error(`${done}/${manifest.length}`);
}
const name = `yield-replay-${which}-${silenceMs ?? 'default'}.jsonl`;
writeFileSync(join(out, name), rows.join('\n') + '\n');
console.error(`done: ${done} clips, ${rows.length} rows -> ${name}`);
