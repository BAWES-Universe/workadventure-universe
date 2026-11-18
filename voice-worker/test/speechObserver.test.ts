// The speech observer: an internal second listener that only counts (src/speechObserver.ts). These tests use a
// detector made here, so they need no model and no runtime. What matters most is what it must never do: keep or use
// anything from a person who is no longer heard, hold more audio than its limits, or get in the session's way.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optionsFromEnv } from '../src/config.ts';
import { Counters } from '../src/counters.ts';
import { FakeEars } from '../src/recognizer.ts';
import { VoiceWorker } from '../src/server.ts';
import { CONTEXT, type DetectorModel, SpeechObserver, type SpeechObserverSettings, STATE, WINDOW } from '../src/speechObserver.ts';
import { sileroLoader } from '../src/speechObserverRuntime.ts';
import type { InputFrame } from '../src/transport.ts';
import { FakeHuman, type Rig, privateEvent, sleep, startRig, waitFor } from './harness.ts';

interface Call {
    input: Float32Array;
    state: Float32Array;
    answer(probability?: number): void;
    fail(): void;
}

/** A detector that answers when told to (or at once), and marks each answer's state with the call's number. */
function detector(mode: 'at once' | 'held' = 'at once') {
    const calls: Call[] = [];
    let released = 0;
    const model: DetectorModel = {
        run: (input, state) =>
            new Promise((resolve, reject) => {
                const n = calls.length + 1;
                const call: Call = { input, state, answer: (probability = 0.9) => resolve({ probability, state: new Float32Array(STATE).fill(n) }), fail: () => reject(new Error('detector failed')) };
                calls.push(call);
                if (mode === 'at once') call.answer();
            }),
        release: async () => {
            released++;
        },
    };
    return { model, calls, released: () => released };
}

function observing(mode: 'at once' | 'held' = 'at once', limits: Partial<Omit<SpeechObserverSettings, 'load' | 'onVerdict'>> = {}) {
    const d = detector(mode);
    const counters = new Counters();
    const verdicts: { participantId: string; epoch: number; probability: number }[] = [];
    const observer = new SpeechObserver({ counters, load: async () => d.model, onVerdict: (v) => verdicts.push({ participantId: v.participantId, epoch: v.epoch, probability: v.probability }), ...limits });
    const session = observer.session('s1');
    let next = 0;
    /** Audio whose every sample is its own position in the person's stream (wrapped), so each window can be checked. */
    const feed = (ms: number, who = 'p1', epoch = 1, frameSamples = 320, droppedMs = 0) => {
        for (let sent = 0; sent < ms * 16; sent += frameSamples) {
            const pcm = Int16Array.from({ length: frameSamples }, () => (next++ % 30000) + 1);
            session.frame({ participantId: who, epoch, pcm16k: pcm, droppedMs: sent === 0 ? droppedMs : 0 });
        }
    };
    return { ...d, counters, observer, session, verdicts, feed };
}
const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
const allZero = (x: Float32Array): boolean => x.every((v) => v === 0);

describe('what the detector is given', () => {
    it.each([320, 160, 480, 333])('the same 512-sample windows, each with the 64 samples before it, whatever the frame size (%i)', async (frameSamples) => {
        // The whole second arrives in one go here, so the limit on waiting audio is set out of the way
        const o = observing('at once', { maxQueuedMsPerStream: 5000, maxQueuedMsTotal: 5000 });
        await o.observer.ready();
        o.feed(1000, 'p1', 1, frameSamples);
        await settle();
        const windows = Math.floor((Math.ceil(16000 / frameSamples) * frameSamples) / WINDOW);
        expect(o.calls.length).toBe(windows);
        for (let w = 0; w < windows; w++) {
            const { input, state } = o.calls[w];
            expect(input.length).toBe(CONTEXT + WINDOW);
            // The window itself: samples w*512+1 .. (w+1)*512, as fractions
            expect(input[CONTEXT]).toBeCloseTo((w * WINDOW + 1) / 32768, 6);
            expect(input[CONTEXT + WINDOW - 1]).toBeCloseTo(((w + 1) * WINDOW) / 32768, 6);
            // Its context is the end of the window before, and its state is what the call before returned
            if (w === 0) {
                expect(allZero(input.subarray(0, CONTEXT))).toBe(true);
                expect(allZero(state)).toBe(true);
            } else {
                expect(input[0]).toBeCloseTo((w * WINDOW - CONTEXT + 1) / 32768, 6);
                expect(state[0]).toBe(w);
            }
        }
        expect(o.counters.get('observer_windows_completed')).toBe(windows);
        expect(o.verdicts.length).toBe(windows);
    });

    it('its own copy of the audio: the frame it was handed is left as it was, and changing it later changes nothing', async () => {
        const o = observing('held');
        await o.observer.ready();
        const pcm = Int16Array.from({ length: 640 }, (_, i) => i + 1);
        const before = pcm.slice();
        o.session.frame({ participantId: 'p1', epoch: 1, pcm16k: pcm, droppedMs: 0 });
        expect([...pcm]).toEqual([...before]);
        pcm.fill(0);
        await settle();
        expect(o.calls[0].input[CONTEXT]).toBeCloseTo(1 / 32768, 6);
    });

    it('two people, and the same person in two bubbles, never share anything', async () => {
        const o = observing();
        await o.observer.ready();
        const other = o.observer.session('s2');
        o.feed(64, 'p1');
        o.feed(64, 'p2');
        for (let i = 0; i < 4; i++) other.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320).fill(5), droppedMs: 0 });
        await settle();
        // A second bot server's session that happens to carry the same id as the first is still its own
        const same = o.observer.session('s1');
        for (let i = 0; i < 4; i++) same.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320).fill(9), droppedMs: 0 });
        await settle();
        // Four streams, each one's first window starts from nothing
        expect(o.calls.length).toBe(4 + 2 + 2);
        expect(o.observer.stats().streams).toBe(4);
        expect(o.calls.filter((c) => allZero(c.state)).length).toBe(4);
        // Ending one session leaves the others alone
        same.close();
        expect(o.observer.stats().streams).toBe(3);
        o.session.drop(() => true);
        expect(o.observer.stats().streams).toBe(1);
    });
});

describe('someone who is no longer heard', () => {
    it('has their waiting audio thrown away, and an answer that comes back afterwards is not kept or counted', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(200);
        await settle();
        expect(o.calls.length).toBe(1);
        expect(o.observer.stats()).toMatchObject({ streams: 1, inFlight: 1 });
        expect(o.observer.stats().queuedMs).toBeGreaterThan(0);

        o.session.drop((participantId, epoch) => participantId === 'p1' && epoch === 1);
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0 });
        o.calls[0].answer(0.99);
        await settle();
        expect(o.verdicts).toEqual([]);
        expect(o.counters.get('observer_windows_revoked')).toBe(1);
        expect(o.counters.get('observer_speech_windows')).toBe(0);
        expect(o.counters.get('observer_firings')).toBe(0);
        // Nothing of theirs was left for the detector to go on with
        expect(o.calls.length).toBe(1);
    });

    it('starts from nothing when they are heard again, even while the old answer is still out', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(64);
        await settle();
        o.session.drop(() => true);
        // Heard again (same person, same path) before the detector has answered for the old audio
        o.feed(64);
        o.calls[0].answer();
        await settle();
        expect(o.calls.length).toBe(2);
        expect(allZero(o.calls[1].state)).toBe(true);
        expect(allZero(o.calls[1].input.subarray(0, CONTEXT))).toBe(true);
        o.calls[1].answer(0.2);
        await settle();
        expect(o.verdicts).toEqual([{ participantId: 'p1', epoch: 1, probability: 0.2 }]);
        expect(o.counters.get('observer_windows_revoked')).toBe(1);
    });

    it('a newer path replaces the old one before the old answer is back, and older audio is ignored from then on', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(40, 'p1', 1);
        await settle();
        o.feed(40, 'p1', 2);
        o.calls[0].answer();
        await settle();
        expect(o.calls.length).toBe(2);
        expect(allZero(o.calls[1].state)).toBe(true);
        o.calls[1].answer(0.7);
        await settle();
        expect(o.verdicts).toEqual([{ participantId: 'p1', epoch: 2, probability: 0.7 }]);
        // The old path sends a little more: none of it is taken
        o.feed(40, 'p1', 1);
        await settle();
        expect(o.calls.length).toBe(2);
        expect(o.counters.get('observer_stale_dropped')).toBeGreaterThan(0);
    });

    it('starts afresh after audio is known to be missing', async () => {
        const o = observing();
        await o.observer.ready();
        o.feed(64);
        await settle();
        o.feed(64, 'p1', 1, 320, 200);
        await settle();
        expect(o.calls.length).toBe(4);
        expect(allZero(o.calls[2].state)).toBe(true);
    });

    it('is forgotten when the session ends, and nothing at all is held once the worker closes', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(200, 'p1');
        o.feed(200, 'p2');
        await settle();
        o.session.close();
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0 });
        const closing = o.observer.dispose();
        o.calls[0].answer();
        await closing;
        expect(o.released()).toBe(1);
        expect(o.verdicts).toEqual([]);
        // After closing nothing is taken
        o.feed(200);
        await settle();
        expect(o.calls.length).toBe(1);
        expect(o.observer.stats()).toMatchObject({ status: 'closed', streams: 0, queuedMs: 0 });
    });
});

describe('limits', () => {
    it('holds only so much of one person\'s audio: when the detector is too slow, what waited is dropped and counted', async () => {
        const o = observing('held', { maxQueuedMsPerStream: 400 });
        await o.observer.ready();
        o.feed(10_000);
        await settle();
        expect(o.observer.stats().queuedMs).toBeLessThanOrEqual(400);
        expect(o.counters.get('observer_peak_queued_ms')).toBeLessThanOrEqual(400);
        expect(o.counters.get('observer_overflow_ms')).toBeGreaterThan(9000);
        expect(o.counters.get('observer_overloads')).toBeGreaterThan(0);
        // The answer for the window that was out when they started afresh is not kept
        o.calls[0].answer();
        await settle();
        expect(o.verdicts).toEqual([]);
    });

    it('holds only so much in all, and watches only so many people', async () => {
        const o = observing('held', { maxQueuedMsPerStream: 400, maxQueuedMsTotal: 1000, maxStreams: 5 });
        await o.observer.ready();
        for (let p = 0; p < 8; p++) o.feed(300, `p${p}`);
        await settle();
        expect(o.observer.stats().streams).toBe(5);
        expect(o.observer.stats().queuedMs).toBeLessThanOrEqual(1000);
        expect(o.counters.get('observer_streams_refused')).toBeGreaterThan(0);
        expect(o.counters.get('observer_overflow_ms')).toBeGreaterThan(0);
    });

    it('gives a detector that takes one person at a time one window at a time, people taking turns', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(200, 'p1');
        o.feed(200, 'p2');
        await settle();
        expect(o.calls.length).toBe(1);
        for (let i = 0; i < 5; i++) {
            expect(o.observer.stats().inFlight).toBe(1);
            o.calls[i].answer();
            await settle();
        }
        // The first person's second window was already waiting when the second person arrived; from then on they alternate
        expect(o.verdicts.map((v) => v.participantId)).toEqual(['p1', 'p1', 'p2', 'p1', 'p2']);
        expect(o.calls.length).toBe(6);
    });
});

/** A detector that takes several people in one call and answers each call when told to. Each answer's state is marked with the call and the place in it. */
function observingMany(limits: { maxBatch?: number; maxFailures?: number } = {}) {
    const calls: { windows: { input: Float32Array; state: Float32Array }[]; answer(count?: number): void; fail(): void }[] = [];
    const model: DetectorModel = {
        run: (input, state) => model.runMany!([{ input, state }]).then((answers) => answers[0]),
        runMany: (windows) =>
            new Promise((resolve, reject) => {
                const n = calls.length + 1;
                calls.push({
                    windows,
                    answer: (count = windows.length) => resolve(windows.slice(0, count).map((_, i) => ({ probability: 0.9, state: new Float32Array(STATE).fill(n * 100 + i) }))),
                    fail: () => reject(new Error('detector failed')),
                });
            }),
    };
    const counters = new Counters();
    const verdicts: string[] = [];
    const observer = new SpeechObserver({ counters, load: async () => model, onVerdict: (v) => verdicts.push(v.participantId), ...limits });
    const session = observer.session('s1');
    const sent = new Map<number, number>();
    /** Person n's audio: every sample is n thousand plus its own position in their stream (wrapped), so a window says whose it is and where from. */
    const feed = (person: number, ms: number) => {
        for (let done = 0; done < ms * 16; done += 320) {
            const pcm = Int16Array.from({ length: 320 }, () => {
                const at = sent.get(person) ?? 0;
                sent.set(person, at + 1);
                return person * 1000 + (at % 1000);
            });
            session.frame({ participantId: `p${person}`, epoch: 1, pcm16k: pcm, droppedMs: 0 });
        }
    };
    /** Whose window this is and where in their stream it starts, read back from its first sample. */
    const whose = (input: Float32Array) => {
        const first = Math.round(input[CONTEXT] * 32768);
        return { person: Math.floor(first / 1000), at: first % 1000 };
    };
    return { calls, counters, observer, session, verdicts, feed, whose };
}

describe('several people in one call', () => {
    it('a call carries one window from each person waiting, never two of one person, and each keeps their own state and context', async () => {
        const o = observingMany();
        await o.observer.ready();
        for (const person of [1, 2, 3]) o.feed(person, 200);
        await settle();
        // The first person's first window went out alone, before anyone else had one; only one call is ever out
        expect(o.calls.length).toBe(1);
        expect(o.calls[0].windows.map((w) => o.whose(w.input))).toEqual([{ person: 1, at: 0 }]);
        expect(o.observer.stats().inFlight).toBe(1);
        o.calls[0].answer();
        await settle();
        // Now everyone has audio waiting: one window each, in the order they joined the line
        expect(o.calls.length).toBe(2);
        expect(o.calls[1].windows.map((w) => o.whose(w.input))).toEqual([
            { person: 1, at: WINDOW },
            { person: 2, at: 0 },
            { person: 3, at: 0 },
        ]);
        expect(o.observer.stats().inFlight).toBe(3);
        expect(o.calls[1].windows[0].state.every((v) => v === 100)).toBe(true);
        expect(allZero(o.calls[1].windows[1].state)).toBe(true);
        expect(allZero(o.calls[1].windows[2].state)).toBe(true);
        // The first person's context is the end of their own first window; the others have none yet
        expect(Math.round(o.calls[1].windows[0].input[CONTEXT - 1] * 32768)).toBe(1000 + WINDOW - 1);
        expect(allZero(o.calls[1].windows[1].input.subarray(0, CONTEXT))).toBe(true);
        o.calls[1].answer();
        await settle();
        expect(o.calls[2].windows.map((w) => o.whose(w.input))).toEqual([
            { person: 1, at: (2 * WINDOW) % 1000 },
            { person: 2, at: WINDOW },
            { person: 3, at: WINDOW },
        ]);
        // Each got back the state the call before gave to them, not to a neighbour
        expect(o.calls[2].windows.map((w) => w.state[0])).toEqual([200, 201, 202]);
        expect(o.calls[2].windows.map((w) => Math.round(w.input[CONTEXT - 1] * 32768))).toEqual([1000 + ((2 * WINDOW - 1) % 1000), 2000 + WINDOW - 1, 3000 + WINDOW - 1]);
        expect(o.verdicts).toEqual(['p1', 'p1', 'p2', 'p3']);
        expect(o.counters.get('observer_calls')).toBe(2);
        expect(o.counters.get('observer_windows_completed')).toBe(4);
        expect(o.counters.get('observer_peak_batch')).toBe(3);
    });

    it('someone who stops being heard while a call is out loses only their own answer, and starts from nothing when heard again', async () => {
        const o = observingMany();
        await o.observer.ready();
        for (const person of [1, 2, 3]) o.feed(person, 200);
        await settle();
        o.calls[0].answer();
        await settle();
        expect(o.calls[1].windows.length).toBe(3);
        o.session.drop((participantId) => participantId === 'p3');
        o.feed(3, 64);
        o.calls[1].answer();
        await settle();
        expect(o.verdicts).toEqual(['p1', 'p1', 'p2']);
        expect(o.counters.get('observer_windows_revoked')).toBe(1);
        const third = o.calls[2].windows.find((w) => o.whose(w.input).person === 3)!;
        expect(allZero(third.state)).toBe(true);
        expect(allZero(third.input.subarray(0, CONTEXT))).toBe(true);
        // The others carried on from their own answers
        expect(o.calls[2].windows.filter((w) => o.whose(w.input).person !== 3).map((w) => w.state[0])).toEqual([200, 201]);
    });

    it('takes no more people in one call than it is allowed; the rest go in the next', async () => {
        const o = observingMany({ maxBatch: 2 });
        await o.observer.ready();
        for (const person of [1, 2, 3, 4]) o.feed(person, 40);
        await settle();
        o.calls[0].answer();
        await settle();
        expect(o.calls[1].windows.map((w) => o.whose(w.input).person)).toEqual([2, 3]);
        o.calls[1].answer();
        await settle();
        expect(o.calls[2].windows.map((w) => o.whose(w.input).person)).toEqual([4]);
        expect(o.counters.get('observer_peak_batch')).toBe(2);
    });

    it('a call that fails, or answers for the wrong number of people, is one failure: everyone in it starts afresh and nothing of it is kept', async () => {
        const o = observingMany({ maxFailures: 3 });
        await o.observer.ready();
        for (const person of [1, 2, 3]) o.feed(person, 200);
        await settle();
        o.calls[0].answer();
        await settle();
        o.calls[1].fail();
        await settle();
        expect(o.counters.get('observer_errors')).toBe(1);
        expect(o.verdicts).toEqual(['p1']);
        expect(o.observer.stats()).toMatchObject({ status: 'on', streams: 0, queuedMs: 0, inFlight: 0 });
        for (const person of [1, 2]) o.feed(person, 200);
        await settle();
        expect(o.calls[2].windows.length).toBe(1);
        expect(allZero(o.calls[2].windows[0].state)).toBe(true);
        o.calls[2].answer();
        await settle();
        expect(o.verdicts).toEqual(['p1', 'p1']);
        // The next call is for both of them; the detector answers for one only
        expect(o.calls[3].windows.length).toBe(2);
        o.calls[3].answer(1);
        await settle();
        expect(o.counters.get('observer_errors')).toBe(2);
        expect(o.verdicts).toEqual(['p1', 'p1']);
        expect(o.observer.stats()).toMatchObject({ status: 'on', streams: 0, queuedMs: 0, inFlight: 0 });
    });
});

// Faults a detector can have that are not errors: answering late, or never. Time here is a clock the test moves, so
// nothing depends on how fast the machine is.
describe('by the clock', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    /** What the observer holds inside for each person, to see that it is really let go and not just uncounted. */
    const inside = (observer: SpeechObserver) => [...(observer as unknown as { streams: Map<string, { waiting: unknown[]; samples: number; state: Float32Array; context: Float32Array }> }).streams.values()];

    it('an answer that comes back for audio older than the limit is not kept, not counted as an answer, and never becomes the person\'s state', async () => {
        const o = observing('held');
        await o.observer.ready();
        // Exactly one window, nothing left waiting behind it
        o.feed(32, 'p1', 1, 512);
        await settle();
        expect(o.calls.length).toBe(1);
        vi.advanceTimersByTime(1500);
        o.calls[0].answer();
        await settle();
        expect(o.verdicts).toEqual([]);
        expect(o.counters.get('observer_windows_completed')).toBe(1);
        expect(o.counters.get('observer_windows_expired')).toBe(1);
        expect(o.counters.get('observer_windows_accepted')).toBe(0);
        expect(o.counters.get('observer_max_age_ms')).toBe(0);
        expect(o.observer.stats()).toMatchObject({ status: 'on', streams: 0, queuedMs: 0, lined: 0 });
        // They start from nothing with their next audio
        o.feed(32, 'p1', 1, 512);
        await settle();
        expect(allZero(o.calls[1].state)).toBe(true);
        expect(allZero(o.calls[1].input.subarray(0, CONTEXT))).toBe(true);
        // An answer in time is kept as before
        vi.advanceTimersByTime(399);
        o.calls[1].answer();
        await settle();
        expect(o.verdicts.length).toBe(1);
        expect(o.counters.get('observer_windows_accepted')).toBe(1);
        expect(o.counters.get('observer_max_age_ms')).toBe(399);
    });

    it('audio left waiting goes by the clock even if no more ever arrives: a held-up line, and a last bit shorter than a window', async () => {
        const o = observing('held');
        await o.observer.ready();
        // One window is out; 20 ms more is waiting behind it and nothing else comes
        o.feed(52, 'p1', 1, 416);
        // Someone else sent 20 ms and stopped: never a whole window
        o.feed(20, 'p2');
        await settle();
        expect(o.observer.stats()).toMatchObject({ streams: 2, queuedMs: 40 });
        vi.advanceTimersByTime(400);
        expect(o.observer.stats()).toMatchObject({ streams: 2, queuedMs: 40 });
        vi.advanceTimersByTime(2);
        expect(o.observer.stats()).toMatchObject({ status: 'on', streams: 0, queuedMs: 0, lined: 0 });
        expect(o.counters.get('observer_idle_ms')).toBe(40);
        // The answer for the window that was out belongs to a stream that is gone
        o.calls[0].answer();
        await settle();
        expect(o.verdicts).toEqual([]);
        expect(o.counters.get('observer_windows_stale')).toBe(1);

        // Whole windows held up behind a slow call go the same way, counted as expired
        o.feed(200, 'p3');
        await settle();
        expect(o.observer.stats()).toMatchObject({ streams: 1, queuedMs: 168, lined: 1 });
        vi.advanceTimersByTime(402);
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0, lined: 0 });
        expect(o.counters.get('observer_expired_ms')).toBe(168);
    });

    it('a detector that never answers: the observer switches itself off at the deadline, holds nothing, and never starts a second call beside the first', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(200);
        await settle();
        const held = inside(o.observer);
        vi.advanceTimersByTime(1999);
        await settle();
        expect(o.observer.stats().status).toBe('on');
        vi.advanceTimersByTime(1);
        await settle();
        expect(o.observer.stats()).toEqual({ status: 'off', streams: 0, queuedMs: 0, inFlight: 0, lined: 0, callOut: true });
        expect(o.counters.get('observer_timed_out')).toBe(1);
        expect(o.counters.get('observer_gave_up')).toBe(1);
        expect(o.counters.get('observer_windows_failed')).toBe(1);
        // What it held for the person is let go, not just uncounted; what the detector was handed is left alone
        expect(held.map((x) => [x.waiting.length, x.samples, x.state.length, x.context.length])).toEqual([[0, 0, 0, 0]]);
        expect(o.calls[0].input.length).toBe(CONTEXT + WINDOW);
        expect(o.calls[0].input[CONTEXT]).toBeGreaterThan(0);
        // Audio after that goes nowhere, and no second call is made while the first is still out
        expect(() => o.feed(2000)).not.toThrow();
        await settle();
        expect(o.calls.length).toBe(1);
        expect(o.observer.stats().queuedMs).toBe(0);
        // The detector is not let go while its call is out; it is, the moment the call ends
        expect(o.released()).toBe(0);
        o.calls[0].answer();
        await settle();
        expect(o.released()).toBe(1);
        expect(o.verdicts).toEqual([]);
        expect(o.observer.stats().callOut).toBe(false);
    });

    it('closing the worker waits for the detector no longer than its limit, and never lets it go while a call is out', async () => {
        const o = observing('held', { inferenceTimeoutMs: 60_000 });
        await o.observer.ready();
        o.feed(200);
        await settle();
        const held = inside(o.observer);
        let closed = false;
        const closing = o.observer.dispose().then(() => (closed = true));
        // Everything waiting went the moment closing began
        expect(o.observer.stats()).toMatchObject({ status: 'closed', streams: 0, queuedMs: 0, lined: 0 });
        expect(held.map((x) => [x.waiting.length, x.samples, x.state.length, x.context.length])).toEqual([[0, 0, 0, 0]]);
        vi.advanceTimersByTime(1999);
        await settle();
        expect(closed).toBe(false);
        vi.advanceTimersByTime(1);
        await closing;
        expect(closed).toBe(true);
        expect(o.released()).toBe(0);
        o.calls[0].answer();
        await settle();
        expect(o.released()).toBe(1);
        expect(o.verdicts).toEqual([]);
        expect(o.counters.get('observer_windows_revoked')).toBe(1);
    });

    it('closing the worker is not held up by a detector that never finishes letting go', async () => {
        const o = observing('held');
        let releases = 0;
        o.model.release = () => {
            releases++;
            return new Promise<void>(() => undefined);
        };
        await o.observer.ready();
        let closed = false;
        const closing = o.observer.dispose().then(() => (closed = true));
        await settle();
        // Nothing was in the air, so letting go began at once: once
        expect(releases).toBe(1);
        vi.advanceTimersByTime(1999);
        await settle();
        expect(closed).toBe(false);
        vi.advanceTimersByTime(1);
        await closing;
        expect(closed).toBe(true);
        // Closing again, or a minute later, starts nothing more
        await o.observer.dispose();
        vi.advanceTimersByTime(60_000);
        await settle();
        expect(releases).toBe(1);
        expect(o.calls.length).toBe(0);
    });

    it('closing has one limit in all: a slow last call uses up part of it, and letting go only gets what is left', async () => {
        const o = observing('held', { inferenceTimeoutMs: 60_000 });
        let releases = 0;
        let releaseStartedAt = -1;
        let letGo!: () => void;
        o.model.release = () => {
            releases++;
            releaseStartedAt = performance.now();
            return new Promise<void>((resolve) => (letGo = resolve));
        };
        await o.observer.ready();
        o.feed(64);
        await settle();
        expect(o.calls.length).toBe(1);
        const begun = performance.now();
        let closed = false;
        const closing = o.observer.dispose().then(() => (closed = true));
        // The call in the air answers after 1,500 ms: only then is the detector let go
        vi.advanceTimersByTime(1500);
        await settle();
        expect(releases).toBe(0);
        o.calls[0].answer();
        await settle();
        expect(releases).toBe(1);
        expect(releaseStartedAt - begun).toBe(1500);
        // Letting go hangs. Closing ends at 2,000 ms from when it began, not 2,000 ms after letting go began
        vi.advanceTimersByTime(499);
        await settle();
        expect(closed).toBe(false);
        vi.advanceTimersByTime(1);
        await closing;
        expect(closed).toBe(true);
        // When letting go does end, late, nothing else happens: no second release, no new call, no verdict
        letGo();
        await settle();
        vi.advanceTimersByTime(10_000);
        await settle();
        expect(releases).toBe(1);
        expect(o.calls.length).toBe(1);
        expect(o.verdicts).toEqual([]);
    });

    it('a detector that never finishes loading leaves the observer off at the deadline, and is let go at once if it turns up later', async () => {
        const d = detector();
        let arrive!: (model: DetectorModel) => void;
        const counters = new Counters();
        const observer = new SpeechObserver({ counters, load: () => new Promise((resolve) => (arrive = resolve)) });
        const session = observer.session('s1');
        session.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320).fill(5), droppedMs: 0 });
        expect(observer.stats()).toMatchObject({ status: 'loading', queuedMs: 20 });
        // While it loads, what waits still goes by the clock
        vi.advanceTimersByTime(402);
        expect(observer.stats()).toMatchObject({ status: 'loading', streams: 0, queuedMs: 0 });
        vi.advanceTimersByTime(15000);
        await observer.ready();
        expect(observer.stats()).toMatchObject({ status: 'off', streams: 0, queuedMs: 0 });
        expect(counters.get('observer_load_timed_out')).toBe(1);
        expect(counters.get('observer_unavailable')).toBe(1);
        arrive(d.model);
        await settle();
        expect(d.released()).toBe(1);
        expect(d.calls.length).toBe(0);
        await observer.dispose();
        expect(d.released()).toBe(1);
    });

    it('counts its firings beside today\'s gate: together when within 600 ms for the same person, and what was observed while the bot was talking', async () => {
        const d = detector();
        const counters = new Counters();
        const observer = new SpeechObserver({ counters, load: async () => d.model });
        await observer.ready();
        let talking = false;
        const session = observer.session('s1', { botSpeaking: () => talking });
        const speak = (who: string, path: 'lane' | 'room') => {
            for (let i = 0; i < 2; i++) session.frame({ participantId: who, epoch: 1, pcm16k: new Int16Array(512).fill(9), droppedMs: 0 }, path);
        };
        // The gate first, the detector 300 ms later: together
        speak('p1', 'lane');
        await settle();
        expect(counters.get('observer_firings_lane')).toBe(1);
        expect(counters.get('observer_agree')).toBe(0);
        vi.advanceTimersByTime(300);
        session.baseline('p1', false);
        expect(counters.get('observer_agree_lane')).toBe(1);
        // The detector alone, in a room, while the bot is talking; the gate says so only two seconds later, stopping the voice
        talking = true;
        speak('p2', 'room');
        await settle();
        expect(counters.get('observer_firings_room')).toBe(1);
        expect(counters.get('observer_firings_bot_speaking')).toBe(1);
        expect(counters.get('observer_accepted_ms_bot_speaking')).toBe(64);
        vi.advanceTimersByTime(2000);
        session.baseline('p2', true);
        expect(counters.get('observer_baseline_room')).toBe(1);
        expect(counters.get('observer_baseline_stops')).toBe(1);
        expect(counters.get('observer_agree_room')).toBe(0);
        // Someone the observer was never given audio of is not counted at all
        session.baseline('p9', true);
        expect(counters.get('observer_baseline')).toBe(2);
        expect(counters.get('observer_accepted_ms_lane')).toBe(64);
        expect(counters.get('observer_accepted_ms_room')).toBe(64);
        expect(counters.get('observer_offered_ms_lane')).toBe(64);
        // A gate decision never throws back, even after the session is over
        session.close();
        expect(() => session.baseline('p1', true)).not.toThrow();
        expect(counters.get('observer_baseline')).toBe(2);
    });
});

describe('what it holds is bounded whatever happens', () => {
    it('the line for the detector never holds more than the people being watched, however long one call is held', async () => {
        const o = observing('held');
        await o.observer.ready();
        for (let i = 0; i < 6; i++) {
            o.feed(20_000);
            expect(o.observer.stats()).toMatchObject({ streams: 1, lined: 1 });
            expect(o.observer.stats().queuedMs).toBeLessThanOrEqual(400);
        }
        expect(o.counters.get('observer_peak_line')).toBe(1);
        expect(o.counters.get('observer_streams')).toBeGreaterThan(200);
        expect(o.calls.length).toBe(1);
        // Twenty people held up the same way: twenty in the line at most
        for (let i = 0; i < 3; i++) for (let p = 2; p <= 21; p++) o.feed(1000, `p${p}`);
        expect(o.observer.stats().streams).toBe(21);
        expect(o.observer.stats().lined).toBeLessThanOrEqual(21);
        expect(o.counters.get('observer_peak_line')).toBeLessThanOrEqual(21);
        o.session.drop(() => true);
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0, lined: 0 });
    });

    it('one piece of audio longer than a person may have waiting is not taken at all', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(60, 'p1');
        o.session.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(64_000).fill(7), droppedMs: 0 });
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0, lined: 0 });
        expect(o.counters.get('observer_peak_queued_ms')).toBeLessThanOrEqual(400);
        expect(o.counters.get('observer_overflow_ms')).toBeGreaterThanOrEqual(4000);
        // And a first piece that long starts nobody
        o.session.frame({ participantId: 'p2', epoch: 1, pcm16k: new Int16Array(64_000).fill(7), droppedMs: 0 });
        expect(o.observer.stats().streams).toBe(0);
        expect(o.counters.get('observer_peak_queued_ms')).toBeLessThanOrEqual(400);
    });

    it('a session that is over stays over: audio handed to it afterwards is not taken, while another session carries on', async () => {
        const o = observing();
        await o.observer.ready();
        const other = o.observer.session('s1');
        o.feed(100);
        await settle();
        const before = o.calls.length;
        o.session.close();
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0, lined: 0 });
        o.feed(500);
        o.session.drop(() => true);
        await settle();
        expect(o.calls.length).toBe(before);
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0 });
        expect(o.counters.get('observer_refused_closed')).toBe(25);
        expect(o.verdicts.length).toBe(before);
        // The same bubble opened again is a new session with its own handle
        other.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(640).fill(3), droppedMs: 0 });
        await settle();
        expect(o.calls.length).toBe(before + 1);
        expect(allZero(o.calls[before].state)).toBe(true);
    });

    it.each(['they are no longer heard', 'their session closes', 'the worker closes'] as const)('a person whose window is with the detector when %s: the audio still waiting behind it is let go at that moment, not only uncounted', async (how) => {
        const o = observing('held', { inferenceTimeoutMs: 60_000, disposeTimeoutMs: 50 });
        await o.observer.ready();
        // One window goes to the detector, which holds it; 20 ms more arrives and waits behind it
        o.feed(52, 'p1', 1, 832);
        await settle();
        expect(o.calls.length).toBe(1);
        expect(o.observer.stats()).toMatchObject({ streams: 1, queuedMs: 20, inFlight: 1 });
        // The very object the call in the air still refers to
        const held = (o.observer as unknown as { streams: Map<string, { waiting: unknown[]; samples: number; offset: number; state: Float32Array; context: Float32Array; ended?: string }> }).streams.values().next().value!;
        expect([held.waiting.length, held.samples]).toEqual([1, 320]);
        const closing = how === 'the worker closes' ? o.observer.dispose() : undefined;
        if (how === 'they are no longer heard') o.session.drop(() => true);
        if (how === 'their session closes') o.session.close();
        expect([held.waiting.length, held.samples, held.offset, held.state.length, held.context.length, held.ended]).toEqual([0, 0, 0, 0, 0, 'revoked']);
        expect(o.observer.stats()).toMatchObject({ streams: 0, queuedMs: 0, lined: 0, callOut: true });
        expect(o.counters.get('observer_revoked_ms')).toBe(20);
        // What the detector itself was handed is its own copy and is left alone while it reads it
        expect(o.calls[0].input[CONTEXT]).toBeGreaterThan(0);
        await closing;
        // The late answer changes nothing
        o.calls[0].answer();
        await settle();
        expect(o.verdicts).toEqual([]);
        expect(o.counters.get('observer_windows_accepted')).toBe(0);
        expect([held.waiting.length, held.samples, held.state.length]).toEqual([0, 0, 0]);
    });

    it('when the observer itself has to skip a person\'s audio, that is missing audio: past 100 ms they start afresh, and the answer still out for them is not kept', async () => {
        const o = observing('held', { maxQueuedMsTotal: 100 });
        await o.observer.ready();
        const give = (who: string, windows: number) => o.feed(32 * windows, who, 1, 512);
        // p1: one window out at the detector, one waiting. p2: two waiting. That is 96 ms waiting of the 100 allowed.
        give('p1', 2);
        give('p2', 2);
        await settle();
        expect(o.observer.stats()).toMatchObject({ streams: 2, queuedMs: 96 });
        // Four more windows of p1 do not fit: skipped, 128 ms in all
        give('p1', 4);
        expect(o.counters.get('observer_overloads')).toBe(4);
        expect(o.observer.stats()).toMatchObject({ streams: 1, queuedMs: 64 });
        // 128 ms skipped and the 32 ms that was waiting behind the gap
        expect(o.counters.get('observer_overflow_ms')).toBe(160);
        // The line drains: p1's answer is for a stream that was started afresh, p2 carries on untouched
        o.calls[0].answer();
        await settle();
        o.calls[1].answer();
        await settle();
        o.calls[2].answer();
        await settle();
        expect(o.verdicts.map((v) => v.participantId)).toEqual(['p2', 'p2']);
        expect(o.counters.get('observer_windows_stale')).toBe(1);
        expect(o.calls[2].state.every((v) => v === 2)).toBe(true);
        // p1 again: from nothing, not from what was heard before the gap
        give('p1', 1);
        await settle();
        expect(allZero(o.calls[3].state)).toBe(true);
        expect(allZero(o.calls[3].input.subarray(0, CONTEXT))).toBe(true);
    });

    it('a short skip, under 100 ms, is treated as the network\'s short losses are: the person carries on', async () => {
        const o = observing('held', { maxQueuedMsTotal: 100 });
        await o.observer.ready();
        const give = (who: string, windows: number) => o.feed(32 * windows, who, 1, 512);
        give('p1', 2);
        give('p2', 2);
        await settle();
        give('p1', 2);
        expect(o.counters.get('observer_overflow_ms')).toBe(64);
        expect(o.observer.stats().streams).toBe(2);
        o.calls[0].answer();
        await settle();
        expect(o.verdicts.map((v) => v.participantId)).toEqual(['p1']);
        // p1's next window builds on the answer just given
        const next = o.calls.find((call, i) => i > 0 && call.state.every((v) => v === 1));
        expect(next).toBeDefined();
    });

    it('every answer is counted once, under what became of it', async () => {
        const o = observing('held');
        await o.observer.ready();
        o.feed(32, 'kept', 1, 512);
        await settle();
        o.calls[0].answer();
        await settle();
        o.feed(32, 'left', 1, 512);
        await settle();
        o.session.drop((participantId) => participantId === 'left');
        o.calls[1].answer();
        await settle();
        o.feed(32, 'broke', 1, 512);
        await settle();
        o.calls[2].fail();
        await settle();
        const c = o.counters;
        expect([c.get('observer_windows_completed'), c.get('observer_windows_accepted'), c.get('observer_windows_revoked'), c.get('observer_windows_stale'), c.get('observer_windows_expired'), c.get('observer_windows_failed')]).toEqual([2, 1, 1, 0, 0, 1]);
        expect(o.verdicts.map((v) => v.participantId)).toEqual(['kept']);
    });
});

describe('when it goes wrong', () => {
    it('a detector that fails is counted, the person starts afresh, and after too many in a row the observer switches itself off', async () => {
        const o = observing('held', { maxFailures: 3 });
        await o.observer.ready();
        for (let i = 0; i < 3; i++) {
            expect(() => o.feed(64)).not.toThrow();
            await settle();
            o.calls[i].fail();
            await settle();
        }
        expect(o.counters.get('observer_errors')).toBe(3);
        expect(o.counters.get('observer_gave_up')).toBe(1);
        expect(o.observer.stats()).toMatchObject({ status: 'off', streams: 0, queuedMs: 0 });
        expect(() => o.feed(500)).not.toThrow();
        await settle();
        expect(o.calls.length).toBe(3);
        expect(o.verdicts).toEqual([]);
    });

    it('a detector that cannot be loaded leaves it off: audio handed to it goes nowhere and nothing is thrown', async () => {
        const counters = new Counters();
        const observer = new SpeechObserver({ counters, load: async () => Promise.reject(new Error('no runtime here')) });
        const session = observer.session('s1');
        // Audio that arrives while it is still trying to load is held within the limits, then let go
        expect(() => session.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320), droppedMs: 0 })).not.toThrow();
        await observer.ready();
        expect(counters.get('observer_unavailable')).toBe(1);
        expect(observer.stats()).toMatchObject({ status: 'off', streams: 0, queuedMs: 0 });
        expect(() => session.frame({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320), droppedMs: 0 })).not.toThrow();
        expect(observer.stats().queuedMs).toBe(0);
    });

    it('a frame it cannot take is counted, never thrown back at the session', () => {
        const counters = new Counters();
        const observer = new SpeechObserver({ counters, load: () => new Promise(() => undefined) });
        const session = observer.session('s1');
        expect(() => session.frame({ participantId: 'p1', epoch: 1 } as unknown as InputFrame)).not.toThrow();
        expect(counters.get('observer_errors')).toBe(1);
    });
});

describe('the real detector\'s runtime', () => {
    it('is refused unless the worker was started with the runtime\'s reporting off, before anything is read or loaded', async () => {
        await expect(sileroLoader({ modelPath: '/nowhere/model.onnx', runtime: '/nowhere/runtime', env: {} })()).rejects.toThrow(/ORT_DISABLE_TELEMETRY=1/);
        await expect(sileroLoader({ modelPath: '/nowhere/model.onnx', runtime: '/nowhere/runtime', env: { ORT_DISABLE_TELEMETRY: '0' } })()).rejects.toThrow(/ORT_DISABLE_TELEMETRY=1/);
    });

    it('is refused for any model file but the pinned one, before the runtime is loaded', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'observer-')), 'model.onnx');
        writeFileSync(file, 'not the model');
        await expect(sileroLoader({ modelPath: file, runtime: '/nowhere/runtime', env: { ORT_DISABLE_TELEMETRY: '1' } })()).rejects.toThrow(/pinned/);
    });
});

describe('on wherever the model is, unless the engineers switch it off', () => {
    it('is in the settings whenever the model is given, and not with VOICE_SPEECH_OBSERVER=0', () => {
        expect(optionsFromEnv({}).speechObserver).toBeUndefined();
        expect(optionsFromEnv({ VOICE_SPEECH_OBSERVER: '1' }).speechObserver).toBeUndefined();
        expect(optionsFromEnv({ VOICE_SPEECH_OBSERVER_MODEL: '/m.onnx' }).speechObserver).toBeDefined();
        expect(optionsFromEnv({ VOICE_SPEECH_OBSERVER: '1', VOICE_SPEECH_OBSERVER_MODEL: '/m.onnx' }).speechObserver).toBeDefined();
        expect(optionsFromEnv({ VOICE_SPEECH_OBSERVER: '0', VOICE_SPEECH_OBSERVER_MODEL: '/m.onnx' }).speechObserver).toBeUndefined();
    });

    it('switched on, watches at most 15 people at once unless told otherwise', () => {
        const on = { VOICE_SPEECH_OBSERVER: '1', VOICE_SPEECH_OBSERVER_MODEL: '/m.onnx' };
        expect(optionsFromEnv(on).speechObserver?.maxStreams).toBe(15);
        expect(optionsFromEnv({ ...on, VOICE_SPEECH_OBSERVER_MAX_STREAMS: '6' }).speechObserver?.maxStreams).toBe(6);
        expect(optionsFromEnv({ ...on, VOICE_SPEECH_OBSERVER_MAX_STREAMS: '0' }).speechObserver?.maxStreams).toBe(15);
        expect(optionsFromEnv({ ...on, VOICE_SPEECH_OBSERVER_MAX_STREAMS: 'many' }).speechObserver?.maxStreams).toBe(15);
    });

    it('a worker started without it never asks for a detector and says nothing about one', async () => {
        const worker = new VoiceWorker({ port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] } });
        expect(worker.stats().speechObserver).toBeUndefined();
        expect(worker.sessionHost(() => undefined, 's1')).not.toHaveProperty('observerFor');
        expect(Object.keys(worker.counters.snapshot()).some((name) => name.startsWith('observer_'))).toBe(false);
        await worker.close();
    });

    it('a worker started with it loads the detector once and lets it go when it closes', async () => {
        const d = detector();
        let loads = 0;
        const worker = new VoiceWorker({ port: 0, host: '127.0.0.1', maxLanes: 1, maxSessionsPerConnection: 1, ice: { iceServers: [] }, speechObserver: { load: async () => (loads++, d.model) } });
        await sleep(10);
        expect(loads).toBe(1);
        expect(worker.stats().speechObserver).toMatchObject({ status: 'on', streams: 0, queuedMs: 0 });
        await worker.close();
        expect(d.released()).toBe(1);
    });
});

// End to end, on a real audio connection: the person is heard exactly as without it, the observer is given their audio,
// and when they stop being heard nothing of theirs stays with it.
describe('beside a real conversation', () => {
    const rigs: Rig[] = [];
    const humans: FakeHuman[] = [];
    afterEach(async () => {
        for (const h of humans.splice(0)) await h.close().catch(() => undefined);
        for (const r of rigs.splice(0)) {
            r.calls.shutdown();
            await r.worker.close().catch(() => undefined);
        }
    });

    async function conversation(speechObserver: { load: () => Promise<DetectorModel> } | false) {
        const heard: number[] = [];
        const r = await startRig({ recognizer: new FakeEars(['Actually which of them replied this week']).factory, input: (f) => heard.push(f.pcm16k.length), speechObserver });
        rigs.push(r);
        r.calls.spaceUsers(r.game.spaceName, [{ spaceUserId: 'alice', uuid: 'uuid-alice', tags: [], name: 'alice' } as never]);
        const alice = new FakeHuman('alice');
        humans.push(alice);
        r.game.humans.set('alice', alice);
        r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'alice', initiator: false } }));
        for (const signal of await alice.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal } }));
        await waitFor('the audio connection', () => r.fromWorker.some((m) => m.type === 'participant.join'));
        alice.startMic(440);
        await sleep(1700);
        alice.stopMic();
        await waitFor('the finished words', () => r.game.drafts.some(([, d]) => d.state === 'final'));
        return { r, alice, heard };
    }
    /** What the bot server was told about what was said, without times or ids that differ from run to run. */
    const said = (r: Rig) =>
        r.fromWorker
            .filter((m) => m.type === 'user.speech_started' || m.type === 'user.turn')
            .map((m) => (m.type === 'user.turn' ? { type: m.type, outcome: m.outcome, text: (m as { text?: string }).text } : { type: m.type }));

    it('the person is heard the same with it and without it, and when they leave it holds nothing of theirs', async () => {
        const plain = await conversation(false);
        const d = detector();
        const observed = await conversation({ load: async () => d.model });

        expect(said(observed.r)).toEqual(said(plain.r));
        expect(observed.r.game.drafts.filter(([, x]) => x.state === 'final').map(([, x]) => x.text)).toEqual(plain.r.game.drafts.filter(([, x]) => x.state === 'final').map(([, x]) => x.text));
        expect(observed.r.violations).toEqual([]);

        // The observer was given the audio the session was given, and nothing else
        const c = observed.r.worker.counters;
        expect(c.get('observer_windows_completed')).toBeGreaterThan(20);
        expect(c.get('observer_windows_completed')).toBeLessThanOrEqual(Math.floor(observed.heard.reduce((a, b) => a + b, 0) / WINDOW));
        expect(c.get('observer_errors')).toBe(0);
        // Every answer was kept, all of it came over her own connection, and the observer was told once that today's gate heard her
        expect(c.get('observer_windows_accepted')).toBe(c.get('observer_windows_completed'));
        expect(c.get('observer_offered_ms_lane')).toBe(observed.heard.reduce((a, b) => a + b, 0) / 16);
        expect(c.get('observer_accepted_ms_lane')).toBe(c.get('observer_windows_accepted') * 32);
        expect(c.get('observer_offered_ms_room')).toBe(0);
        expect(c.get('observer_baseline')).toBe(1);
        expect(c.get('observer_baseline_stops')).toBe(0);
        // Her audio stopped a while ago: the bit left over, less than one window, was let go by the clock and nothing of hers is held
        expect(observed.r.worker.stats().speechObserver).toMatchObject({ status: 'on', streams: 0, queuedMs: 0, lined: 0, callOut: false });
        expect(c.get('observer_idle_ms')).toBeLessThan(32);
        expect(c.get('observer_expired_ms')).toBe(0);
        expect(c.get('observer_streams_ended')).toBe(1);

        // The bot server closes her connection (she left): nothing of hers stays
        const open = observed.r.toWorker.find((m) => m.type === 'lane.open') as { sessionId: string; participantId: string; epoch: number };
        observed.r.link().send({ type: 'lane.close', sessionId: open.sessionId, participantId: open.participantId, epoch: open.epoch });
        await waitFor('her connection to close', () => observed.r.worker.laneCount() === 0);
        expect(observed.r.worker.stats().speechObserver).toMatchObject({ streams: 0, queuedMs: 0 });
        // And the worker without it never had any of this
        expect(Object.keys(plain.r.worker.counters.snapshot()).some((name) => name.startsWith('observer_'))).toBe(false);
    }, 30_000);
});
