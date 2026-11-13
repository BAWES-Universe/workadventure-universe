// Part 1 check 1: no skipped or repeated words. The pause changes what the bot's VOICE does; it must never change what
// the bot HEARS. Random scenarios (two or three people talking, noise, audio dropping, someone leaving and coming back,
// the bot speaking in turns) go through the worker's own Recognition twice, on identical input and simulated time:
// once as today (no control) and once with the real YieldControl on (the pause as shipped, with going on over steady noise).
// Every frame of audio carries a tag (who, which frame) in its first samples, and the scripted provider answers with
// the tags it received, so a "word" is exactly one frame of one person's audio. Then, per person:
//   - no word twice, none out of order, in either run;
//   - everything delivered to the bot in one run (every user.turn: outcome and words) is identical in the other.
// Stand-ins: the provider (scripted: it hears whatever frames reach it), the detector (judges by pitch: low = speech,
// high = noise; says what the real one's interface says: fresh, quiet for how long, a stream number that breaks when audio
// goes missing), and the speaker (a recorder of pause, go on, stop). The real Recognition and YieldControl run unchanged.
//   tsx src/words-fuzz.ts <scenarios> <out json> [first seed]
import { writeFileSync } from 'node:fs';

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
const handle = (timer: SimTimer) => ({ id: timer.id, unref() {}, ref() {}, hasRef: () => false, refresh() {}, [Symbol.toPrimitive]: () => timer.id });
const g = globalThis as unknown as Record<string, unknown>;
g.setTimeout = (fn: () => void, ms = 0) => {
    const timer = { id: ++sim.seq, at: sim.now + Math.max(1, ms), fn };
    sim.timers.set(timer.id, timer);
    return handle(timer);
};
g.setInterval = (fn: () => void, ms = 0) => {
    const timer = { id: ++sim.seq, at: sim.now + Math.max(1, ms), fn, every: Math.max(1, ms) };
    sim.timers.set(timer.id, timer);
    return handle(timer);
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

const FRAME = 320;
const FRAME_MS = 20;
const ANSWER_MS = 10;
const SPEECH_MS = 64;

const [scenariosArg, outPath, seedArg] = process.argv.slice(2);
if (!outPath) throw new Error('usage: words-fuzz.ts <scenarios> <out json> [first seed]');

/** Small seeded generator (mulberry32). */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Kind = 'silence' | 'voice' | 'noise' | 'away';
interface Frame {
    kind: Kind;
    /** Audio missing just before this frame, ms. */
    dropped: number;
}
interface Scenario {
    people: Frame[][];
    /** Frames during which the bot's reply is playing (a new reply starts at each rising edge). */
    botOn: boolean[];
    frames: number;
}

function scenario(seed: number): Scenario {
    const r = rng(seed);
    const frames = 2000 + Math.floor(r() * 1500); // 40 to 70 s
    const n = 2 + Math.floor(r() * 2);
    const people: Frame[][] = [];
    for (let p = 0; p < n; p++) {
        const line: Frame[] = [];
        while (line.length < frames) {
            const roll = r();
            const kind: Kind = roll < 0.35 ? 'silence' : roll < 0.65 ? 'voice' : roll < 0.9 ? 'noise' : 'away';
            const len = kind === 'away' ? 20 + Math.floor(r() * 120) : kind === 'voice' ? 5 + Math.floor(r() * 120) : 3 + Math.floor(r() * 160);
            for (let i = 0; i < len && line.length < frames; i++) {
                const dropped = kind !== 'away' && r() < 0.004 ? 20 * (1 + Math.floor(r() * 20)) : 0;
                line.push({ kind, dropped });
            }
        }
        people.push(line);
    }
    const botOn: boolean[] = [];
    let on = r() < 0.5;
    while (botOn.length < frames) {
        const len = on ? 100 + Math.floor(r() * 400) : 20 + Math.floor(r() * 100);
        for (let i = 0; i < len && botOn.length < frames; i++) botOn.push(on);
        on = !on;
    }
    return { people, botOn, frames };
}

/** The pitch-judging detector, behind the real interface. */
class FuzzDetector implements SessionObserver {
    private readonly speechMs = new Map<string, number>();
    private readonly quietMs = new Map<string, number>();
    private readonly stream = new Map<string, number>();
    private readonly dropped = new Map<string, number>();
    private readonly seen = new Map<string, number>();
    private readonly asks = new Map<string, { go: (fallback: boolean) => void; live: boolean }[]>();
    private readonly gone = new Set<string>();
    private key = (p: string, e: number) => `${p}/${e}`;

    feed(p: string, epoch: number, kind: Kind, droppedMs: number): void {
        const k = this.key(p, epoch);
        this.gone.delete(k);
        if (droppedMs > 0) {
            this.stream.set(k, (this.stream.get(k) ?? 1) + 1);
            this.dropped.set(k, (this.dropped.get(k) ?? 0) + droppedMs);
            this.speechMs.set(k, 0);
        }
        this.seen.set(k, sim.now);
        if (kind === 'voice') {
            this.speechMs.set(k, (this.speechMs.get(k) ?? 0) + FRAME_MS);
            this.quietMs.set(k, 0);
        } else {
            this.speechMs.set(k, 0);
            this.quietMs.set(k, (this.quietMs.get(k) ?? 0) + FRAME_MS);
        }
        if ((this.speechMs.get(k) ?? 0) >= SPEECH_MS) {
            const asks = this.asks.get(k) ?? [];
            this.asks.delete(k);
            for (const a of asks) if (a.live) a.go(false);
        }
    }
    frame(): void {}
    drop(match: (participantId: string, epoch: number) => boolean): void {
        for (const k of this.seen.keys()) {
            const [p, e] = k.split('/');
            if (match(p, Number(e))) {
                this.gone.add(k);
                for (const a of this.asks.get(k) ?? []) a.live = false;
                this.asks.delete(k);
            }
        }
    }
    baseline(): void {}
    close(): void {}
    confirm(p: string, epoch: number, go: (fallback: boolean) => void): () => void {
        const k = this.key(p, epoch);
        if ((this.speechMs.get(k) ?? 0) >= SPEECH_MS) {
            go(false);
            return () => undefined;
        }
        const ask = { go, live: true };
        this.asks.set(k, [...(this.asks.get(k) ?? []), ask]);
        return () => (ask.live = false);
    }
    heard(p: string, epoch: number): { ageMs: number; quietMs: number; speech: boolean; stream: number; droppedMs: number } | undefined {
        const k = this.key(p, epoch);
        if (!this.seen.has(k) || this.gone.has(k)) return undefined;
        return { ageMs: ANSWER_MS + (sim.now - (this.seen.get(k) ?? sim.now)), quietMs: this.quietMs.get(k) ?? 0, speech: (this.speechMs.get(k) ?? 0) >= SPEECH_MS, stream: this.stream.get(k) ?? 1, droppedMs: this.dropped.get(k) ?? 0 };
    }
}

/** A "word" is one tagged frame: person, frame index. */
const tag = (pcm: Int16Array): string => `${(pcm[0] & 7) - 1}.${pcm[1] + (pcm[2] << 6) + (pcm[3] << 12)}`;
/** The scripted provider hears people, not noise: only frames of a voice become words (noise is heard as nothing). */
const isVoice = (pcm: Int16Array): boolean => (pcm[0] & 8) === 0;
function provider(): RecognizerFactory {
    return (events) => {
        const words: string[] = [];
        let done = false;
        return {
            pauseMs: 1800,
            push: (pcm) => {
                if (done) return;
                // The whole stretch of audio given to this recogniser is a run of whole frames
                const before = words.length;
                for (let at = 0; at + FRAME <= pcm.length; at += FRAME) if (isVoice(pcm.subarray(at, at + FRAME))) words.push(tag(pcm.subarray(at, at + FRAME)));
                if (words.length > before && words.length % 15 === 0) events.partial(words.join(' '));
            },
            finish: () => {
                if (done) return;
                done = true;
                setTimeout(() => events.final(words.join(' ')), 300);
            },
            close: () => {
                done = true;
            },
        };
    };
}

function pcmFor(kind: Kind, who: number, index: number, phase: { v: number }): Int16Array {
    const out = new Int16Array(FRAME);
    if (kind === 'voice' || kind === 'noise') {
        const hz = kind === 'voice' ? 200 : 1200;
        for (let i = 0; i < FRAME; i++) {
            out[i] = Math.round(8000 * Math.sin(phase.v));
            phase.v += (2 * Math.PI * hz) / 16000;
        }
    }
    out[0] = who + 1 + (kind === 'voice' ? 0 : 8);
    out[1] = index & 0x3f;
    out[2] = (index >> 6) & 0x3f;
    out[3] = (index >> 12) & 0x3f;
    return out;
}

interface Delivered {
    outcome: string;
    text: string;
}
interface Run {
    perPerson: Record<string, Delivered[]>;
    sent: Record<string, number>;
    stops: number;
    holds: number;
    continues: number;
    resumes: number;
}

function run(s: Scenario, withPause: boolean): Run {
    sim.reset();
    const counters = new Counters();
    const detector = new FuzzDetector();
    let replySerial = 0;
    let state: 'idle' | 'playing' | 'held' | 'stopped' = 'idle';
    let holds = 0;
    let stops = 0;
    const speaker = {
        get playingId() {
            return state === 'playing' || state === 'held' ? `r${replySerial}` : undefined;
        },
        hold: () => {
            if (state === 'playing') {
                state = 'held';
                holds++;
            }
            return `r${replySerial}`;
        },
        resume: () => {
            if (state !== 'held') return false;
            state = 'playing';
            return true;
        },
        setGain: () => undefined,
    };
    const stop = (): boolean => {
        if (state === 'stopped' || state === 'idle') return false;
        state = 'stopped';
        stops++;
        return true;
    };
    const control = withPause ? new YieldControl({ policy: 'hold', counters, observer: detector, speaker, provisional: true }) : undefined;
    if (control) control.onStopHeld = () => void stop();
    const delivered: Record<string, Delivered[]> = {};
    const recognition = new Recognition({
        factory: provider(),
        maxUtteranceMs: 180000,
        counters,
        send: (m) => {
            if (m.type === 'user.turn') {
                const mm = m as unknown as { participantId: string; outcome: string; text?: string };
                (delivered[mm.participantId] ??= []).push({ outcome: mm.outcome, text: mm.text ?? '' });
            }
        },
        bargeInMs: 100,
        ...(control ? { interruptions: control } : {}),
        onSpeaking: (_, stopVoice) => {
            if (stopVoice) stop();
        },
    });
    const n = s.people.length;
    const epoch = Array.from({ length: n }, () => 1);
    const was: Kind[] = Array.from({ length: n }, () => 'silence');
    const index = Array.from({ length: n }, () => 0);
    const phase = Array.from({ length: n }, () => ({ v: 0 }));
    const sent: Record<string, number> = {};
    let botWas = false;
    for (let f = 0; f < s.frames; f++) {
        const end = (f + 1) * FRAME_MS;
        sim.advanceTo(end);
        const on = s.botOn[f];
        if (on && !botWas) {
            replySerial++;
            state = 'playing';
        }
        if (!on && botWas && (state === 'playing' || state === 'held')) state = 'idle';
        botWas = on;
        for (let p = 0; p < n; p++) {
            const fr = s.people[p][f];
            const id = `p${p}`;
            if (fr.kind === 'away') {
                if (was[p] !== 'away') {
                    recognition.interrupt(id, epoch[p], 'lost');
                    detector.drop((pid, e) => pid === id && e === epoch[p]);
                }
                was[p] = 'away';
                continue;
            }
            if (was[p] === 'away') epoch[p]++;
            was[p] = fr.kind;
            const pcm = pcmFor(fr.kind, p, index[p]++, phase[p]);
            sent[id] = (sent[id] ?? 0) + 1;
            detector.feed(id, epoch[p], fr.kind, fr.dropped);
            // FUZZ_BREAK=1 is the self-test: the pause run loses one frame in 700, which the check must catch
            if (process.env.FUZZ_BREAK && withPause && index[p] % 700 === 0) continue;
            recognition.sink({ participantId: id, epoch: epoch[p], pcm16k: pcm, droppedMs: fr.dropped });
        }
    }
    sim.advanceTo(sim.now + 10000);
    const result: Run = { perPerson: delivered, sent, stops, holds, continues: counters.get('yield_continues'), resumes: counters.get('yield_resumes') };
    control?.close();
    recognition.dispose();
    sim.reset();
    return result;
}

function wordsOf(d: Delivered[]): string[] {
    return d.flatMap((x) => x.text.split(' ').filter(Boolean));
}
/** Fails (returns a reason) if a word is repeated or out of order within one person's deliveries. */
function orderProblem(words: string[]): string | undefined {
    let last = -1;
    for (const w of words) {
        // A text is cut at 8,000 characters by the worker itself (today too): a cut word is not a word
        if (!/^\d\.\d+$/.test(w)) continue;
        const idx = Number(w.split('.')[1]);
        if (idx <= last) return `${w} after ${last}`;
        last = idx;
    }
    return undefined;
}

const total = Number(scenariosArg);
const first = Number(seedArg ?? 1);
const problems: string[] = [];
let words = 0;
let holds = 0;
let continues = 0;
let resumes = 0;
let stops = 0;
let turns = 0;
for (let seed = first; seed < first + total; seed++) {
    const s = scenario(seed);
    const today = run(s, false);
    const pause = run(s, true);
    holds += pause.holds;
    continues += pause.continues;
    resumes += pause.resumes;
    stops += pause.stops;
    for (const id of Object.keys({ ...today.perPerson, ...pause.perPerson })) {
        const a = today.perPerson[id] ?? [];
        const b = pause.perPerson[id] ?? [];
        turns += b.length;
        words += wordsOf(b).length;
        const pa = orderProblem(wordsOf(a));
        const pb = orderProblem(wordsOf(b));
        if (pa) problems.push(`seed ${seed} ${id}: today repeats or reorders: ${pa}`);
        if (pb) problems.push(`seed ${seed} ${id}: pause repeats or reorders: ${pb}`);
        if (JSON.stringify(a) !== JSON.stringify(b)) {
            const wa = wordsOf(a);
            const wb = wordsOf(b);
            problems.push(`seed ${seed} ${id}: delivered differ: today ${a.length} turns / ${wa.length} words, pause ${b.length} turns / ${wb.length} words`);
        }
    }
}
const summary = { scenarios: total, firstSeed: first, turnsDelivered: turns, wordsDelivered: words, pauseHolds: holds, pauseResumesAfterEmpty: resumes, pauseGoOnsOverSteadyNoise: continues, replyStops: stops, problems: problems.length, firstProblems: problems.slice(0, 20) };
writeFileSync(outPath, JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
process.exit(problems.length ? 1 : 0);
