// The bot's voice yielding to a loud sound, for a bot in the limited owner rollout (yieldControl.ts): it pauses, stops
// only once the sound is confirmed as speech, and goes on from the exact frame only after a successful, empty result
// and fresh silence. Every other bot keeps today's rule. The detector is made here: it calls a window speech when the
// sound is loud and low (a voice-like 200 Hz tone) and not speech when it is high (a 1.2 kHz hum standing in for a fan,
// typing or a knock), so no model or runtime is needed. Both ways audio reaches the bot are covered end to end.
import { AccessToken, TrackSource as GrantSource } from 'livekit-server-sdk';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { afterEach, describe, expect, it } from 'vitest';
import { Counters } from '../src/counters.ts';
import { FakeEars, type FakeUtterance } from '../src/recognizer.ts';
import { type Interruptions, Recognition, type TurnEnd } from '../src/recognition.ts';
import type { OutgoingMessage } from '../src/session.ts';
import { Speaker } from '../src/speaker.ts';
import { CONTEXT, type DetectorModel, SpeechObserver, type SessionObserver, type SpeechObserverSettings, STATE } from '../src/speechObserver.ts';
import type { OutputTarget } from '../src/transport.ts';
import { isStopCommand, type YieldPolicy, YieldControl, type YieldSpeaker } from '../src/yieldControl.ts';
import { optionsFromEnv } from '../src/config.ts';
import type { WorkerOptions } from '../src/server.ts';
import { FakeHuman, type Rig, privateEvent, sleep, startRig, waitFor } from './harness.ts';

const VOICE_HZ = 200;
const NOISE_HZ = 1200;

/** Speech when loud and low: few sign changes in the window. Quiet is never speech. */
function judgeWindow(input: Float32Array): number {
    let crossings = 0;
    let energy = 0;
    for (let i = CONTEXT; i < input.length; i++) {
        energy += input[i] * input[i];
        if (i > CONTEXT && input[i - 1] < 0 !== input[i] < 0) crossings++;
    }
    const rms = Math.sqrt(energy / (input.length - CONTEXT));
    if (rms < 0.02) return 0.01;
    return crossings < 40 ? 0.95 : 0.05;
}

/** A detector that judges each window by its sound, or (held) never answers, or fails. */
function detector(mode: 'judge' | 'held' | 'fails' = 'judge') {
    let delay = 0;
    const model: DetectorModel = {
        run: (input) => {
            if (mode === 'held') return new Promise(() => undefined);
            if (mode === 'fails') return Promise.reject(new Error('detector failed'));
            const answer = { probability: judgeWindow(input), state: new Float32Array(STATE) };
            return delay ? new Promise((resolve) => setTimeout(() => resolve(answer), delay)) : Promise.resolve(answer);
        },
        release: async () => undefined,
    };
    /** From now on each answer takes this long (a detector slow for a while). */
    const slow = (ms: number) => (delay = ms);
    return { model, slow };
}

const tone = (hz: number, samples = 320, start = 0): Int16Array => Int16Array.from({ length: samples }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * hz * (start + i)) / 16000)));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('the rollout setting', () => {
    const model = { VOICE_SPEECH_OBSERVER: '1', VOICE_SPEECH_OBSERVER_MODEL: '/model.onnx' };
    it('names bots only with the detector on; hold unless a comparison policy is named; nothing when empty or removed', () => {
        expect(optionsFromEnv({ ...model, VOICE_YIELD_BOTS: ' a ,b,, ' }).yieldBots).toEqual({ botIds: new Set(['a', 'b']), policy: 'hold' });
        expect(optionsFromEnv({ ...model, VOICE_YIELD_BOTS: 'a', VOICE_YIELD_POLICY: 'dip' }).yieldBots?.policy).toBe('dip');
        expect(optionsFromEnv({ ...model, VOICE_YIELD_BOTS: 'a', VOICE_YIELD_POLICY: 'anything' }).yieldBots?.policy).toBe('hold');
        expect(optionsFromEnv({ ...model, VOICE_YIELD_BOTS: ' , ' }).yieldBots).toBeUndefined();
        expect(optionsFromEnv(model).yieldBots).toBeUndefined();
        expect(optionsFromEnv({ VOICE_YIELD_BOTS: 'a' }).yieldBots).toBeUndefined();
        expect(optionsFromEnv({ VOICE_SPEECH_OBSERVER: '1', VOICE_YIELD_BOTS: 'a' }).yieldBots).toBeUndefined();
    });
});

describe('a stop command', () => {
    it('at the very start of a stretch, after at most two openers, whole words, English and Arabic', () => {
        for (const yes of ['stop', 'Stop!', 'wait', 'please stop', 'ok wait a sec', 'hold on', 'hang on a second', 'stop talking right now please', 'okay please stop', 'وقف', 'خلاص', 'استنى شوي', 'توقف لو سمحت'])
            expect(isStopCommand(yes), yes).toBe(true);
    });
    it('not later in a sentence, not negated, not quoted or mentioned, not inside a word, not "no"', () => {
        for (const no of ['no', 'no no', 'a bus stop', 'please don\'t ever stop', "don't stop", 'do not stop', 'he said stop', 'I said wait', 'stopwatch', 'waiting', 'hold the door', 'لا توقف', 'I would never want it to stop', '', 'mm-hm', 'ok so um stop'])
            expect(isStopCommand(no), no).toBe(false);
    });
});

describe('the detector, asked about one person', () => {
    function asking(mode: 'judge' | 'held' | 'fails' = 'judge', settings: Partial<Omit<SpeechObserverSettings, 'load'>> = {}) {
        const d = detector(mode);
        const counters = new Counters();
        const observer = new SpeechObserver({ counters, load: async () => d.model, ...settings });
        const session = observer.session('s1');
        let at = 0;
        const feed = (hz: number | 0, ms: number, who = 'p1', epoch = 1) => {
            for (let sent = 0; sent < ms; sent += 20) {
                const pcm = hz === 0 ? new Int16Array(320) : tone(hz, 320, at);
                at += 320;
                session.frame({ participantId: who, epoch, pcm16k: pcm, droppedMs: 0 });
            }
        };
        const asked = (who = 'p1', epoch = 1) => {
            const answers: boolean[] = [];
            const done = session.confirm(who, epoch, (fallback) => answers.push(fallback));
            return { answers, done };
        };
        return { counters, observer, session, feed, asked, slow: d.slow };
    }

    it('already hearing speech from them: speech at once', async () => {
        const o = asking();
        await o.observer.ready();
        o.feed(VOICE_HZ, 200);
        await settle();
        expect(o.asked().answers).toEqual([false]);
        expect(o.counters.get('observer_decide_at_once')).toBe(1);
    });

    it('speech a moment after: said once, as soon as it hears it; a noise never is', async () => {
        const o = asking();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100);
        await settle();
        const a = o.asked();
        for (let i = 0; i < 6; i++) {
            o.feed(NOISE_HZ, 100);
            await settle();
        }
        expect(a.answers).toEqual([]);
        for (let i = 0; i < 3; i++) {
            o.feed(VOICE_HZ, 100);
            await settle();
        }
        expect(a.answers).toEqual([false]);
        expect(o.counters.get('observer_decide_fallback')).toBe(0);
    });

    it('no longer waited for: a later answer is never given, however it comes', async () => {
        const o = asking();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100);
        await settle();
        const a = o.asked();
        a.done();
        o.feed(VOICE_HZ, 300);
        await settle();
        expect(a.answers).toEqual([]);
        expect(o.counters.get('observer_decide_held')).toBe(1);
    });

    it('cannot tell (not loaded, not watched, another path): today\'s rule at once, said to be a fallback', async () => {
        let loaded!: (m: DetectorModel) => void;
        const loading = new SpeechObserver({ counters: new Counters(), load: () => new Promise((resolve) => (loaded = resolve)) });
        const s = loading.session('s1');
        s.frame({ participantId: 'p1', epoch: 1, pcm16k: tone(NOISE_HZ), droppedMs: 0 });
        const answers: boolean[] = [];
        s.confirm('p1', 1, (fallback) => answers.push(fallback));
        expect(answers).toEqual([true]);
        expect(s.heard('p1', 1)).toBeUndefined();
        loaded(detector().model);

        const o = asking('judge', { maxStreams: 1 });
        await o.observer.ready();
        o.feed(NOISE_HZ, 100, 'p1');
        o.feed(NOISE_HZ, 100, 'p2');
        await settle();
        expect(o.asked('p2').answers).toEqual([true]);
        expect(o.asked('p1', 2).answers).toEqual([true]);
        expect(o.asked('p1', 1).answers).toEqual([]);
    });

    it('falling behind: today\'s rule within a third of a second, not after the 2 s timeout', async () => {
        const o = asking('held');
        await o.observer.ready();
        o.feed(NOISE_HZ, 64);
        await settle();
        const a = o.asked();
        const from = performance.now();
        while (!a.answers.length && performance.now() - from < 2000) {
            o.feed(NOISE_HZ, 40);
            await sleep(40);
        }
        expect(a.answers).toEqual([true]);
        expect(performance.now() - from).toBeLessThan(800);
    });

    it('slow even once (answers that keep coming, but late): today\'s rule for that question, never a late confirmation', async () => {
        const o = asking();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100);
        await settle();
        const a = o.asked();
        // Under the falling-behind threshold (96 ms given), so only the late answer itself can decide
        o.slow(330);
        o.feed(VOICE_HZ, 40);
        await sleep(450);
        await settle();
        expect(a.answers).toEqual([true]);
        expect(o.counters.get('observer_decide_fallback_stale')).toBe(1);
        expect(o.counters.get('observer_decide_confirmed')).toBe(0);
        // Speech heard, then nothing newer for longer than the bound: a new question is never confirmed at once on it
        o.slow(0);
        o.feed(VOICE_HZ, 100);
        await settle();
        await sleep(20);
        const fresh = o.asked();
        expect(fresh.answers).toEqual([false]);
        const atOnce = o.counters.get('observer_decide_at_once');
        await sleep(350);
        const b = o.asked();
        expect(b.answers).not.toContain(false);
        expect(o.counters.get('observer_decide_at_once')).toBe(atOnce);
    });

    it('failing: whoever waited gets today\'s rule', async () => {
        const o = asking('fails', { maxFailures: 2 });
        await o.observer.ready();
        o.feed(NOISE_HZ, 20);
        await settle();
        const a = o.asked();
        o.feed(NOISE_HZ, 200);
        await settle();
        expect(a.answers).toEqual([true]);
    });

    it('says what it last made of them: fresh, quiet for how long, speech or not', async () => {
        const o = asking();
        await o.observer.ready();
        expect(o.session.heard('p1', 1)).toBeUndefined();
        o.feed(VOICE_HZ, 200);
        await settle();
        expect(o.session.heard('p1', 1)).toMatchObject({ speech: true, quietMs: 0 });
        for (let i = 0; i < 8; i++) {
            o.feed(0, 80);
            await settle();
        }
        const view = o.session.heard('p1', 1)!;
        expect(view.speech).toBe(false);
        expect(view.quietMs).toBeGreaterThanOrEqual(500);
        expect(view.ageMs).toBeLessThan(100);
        // Age grows with the clock while nothing new is answered (measured, not assumed: a timer may fire a fraction early)
        const from = performance.now();
        await sleep(250);
        const later = o.session.heard('p1', 1)!;
        expect(later.ageMs - view.ageMs).toBeGreaterThanOrEqual(performance.now() - from - 1);
        expect(later.ageMs).toBeGreaterThanOrEqual(240);
        expect(o.session.heard('p1', 2)).toBeUndefined();
        o.session.drop(() => true);
        expect(o.session.heard('p1', 1)).toBeUndefined();
    });
});

describe('hearing tells the control how each stretch it was asked about ended', () => {
    function hearing(script: (string | FakeUtterance)[], answer: boolean, maxUtteranceMs = 180000, owning = false) {
        const sent: OutgoingMessage[] = [];
        const spoke: [string, boolean][] = [];
        const log: string[] = [];
        let speech: ((stop: boolean) => void) | undefined;
        const control: Interruptions = {
            owns: () => owning,
            loud: (turn, s) => {
                log.push(`loud ${turn.participantId}${turn.heard ? ` heard ${turn.heard}` : ''}`);
                speech = s;
                return answer;
            },
            words: (_, text) => log.push(`words ${text}`),
            missing: (_, ms) => log.push(`missing ${ms}`),
            ended: (_, how: TurnEnd) => {
                log.push(`ended ${how}`);
                if (how === 'text') speech?.(true);
            },
        };
        const recognition = new Recognition({
            factory: new FakeEars(script).factory,
            maxUtteranceMs,
            pauseMs: 400,
            counters: new Counters(),
            send: (m) => {
                sent.push(m);
                log.push(m.type);
            },
            onSpeaking: (p, stop) => spoke.push([p, stop]),
            interruptions: control,
        });
        const feed = (pcm: () => Int16Array, ms: number, droppedMs = 0) => {
            for (let t = 0; t < ms; t += 20) recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: pcm(), droppedMs: t === 0 ? droppedMs : 0 });
        };
        return {
            recognition,
            sent,
            spoke,
            log,
            speech: (stop: boolean) => speech?.(stop),
            loud: (ms: number, droppedMs = 0) => feed(() => tone(440), ms, droppedMs),
            quiet: (ms: number) => feed(() => new Int16Array(320), ms),
            started: () => sent.filter((m) => m.type === 'user.speech_started').length,
        };
    }

    it('not taken by the control: today exactly (announced at once, the voice stopped)', () => {
        const h = hearing([''], false);
        h.loud(80);
        expect(h.started()).toBe(0);
        h.loud(40);
        expect(h.started()).toBe(1);
        expect(h.spoke).toEqual([['p1', true]]);
    });

    it('waiting: nothing announced, words still shown privately, then speech once when the control says so', () => {
        const h = hearing([{ text: 'hello there friend', wordMs: 100 }], true);
        h.loud(250);
        expect(h.started()).toBe(0);
        expect(h.sent.some((m) => m.type === 'user.partial')).toBe(true);
        expect(h.log).toContain('words hello');
        h.speech(false);
        h.speech(true);
        expect(h.started()).toBe(1);
        expect(h.spoke).toEqual([['p1', false]]);
    });

    it('an empty result, with no words before and nothing missing: "empty"', () => {
        const h = hearing([''], true);
        h.loud(300);
        h.quiet(500);
        expect(h.log.filter((l) => l.startsWith('ended'))).toEqual(['ended empty']);
        expect(h.started()).toBe(0);
        expect(h.sent.filter((m) => m.type === 'user.turn')).toMatchObject([{ outcome: 'cleared' }]);
    });

    it('words: "text", and the stretch is announced before its end goes out', () => {
        const h = hearing([{ text: 'stop please', wordMs: 100 }], true);
        h.loud(300);
        h.quiet(500);
        const at = (entry: string) => h.log.indexOf(entry);
        expect(at('ended text')).toBeGreaterThan(-1);
        expect(at('user.speech_started')).toBeGreaterThan(at('ended text'));
        expect(at('user.turn')).toBeGreaterThan(at('user.speech_started'));
    });

    it('words that came only as partials, then an empty final: still "text"', () => {
        const ended: TurnEnd[] = [];
        const recognition = new Recognition({
            factory: (events) => {
                let shown = false;
                return {
                    push: () => {
                        if (!shown) (shown = true), events.partial('hey');
                    },
                    finish: () => events.final(''),
                    close: () => undefined,
                };
            },
            maxUtteranceMs: 180000,
            pauseMs: 400,
            counters: new Counters(),
            send: () => undefined,
            interruptions: { owns: () => true, loud: () => true, words: () => undefined, missing: () => undefined, ended: (_, how) => ended.push(how) },
        });
        for (let t = 0; t < 300; t += 20) recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: tone(440), droppedMs: 0 });
        for (let t = 0; t < 500; t += 20) recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320), droppedMs: 0 });
        expect(ended).toEqual(['text']);
    });

    it('a failure: "failed", never "empty"', () => {
        const h = hearing([{ text: 'one two three', wordMs: 150, failAfterWords: 1 }], true);
        h.loud(300);
        expect(h.log.filter((l) => l.startsWith('ended'))).toEqual(['ended failed']);
    });

    it('a hole in the audio: "lost"; the limit: "capped"', () => {
        const gap = hearing([''], true);
        gap.loud(200);
        gap.loud(100, 500);
        gap.quiet(500);
        expect(gap.log.filter((l) => l.startsWith('ended'))).toEqual(['ended lost']);
        const cap = hearing([''], true, 600);
        cap.loud(800);
        expect(cap.log.filter((l) => l.startsWith('ended'))).toEqual(['ended capped']);
    });

    it('words taken back before an empty final: "retracted", never "empty"', () => {
        const ended: TurnEnd[] = [];
        const recognition = new Recognition({
            factory: (events) => {
                let n = 0;
                return {
                    push: () => {
                        n++;
                        if (n === 8) events.partial('hello');
                        if (n === 10) events.partial('');
                    },
                    finish: () => events.final(''),
                    close: () => undefined,
                };
            },
            maxUtteranceMs: 180000,
            pauseMs: 400,
            counters: new Counters(),
            send: () => undefined,
            interruptions: { owns: () => true, loud: () => true, words: () => undefined, missing: () => undefined, ended: (_, how) => ended.push(how) },
        });
        for (let t = 0; t < 300; t += 20) recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: tone(440), droppedMs: 0 });
        for (let t = 0; t < 500; t += 20) recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: new Int16Array(320), droppedMs: 0 });
        expect(ended).toEqual(['retracted']);
    });

    it('any missing audio at all, even 20 ms, then an empty final: "lost", never "empty"', () => {
        const h = hearing([''], true);
        h.loud(200);
        h.loud(100, 20);
        h.quiet(500);
        expect(h.log.filter((l) => l.startsWith('ended'))).toEqual(['ended lost']);
        // The public outcome is unchanged: nothing to keep
        expect(h.sent.filter((m) => m.type === 'user.turn')).toMatchObject([{ outcome: 'cleared' }]);
    });

    it('while the control owns it, a fast partial before the gate goes out privately only, and its words reach the gate', () => {
        const h = hearing([{ text: 'hello there', wordMs: 20 }], true, 180000, true);
        h.loud(40);
        expect(h.sent.some((m) => m.type === 'user.partial')).toBe(true);
        expect(h.started()).toBe(0);
        h.loud(100);
        expect(h.log).toContain('loud p1 heard hello there');
        expect(h.started()).toBe(0);
        h.speech(true);
        expect(h.started()).toBe(1);
    });

    it('while the control owns it, words from a stretch that never reaches the gate are announced just before its end', () => {
        const h = hearing([{ text: 'hi', wordMs: 20 }], true, 180000, true);
        h.loud(40);
        h.quiet(500);
        expect(h.log.some((l) => l.startsWith('loud'))).toBe(false);
        const at = (entry: string) => h.log.indexOf(entry);
        expect(at('user.speech_started')).toBeGreaterThan(-1);
        expect(at('user.turn')).toBeGreaterThan(at('user.speech_started'));
        expect(h.spoke).toEqual([]);
    });

    it('not owned (the bot silent, or another bot): a fast partial announces at once, as today', () => {
        const h = hearing([{ text: 'hello', wordMs: 20 }], true);
        h.loud(40);
        expect(h.started()).toBe(1);
    });

    it('no longer heard: "gone"', () => {
        const h = hearing([''], true);
        h.loud(300);
        h.recognition.interrupt('p1', 1, 'lost', 'path');
        expect(h.log.filter((l) => l.startsWith('ended'))).toEqual(['ended gone']);
    });
});

/** A speaker and an observer the control can be driven through by hand. */
function controlled(policy: YieldPolicy = 'hold', settings: { silenceMs?: number; freshMs?: number; watchdogMs?: number } = {}) {
    const counters = new Counters();
    const calls: string[] = [];
    const speaker: YieldSpeaker & { playing?: string } = {
        playing: 'r1',
        get playingId() {
            return this.playing;
        },
        hold: () => (calls.push('hold'), 'r1'),
        resume: (id) => (calls.push(`resume ${id}`), true),
        setGain: (g) => calls.push(`gain ${g}`),
    };
    const views = new Map<string, { ageMs: number; quietMs: number; speech: boolean; stream: number; droppedMs: number }>();
    const asks = new Map<string, { go: (fallback: boolean) => void; cancelled: boolean }>();
    const observer: SessionObserver = {
        frame: () => undefined,
        drop: () => undefined,
        baseline: () => undefined,
        close: () => undefined,
        heard: (p) => views.get(p),
        confirm: (p, _, go) => {
            const ask = { go, cancelled: false };
            asks.set(p, ask);
            return () => (ask.cancelled = true);
        },
    };
    const control = new YieldControl({ policy, counters, speaker, observer, silenceMs: 300, freshMs: 300, watchdogMs: 2000, ...settings });
    control.onStopHeld = () => calls.push('stop held');
    const spoke: [string, boolean][] = [];
    const loud = (p: string, turnId = `t-${p}`, heard = '', earlier: { everWords?: boolean; missingMs?: number } = {}) =>
        control.loud({ participantId: p, epoch: 1, turnId, heard, everWords: heard !== '' || (earlier.everWords ?? false), missingMs: earlier.missingMs ?? 0 }, (stop) => spoke.push([p, stop]));
    const fresh = (p: string, quietMs = 0, speech = false, stream = 1) => views.set(p, { ageMs: 20, quietMs, speech, stream, droppedMs: 0 });
    return { control, counters, calls, speaker, views, asks, spoke, loud, fresh };
}

describe('the control, step by step', () => {
    it('the bot not speaking, or no fresh view of the person: today\'s rule', () => {
        const c = controlled();
        c.speaker.playing = undefined;
        c.fresh('p1');
        expect(c.loud('p1')).toBe(false);
        c.speaker.playing = 'r1';
        c.views.clear();
        expect(c.loud('p1')).toBe(false);
        c.views.set('p1', { ageMs: 900, quietMs: 0, speech: false, stream: 1, droppedMs: 0 });
        expect(c.loud('p1')).toBe(false);
        expect(c.calls).toEqual([]);
        expect(c.counters.get('yield_fallback_not_fresh')).toBe(2);
    });

    it('a noise: pause, empty result, quiet long enough, then on from the same reply', async () => {
        const c = controlled();
        c.fresh('p1');
        expect(c.loud('p1')).toBe(true);
        expect(c.calls).toEqual(['hold']);
        c.control.ended('t-p1', 'empty');
        expect(c.calls).toEqual(['hold']);
        c.fresh('p1', 400);
        await waitFor('the voice to go on', () => c.calls.includes('resume r1'), 1000);
        expect(c.spoke).toEqual([]);
        expect(c.asks.get('p1')!.cancelled).toBe(true);
        expect(c.counters.get('yield_resumes')).toBe(1);
        // A late answer from the detector changes nothing
        c.asks.get('p1')!.go(false);
        expect(c.spoke).toEqual([]);
    });

    it('not resumed on an empty result alone: stale view, speech heard, or not quiet long enough', async () => {
        const c = controlled('hold', { watchdogMs: 700 });
        c.fresh('p1');
        c.loud('p1');
        c.control.ended('t-p1', 'empty');
        c.views.set('p1', { ageMs: 900, quietMs: 900, speech: false, stream: 1, droppedMs: 0 });
        await sleep(250);
        c.fresh('p1', 900, true);
        await sleep(250);
        c.fresh('p1', 100);
        await waitFor('the watchdog', () => c.calls.includes('stop held'), 1500);
        expect(c.calls).not.toContain('resume r1');
        expect(c.counters.get('yield_watchdog')).toBe(1);
    });

    it('stops as today on the detector, a fallback, a stop word, words, or a failure', () => {
        const cases: [string, (c: ReturnType<typeof controlled>) => void][] = [
            ['confirmed_detector', (c) => c.asks.get('p1')!.go(false)],
            ['confirmed_fallback', (c) => c.asks.get('p1')!.go(true)],
            ['confirmed_command', (c) => c.control.words('t-p1', 'wait')],
            ['confirmed_words', (c) => c.control.ended('t-p1', 'text')],
            ['confirmed_stt_failed', (c) => c.control.ended('t-p1', 'failed')],
            ['confirmed_stt_failed', (c) => c.control.ended('t-p1', 'lost')],
        ];
        for (const [counter, act] of cases) {
            const c = controlled();
            c.fresh('p1');
            c.loud('p1');
            act(c);
            expect(c.spoke, counter).toEqual([['p1', true]]);
            expect(c.counters.get(`yield_${counter}`), counter).toBe(1);
            expect(c.calls).not.toContain('resume r1');
        }
    });

    it('ordinary first words do not stop it', () => {
        const c = controlled();
        c.fresh('p1');
        c.loud('p1');
        c.control.words('t-p1', 'okay so');
        c.control.words('t-p1', "I don't want it to stop");
        expect(c.spoke).toEqual([]);
    });

    it('two people: one empty result does not resume while the other is unsettled; a stop for one counts the other as speaking', async () => {
        const c = controlled();
        c.fresh('p1');
        c.fresh('p2');
        c.loud('p1');
        c.loud('p2');
        expect(c.calls).toEqual(['hold']);
        c.control.ended('t-p1', 'empty');
        c.fresh('p1', 400);
        await sleep(250);
        expect(c.calls).toEqual(['hold']);
        c.control.ended('t-p2', 'empty');
        c.fresh('p2', 400);
        await waitFor('the voice to go on', () => c.calls.includes('resume r1'), 1000);

        const d = controlled();
        d.fresh('p1');
        d.fresh('p2');
        d.loud('p1');
        d.loud('p2');
        d.asks.get('p2')!.go(false);
        expect(d.spoke).toEqual([
            ['p2', true],
            ['p1', false],
        ]);
    });

    it('the reply goes away (stopped, retracted, replaced): not resumed, nothing stopped, open stretches as today', async () => {
        const c = controlled();
        c.fresh('p1');
        c.loud('p1');
        c.speaker.playing = 'r2';
        await waitFor('the pause to end', () => c.counters.get('yield_reply_gone') === 1, 1000);
        expect(c.spoke).toEqual([['p1', false]]);
        expect(c.calls).toEqual(['hold']);
        // A late answer for the old reply never stops the new one
        c.asks.get('p1')!.go(false);
        expect(c.spoke).toEqual([['p1', false]]);
    });

    it('the person is no longer heard: the paused reply stops as today, it is not resumed', () => {
        const c = controlled();
        c.fresh('p1');
        c.loud('p1');
        c.control.ended('t-p1', 'gone');
        expect(c.calls).toEqual(['hold', 'stop held']);
        expect(c.spoke).toEqual([]);
    });

    it('closing ends everything quietly', () => {
        const c = controlled();
        c.fresh('p1');
        c.loud('p1');
        c.control.close();
        expect(c.asks.get('p1')!.cancelled).toBe(true);
        expect(c.loud('p1')).toBe(false);
    });

    it('for comparison only: confirm keeps playing, dip turns it down and back', async () => {
        const c = controlled('confirm');
        c.fresh('p1');
        expect(c.loud('p1')).toBe(true);
        expect(c.calls).toEqual([]);
        c.control.ended('t-p1', 'empty');
        c.fresh('p1', 400);
        await waitFor('it to settle', () => c.counters.get('yield_resumes') === 1, 1000);
        expect(c.calls).toEqual([]);

        const d = controlled('dip');
        d.fresh('p1');
        d.loud('p1');
        d.control.ended('t-p1', 'empty');
        d.fresh('p1', 400);
        await waitFor('it to settle', () => d.counters.get('yield_resumes') === 1, 1000);
        expect(d.calls).toEqual(['gain 0.3', 'gain 1']);
    });
});

describe('steady noise: the voice goes on provisionally while the open stretch is watched', () => {
    async function continuing(settings: { watchdogMs?: number } = {}) {
        const c = controlled('hold', settings);
        c.fresh('p1');
        c.loud('p1');
        c.fresh('p1', 5000);
        await waitFor('the voice to go on', () => c.calls.includes('resume r1'), 1000);
        expect(c.counters.get('yield_continues')).toBe(1);
        expect(c.counters.get('yield_resumes')).toBe(0);
        return c;
    }

    it('quiet from before the sound does not count: only the time since it', async () => {
        const c = controlled();
        c.fresh('p1', 60_000);
        c.loud('p1');
        await sleep(150);
        expect(c.calls).toEqual(['hold']);
        await waitFor('the voice to go on', () => c.calls.includes('resume r1'), 1000);
    });

    it('not with words ever heard, not while the detector hears speech, not after a break in its view', async () => {
        const words = controlled('hold', { watchdogMs: 800 });
        words.fresh('p1', 5000);
        words.loud('p1', 't-p1', 'hmm');
        await waitFor('the watchdog', () => words.counters.get('yield_watchdog') === 1, 1500);
        expect(words.calls).not.toContain('resume r1');

        const broken = controlled('hold', { watchdogMs: 800 });
        broken.fresh('p1', 5000);
        broken.loud('p1');
        broken.fresh('p1', 5000, false, 2);
        await waitFor('the watchdog', () => broken.counters.get('yield_watchdog') === 1, 1500);
        expect(broken.calls).not.toContain('resume r1');

        const speech = controlled('hold', { watchdogMs: 800 });
        speech.fresh('p1', 5000, true);
        speech.loud('p1');
        await waitFor('the watchdog', () => speech.counters.get('yield_watchdog') === 1, 1500);
        expect(speech.calls).not.toContain('resume r1');
    });

    it('then any words, speech from the detector, a failure or a break in its view stop the reply as today', async () => {
        const words = await continuing();
        words.control.words('t-p1', 'so');
        expect(words.spoke).toEqual([['p1', true]]);
        expect(words.counters.get('yield_confirmed_words_while_continuing')).toBe(1);

        const detector = await continuing();
        detector.asks.get('p1')!.go(false);
        expect(detector.spoke).toEqual([['p1', true]]);
        expect(detector.counters.get('yield_confirmed_detector_while_continuing')).toBe(1);

        const failed = await continuing();
        failed.control.ended('t-p1', 'failed');
        expect(failed.spoke).toEqual([['p1', true]]);

        const heard = await continuing();
        heard.fresh('p1', 0, true);
        await waitFor('the stop', () => heard.spoke.length === 1, 500);
        expect(heard.counters.get('yield_confirmed_detector_while_continuing')).toBe(1);

        const view = await continuing();
        view.fresh('p1', 5000, false, 7);
        await waitFor('the stop', () => view.spoke.length === 1, 500);
        expect(view.counters.get('yield_continuing_view_lost')).toBe(1);
    });

    it('no stop for staying open: the pause deadline does not apply once going on', async () => {
        const c = await continuing({ watchdogMs: 500 });
        await sleep(900);
        expect(c.spoke).toEqual([]);
        expect(c.calls).toEqual(['hold', 'resume r1']);
    });

    it('ends quietly when the stretch ends empty, at the length limit with no words, or the person leaves', async () => {
        for (const how of ['empty', 'capped', 'gone'] as const) {
            const c = await continuing();
            c.control.ended('t-p1', how);
            expect(c.spoke, how).toEqual([]);
            expect(c.calls, how).toEqual(['hold', 'resume r1']);
            // Over: a late answer changes nothing
            c.asks.get('p1')!.go(false);
            expect(c.spoke, how).toEqual([]);
        }
    });

    it('a new sound pauses again; the reply going away hands the watched stretch back to today\'s rule: speaking, nothing stopped', async () => {
        const c = await continuing();
        c.fresh('p2');
        c.loud('p2');
        expect(c.calls).toEqual(['hold', 'resume r1', 'hold']);
        expect(c.counters.get('yield_repauses')).toBe(1);

        const d = await continuing();
        d.speaker.playing = 'r2';
        await waitFor('it to be let go', () => d.counters.get('yield_reply_gone') === 1, 500);
        // Counted as speaking (announced, holding back the next reply as today), and nothing is stopped
        expect(d.spoke).toEqual([['p1', false]]);
        expect(d.counters.get('yield_continuing_released')).toBe(1);
        // A late answer, words or an end for the old reply never stop the new one
        d.asks.get('p1')!.go(false);
        d.control.words('t-p1', 'stop');
        d.control.ended('t-p1', 'text');
        expect(d.spoke).toEqual([['p1', false]]);
        expect(d.calls.filter((x) => x.startsWith('stop') || x === 'bargeIn')).toEqual([]);
    });

    it('two people: it goes on only when both qualify', async () => {
        const c = controlled();
        c.fresh('p1', 5000);
        c.fresh('p2', 0, true);
        c.loud('p1');
        c.loud('p2');
        await sleep(450);
        expect(c.calls).toEqual(['hold']);
        c.fresh('p2', 5000);
        await waitFor('the voice to go on', () => c.calls.includes('resume r1'), 1000);
    });

    it('not for the comparison policies', async () => {
        const c = controlled('dip', { watchdogMs: 700 });
        c.fresh('p1', 5000);
        c.loud('p1');
        await waitFor('the watchdog', () => c.counters.get('yield_watchdog') === 1, 1500);
        expect(c.counters.get('yield_continues')).toBe(0);
    });
});

describe('going on needs the whole stretch: words or lost audio from before the gate, and skips inside the detector, still count', () => {
    /** The real hearing and the real control together; the detector's view of p1 is set by hand (fresh, no speech, unbroken). */
    function composed(script: { partials?: [number, string][]; firstDroppedMs?: number } = {}) {
        const counters = new Counters();
        const calls: string[] = [];
        const speaker: YieldSpeaker = {
            playingId: 'r1',
            hold: () => (calls.push('hold'), 'r1'),
            resume: (id) => (calls.push(`resume ${id}`), true),
            setGain: () => undefined,
        };
        const view = { ageMs: 20, quietMs: 60_000, speech: false, stream: 1, droppedMs: 0 };
        const observer: SessionObserver = {
            frame: () => undefined,
            drop: () => undefined,
            baseline: () => undefined,
            close: () => undefined,
            heard: () => view,
            confirm: () => () => undefined,
        };
        const control = new YieldControl({ policy: 'hold', counters, speaker, observer, silenceMs: 300, freshMs: 300, watchdogMs: 1500 });
        control.onStopHeld = () => calls.push('stop held');
        const spoke: boolean[] = [];
        const recognition = new Recognition({
            factory: (events) => {
                let pushes = 0;
                return {
                    push: () => {
                        pushes++;
                        for (const [at, text] of script.partials ?? []) if (at === pushes) events.partial(text);
                    },
                    finish: () => events.final(''),
                    close: () => undefined,
                };
            },
            maxUtteranceMs: 180000,
            pauseMs: 400,
            counters,
            send: () => undefined,
            onSpeaking: (_, stop) => spoke.push(stop),
            interruptions: control,
        });
        let first = true;
        /** A steady fan, in real time: it keeps the stretch open. */
        const fan = async (ms: number, droppedMs = 0) => {
            for (let t = 0; t < ms; t += 100) {
                for (let f = 0; f < 5; f++) {
                    const lost = first ? (script.firstDroppedMs ?? 0) : f === 0 && t === 0 ? droppedMs : 0;
                    first = false;
                    recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: tone(NOISE_HZ), droppedMs: lost });
                }
                await sleep(100);
            }
        };
        return { counters, calls, spoke, fan, control, recognition };
    }

    it('the control case: a fan with nothing before the gate goes on after the quiet window, the stretch still open', async () => {
        const c = composed();
        await c.fan(900);
        expect(c.calls).toEqual(['hold', 'resume r1']);
        expect(c.counters.get('yield_continues')).toBe(1);
        expect(c.spoke).toEqual([]);
        c.recognition.dispose();
        c.control.close();
    });

    it('a word heard and taken back before the gate (partial "hello" at 20 ms, empty at 40 ms): never goes on, never resolved empty', async () => {
        const c = composed({ partials: [[1, 'hello'], [2, '']] });
        await c.fan(1800);
        expect(c.calls).not.toContain('resume r1');
        expect(c.counters.get('yield_continues')).toBe(0);
        expect(c.counters.get('yield_resumes')).toBe(0);
        // Nothing settled while paused: today's stop, once
        expect(c.counters.get('yield_watchdog')).toBe(1);
        expect(c.counters.get('yield_stops')).toBe(1);
        expect(c.spoke).toEqual([true]);
        c.recognition.dispose();
        c.control.close();
    });

    it('20 ms of audio missing before the gate: never goes on, never resolved empty', async () => {
        const c = composed({ firstDroppedMs: 20 });
        await c.fan(1800);
        expect(c.calls).not.toContain('resume r1');
        expect(c.counters.get('yield_continues')).toBe(0);
        expect(c.counters.get('yield_resumes')).toBe(0);
        expect(c.counters.get('yield_watchdog')).toBe(1);
        expect(c.counters.get('yield_stops')).toBe(1);
        c.recognition.dispose();
        c.control.close();
    });

    it('audio missing after the gate: no going on while paused; a stop, once, while going on', async () => {
        const paused = composed();
        await paused.fan(200);
        await paused.fan(1700, 20);
        expect(paused.calls).not.toContain('resume r1');
        expect(paused.counters.get('yield_stops')).toBe(1);
        paused.recognition.dispose();
        paused.control.close();

        const going = composed();
        await going.fan(900);
        expect(going.calls).toEqual(['hold', 'resume r1']);
        await going.fan(300, 20);
        expect(going.counters.get('yield_continuing_audio_missing')).toBe(1);
        expect(going.counters.get('yield_stops')).toBe(1);
        expect(going.spoke).toEqual([true]);
        going.recognition.dispose();
        going.control.close();
    });

    /**
     * The real observer with a small shared queue: other people's half windows fill it, so 20 ms of p1 is skipped. The
     * skip is shorter than the reset (100 ms), so p1's run of audio (its stream number) goes on; it must still show.
     */
    async function skipping() {
        const d = detector();
        const counters = new Counters();
        const observer = new SpeechObserver({ counters, load: async () => d.model, maxQueuedMsTotal: 64 });
        await observer.ready();
        const session = observer.session('s1');
        const calls: string[] = [];
        const speaker: YieldSpeaker = {
            playingId: 'r1',
            hold: () => (calls.push('hold'), 'r1'),
            resume: (id) => (calls.push(`resume ${id}`), true),
            setGain: () => undefined,
        };
        const control = new YieldControl({ policy: 'hold', counters, speaker, observer: session, silenceMs: 300, freshMs: 300, watchdogMs: 1500 });
        control.onStopHeld = () => calls.push('stop held');
        const spoke: boolean[] = [];
        let at = 0;
        /** p1's fan, 20 ms at a time, in real time. */
        const fan = async (ms: number) => {
            for (let t = 0; t < ms; t += 20) {
                session.frame({ participantId: 'p1', epoch: 1, pcm16k: tone(NOISE_HZ, 320, at), droppedMs: 0 });
                at += 320;
                await settle();
                await sleep(15);
            }
        };
        /** Others' half windows fill the shared queue, one 20 ms frame of p1 is refused, then the others leave. */
        const skip = async () => {
            const before = counters.get('observer_overloads');
            for (let i = 2; counters.get('observer_overloads') === before && i < 60; i++) session.frame({ participantId: `p${i}`, epoch: 1, pcm16k: tone(NOISE_HZ), droppedMs: 0 });
            const full = counters.get('observer_overloads');
            const view = session.heard('p1', 1)!;
            session.frame({ participantId: 'p1', epoch: 1, pcm16k: tone(NOISE_HZ, 320, at), droppedMs: 0 });
            at += 320;
            expect(counters.get('observer_overloads')).toBe(full + 1);
            session.drop((p) => p !== 'p1');
            return view;
        };
        const loud = () => control.loud({ participantId: 'p1', epoch: 1, turnId: 't1', heard: '', everWords: false, missingMs: 0 }, (stop) => spoke.push(stop));
        return { counters, calls, spoke, fan, skip, loud, session, control, observer };
    }

    it('20 ms skipped inside the detector while paused: the same stream, but it shows, and the reply never goes on', async () => {
        const s = await skipping();
        await s.fan(320);
        expect(s.loud()).toBe(true);
        await s.fan(160);
        const before = await s.skip();
        await s.fan(160);
        const after = s.session.heard('p1', 1)!;
        expect(after.stream).toBe(before.stream);
        expect(after.droppedMs).toBe(before.droppedMs + 20);
        // Fresh, unbroken-looking quiet from then on, until the pause deadline
        for (const until = performance.now() + 4000; !s.counters.get('yield_stops') && performance.now() < until; ) await s.fan(100);
        expect(s.calls).not.toContain('resume r1');
        expect(s.counters.get('yield_continues')).toBe(0);
        expect(s.counters.get('yield_watchdog')).toBe(1);
        expect(s.counters.get('yield_stops')).toBe(1);
        s.control.close();
        await s.observer.dispose();
    });

    it('20 ms skipped inside the detector while going on: a stop, once', async () => {
        const s = await skipping();
        await s.fan(320);
        expect(s.loud()).toBe(true);
        await s.fan(800);
        expect(s.calls).toEqual(['hold', 'resume r1']);
        await s.skip();
        await s.fan(320);
        expect(s.counters.get('yield_continuing_view_lost')).toBe(1);
        expect(s.counters.get('yield_stops')).toBe(1);
        expect(s.spoke).toEqual([true]);
        await s.fan(320);
        expect(s.counters.get('yield_stops')).toBe(1);
        s.control.close();
        await s.observer.dispose();
    });
});

describe('the speaker, held and let go', () => {
    /** A reply whose every 20 ms frame carries its own number, so order and gaps can be read off what was sent. */
    function numbered(frames: number) {
        const sent: { n: number; at: number }[] = [];
        const progress: unknown[] = [];
        const target: OutputTarget = { participantId: 'p', epoch: 1, plays: () => true, reach: () => 'alone', sendFrame: (f) => sent.push({ n: f.pcm24k[0], at: performance.now() }), clear: () => undefined };
        const counters = new Counters();
        const speaker = new Speaker({
            counters,
            voice: {
                async *speak() {
                    for (let i = 1; i <= frames; i++) yield new Int16Array(480).fill(i);
                },
            },
            maxReplyMs: 60000,
            speechTimeoutMs: 5000,
            targets: () => [target],
            active: () => true,
            progress: (m) => progress.push(m),
        });
        return { speaker, sent, progress, counters };
    }

    it('goes on from the exact frame, in real time, with no burst and no finished message in between', async () => {
        const s = numbered(40);
        s.speaker.enqueue('r1', 'x');
        await waitFor('some of it', () => s.sent.length >= 10, 2000);
        expect(s.speaker.hold()).toBe('r1');
        await sleep(60);
        const atHold = s.sent.length;
        await sleep(400);
        expect(s.sent.length).toBe(atHold);
        expect(s.progress.some((m) => (m as { finished: boolean }).finished)).toBe(false);
        expect(s.speaker.resume('nope')).toBe(false);
        expect(s.speaker.resume('r1')).toBe(true);
        await waitFor('the end', () => s.progress.some((m) => (m as { finished: boolean }).finished), 3000);
        expect(s.sent.map((f) => f.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
        // After the pause, frames come at the pace of speech: ten frames take about 200 ms, not a burst
        const after = s.sent.slice(atHold, atHold + 11);
        expect(after[10].at - after[0].at).toBeGreaterThan(150);
        expect(s.progress.at(-1)).toMatchObject({ finished: true, interrupted: false, reason: 'completed', playedMs: 800 });
        expect(s.counters.get('playback_held_ms')).toBeGreaterThanOrEqual(400);
        await s.speaker.shutdown();
    });

    it('a hold that comes after the last frame was sent does not keep the reply: it ends as completed', async () => {
        const s = numbered(10);
        s.speaker.enqueue('r1', 'x');
        await waitFor('every frame sent', () => s.sent.length === 10, 2000);
        s.speaker.hold();
        await waitFor('the end', () => s.progress.some((m) => (m as { finished: boolean }).finished), 500);
        expect(s.progress.at(-1)).toMatchObject({ finished: true, interrupted: false, reason: 'completed', playedMs: 200 });
        expect(s.speaker.playingId).toBeUndefined();
        await s.speaker.shutdown();
    });

    it('a hold while waiting for audio that then runs out: the reply ends as completed, not kept', async () => {
        let finish!: () => void;
        const sent: number[] = [];
        const progress: { finished: boolean; reason?: string; interrupted?: boolean }[] = [];
        const target: OutputTarget = { participantId: 'p', epoch: 1, plays: () => true, reach: () => 'alone', sendFrame: (f) => sent.push(f.pcm24k[0]), clear: () => undefined };
        const speaker = new Speaker({
            counters: new Counters(),
            voice: {
                async *speak() {
                    for (let i = 1; i <= 5; i++) yield new Int16Array(480).fill(i);
                    await new Promise<void>((resolve) => (finish = resolve));
                },
            },
            maxReplyMs: 60000,
            speechTimeoutMs: 5000,
            targets: () => [target],
            active: () => true,
            progress: (m) => progress.push(m as never),
        });
        speaker.enqueue('r1', 'x');
        await waitFor('the audio so far', () => sent.length === 5, 2000);
        speaker.hold();
        await sleep(50);
        finish();
        await waitFor('the end', () => progress.some((m) => m.finished), 500);
        expect(progress.at(-1)).toMatchObject({ finished: true, interrupted: false, reason: 'completed' });
        await speaker.shutdown();
    });

    it('a stop, a retract or closing during a hold ends it for good: never resumed', async () => {
        for (const how of ['bargeIn', 'retract', 'shutdown'] as const) {
            const s = numbered(40);
            s.speaker.enqueue('r1', 'x');
            await waitFor('some of it', () => s.sent.length >= 5, 2000);
            s.speaker.hold();
            await sleep(40);
            if (how === 'bargeIn') s.speaker.bargeIn();
            else if (how === 'retract') s.speaker.retract('r1');
            else await s.speaker.shutdown();
            await waitFor('the end', () => s.progress.some((m) => (m as { finished: boolean }).finished), 2000);
            expect(s.speaker.playingId, how).toBeUndefined();
            expect(s.speaker.resume('r1'), how).toBe(false);
            const count = s.sent.length;
            await sleep(100);
            expect(s.sent.length, how).toBe(count);
            if (how !== 'shutdown') await s.speaker.shutdown();
        }
    });
});

// End to end.
const LONG = 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends.';
const rigs: Rig[] = [];
const humans: FakeHuman[] = [];
const lkPeople: Room[] = [];
const timers: NodeJS.Timeout[] = [];
afterEach(async () => {
    for (const t of timers.splice(0)) clearInterval(t);
    for (const room of lkPeople.splice(0)) await room.disconnect().catch(() => undefined);
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

type Progress = Extract<Rig['fromWorker'][number], { type: 'playback.progress' }>;

describe("end to end over a person's own connection (proximity), the bot speaking", () => {
    async function bubble(yieldBots: boolean | WorkerOptions['yieldBots'], script: ConstructorParameters<typeof FakeEars>[0] = []) {
        const d = detector();
        const bots = yieldBots === true ? { botIds: new Set(['bot1']), policy: 'hold' as const } : yieldBots || undefined;
        const r = await startRig({
            recognizer: new FakeEars(script).factory,
            speechObserver: { load: async () => d.model },
            ...(bots ? { yieldBots: bots } : {}),
        });
        rigs.push(r);
        r.calls.spaceUsers(r.game.spaceName, [{ spaceUserId: 'alice', uuid: 'uuid-alice', tags: [], name: 'alice' } as never]);
        const alice = new FakeHuman('alice');
        humans.push(alice);
        r.game.humans.set('alice', alice);
        r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'alice', initiator: false } }));
        for (const signal of await alice.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal } }));
        await waitFor('the audio connection', () => r.fromWorker.some((m) => m.type === 'participant.join'));
        // Her microphone is on all along, silent between sounds, as a browser's is
        const mic = (hz: number) => {
            alice.stopMic();
            alice.startMic(hz);
        };
        mic(0);
        const finished = (segmentId: string) => r.fromWorker.filter((m): m is Progress => m.type === 'playback.progress' && m.segmentId === segmentId && m.finished);
        return { r, alice, mic, finished };
    }

    it('a hum pauses the bot, announces no one, and it goes on from the same spot to the end', async () => {
        const { r, alice, mic, finished } = await bubble(true);
        await waitFor('the detector to hear her', () => r.worker.counters.get('observer_windows_accepted') > 10, 5000);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        mic(NOISE_HZ);
        await sleep(500);
        mic(0);
        await waitFor('the pause', () => r.worker.counters.get('yield_holds') === 1, 1000);
        const heldAt = alice.audioPackets;
        await sleep(600);
        // Paused: nothing new is sent (already sent audio has drained)
        expect(alice.audioPackets - heldAt).toBeLessThan(15);
        await waitFor('the bot to go on', () => r.worker.counters.get('yield_resumes') === 1, 6000);
        await waitFor('the end of the reply', () => finished('seg-1').length > 0, 15_000);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(finished('seg-1')[0].playedMs).toBe(finished('seg-1')[0].totalMs);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);
        expect(r.worker.counters.get('barge_ins')).toBe(0);
        expect(r.worker.counters.get('yield_stops')).toBe(0);
        expect(r.violations).toEqual([]);
    }, 40_000);

    it('her voice pauses the bot at once and then stops it for good, announced once', async () => {
        const { r, alice, mic, finished } = await bubble(true);
        await waitFor('the detector to hear her', () => r.worker.counters.get('observer_windows_accepted') > 10, 5000);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        const spokeAt = performance.now();
        mic(VOICE_HZ);
        await waitFor('the pause', () => r.worker.counters.get('yield_holds') === 1, 1000);
        const pausedIn = performance.now() - spokeAt;
        await waitFor('the voice to stop', () => finished('seg-1').length > 0, 3000);
        const stoppedIn = performance.now() - spokeAt;
        mic(0);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(r.worker.counters.get('yield_confirmed_detector')).toBe(1);
        // Paused as fast as today's stop (the gate's time), stopped for good soon after
        expect(pausedIn).toBeLessThan(400);
        expect(stoppedIn).toBeLessThan(700);
        expect(r.violations).toEqual([]);
    }, 30_000);

    it('a steady fan: the bot pauses, then goes on while the fan stays, announcing no one; a voice inside the same stretch then stops it', async () => {
        const { r, alice, mic, finished } = await bubble(true);
        const n = r.worker.counters;
        await waitFor('the detector to hear her', () => n.get('observer_windows_accepted') > 10, 5000);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        mic(NOISE_HZ);
        await waitFor('the pause', () => n.get('yield_holds') === 1, 1000);
        await waitFor('the bot to go on over the fan', () => n.get('yield_continues') === 1, 4000);
        const goingAt = alice.audioPackets;
        await sleep(800);
        // Going on: the bot is heard again while the fan stays on and its stretch stays open
        expect(alice.audioPackets - goingAt).toBeGreaterThan(25);
        expect(finished('seg-1')).toHaveLength(0);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);
        expect(n.get('yield_watchdog')).toBe(0);
        expect(n.get('yield_holds')).toBe(1);
        // Someone starts talking inside the same stretch, with no gap: stopped for good, announced once
        const spokeAt = performance.now();
        mic(VOICE_HZ);
        await waitFor('the voice to stop', () => finished('seg-1').length > 0, 3000);
        const stoppedIn = performance.now() - spokeAt;
        mic(0);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(n.get('yield_confirmed_detector_while_continuing')).toBe(1);
        expect(n.get('yield_repauses')).toBe(0);
        expect(stoppedIn).toBeLessThan(700);
        expect(r.violations).toEqual([]);
    }, 30_000);

    it('a steady fan that outlasts the reply: the reply ends normally, then the open stretch counts as speaking, as today', async () => {
        const { r, alice, mic, finished } = await bubble(true);
        const n = r.worker.counters;
        await waitFor('the detector to hear her', () => n.get('observer_windows_accepted') > 10, 5000);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        mic(NOISE_HZ);
        await waitFor('the bot to go on over the fan', () => n.get('yield_continues') === 1, 4000);
        await waitFor('the end of the reply', () => finished('seg-1').length > 0, 15_000);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
        await waitFor('the open stretch to count as speaking', () => r.fromWorker.some((m) => m.type === 'user.speech_started'), 1000);
        expect(n.get('yield_continuing_released')).toBe(1);
        mic(0);
        await waitFor('the stretch to end', () => r.fromWorker.some((m) => m.type === 'user.turn'), 6000);
        const order = r.fromWorker.filter((m) => m.type === 'user.speech_started' || m.type === 'user.turn').map((m) => m.type);
        expect(order).toEqual(['user.speech_started', 'user.turn']);
        expect(r.violations).toEqual([]);
    }, 40_000);

    it('a soft voice the detector misses, inside the same fan-held stretch: its words, when they come, stop the bot', async () => {
        // The fan's stretch carries words that only show up after 3 s of its audio: someone speaking under the fan
        const { r, alice, mic, finished } = await bubble(true, [{ text: 'so anyway', wordMs: 3000 }]);
        const n = r.worker.counters;
        await waitFor('the detector to hear her', () => n.get('observer_windows_accepted') > 10, 5000);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        mic(NOISE_HZ);
        await waitFor('the bot to go on over the fan', () => n.get('yield_continues') === 1, 4000);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);
        await waitFor('the words to stop it', () => finished('seg-1').length > 0, 4000);
        mic(0);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(n.get('yield_confirmed_words_while_continuing')).toBe(1);
        expect(n.get('observer_speech_windows')).toBe(0);
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(r.violations).toEqual([]);
    }, 30_000);

    it('the switch-off procedure: named in VOICE_YIELD_BOTS the hum pauses and goes on; restarted without it, the same hum stops as today', async () => {
        const on = optionsFromEnv({ VOICE_SPEECH_OBSERVER: '1', VOICE_SPEECH_OBSERVER_MODEL: '/model.onnx', VOICE_YIELD_BOTS: 'other, bot1' });
        const off = optionsFromEnv({ VOICE_SPEECH_OBSERVER: '1', VOICE_SPEECH_OBSERVER_MODEL: '/model.onnx' });
        expect(off.yieldBots).toBeUndefined();
        for (const [settings, pauses] of [
            [on.yieldBots, true],
            [off.yieldBots, false],
        ] as const) {
            const { r, alice, mic, finished } = await bubble(settings ?? false);
            await waitFor('the detector to hear her', () => r.worker.counters.get('observer_windows_accepted') > 10, 5000);
            r.calls.say(r.game.spaceName, 'seg-1', LONG);
            await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
            mic(NOISE_HZ);
            await sleep(500);
            mic(0);
            if (pauses) {
                await waitFor('the bot to go on', () => r.worker.counters.get('yield_resumes') === 1, 6000);
                await waitFor('the end of the reply', () => finished('seg-1').length > 0, 15_000);
                expect(finished('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
            } else {
                await waitFor('the voice to stop', () => finished('seg-1').length > 0, 3000);
                expect(finished('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
                expect(r.worker.counters.get('yield_episodes')).toBe(0);
            }
        }
    }, 60_000);

    it('a bot not in the rollout: the same hum stops it as today', async () => {
        const { r, alice, mic, finished } = await bubble(false);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        mic(NOISE_HZ);
        await waitFor('the voice to stop', () => finished('seg-1').length > 0, 3000);
        mic(0);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.worker.counters.get('yield_episodes')).toBe(0);
        expect(r.worker.counters.get('observer_decide_asked')).toBe(0);
    }, 30_000);
});

const HTTP_URL = process.env.LIVEKIT_HTTP_URL ?? 'http://127.0.0.1:7880';
const WS_URL = process.env.LIVEKIT_WS_URL ?? 'ws://127.0.0.1:7880';
const API_KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const API_SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret-secret-secret-secret-12345';
const serverUp = await fetch(HTTP_URL, { signal: AbortSignal.timeout(1500) }).then(
    (r) => r.ok,
    () => false
);

let roomCount = 0;
describe.skipIf(!serverUp)('end to end in a LiveKit room, the bot speaking', () => {
    async function room() {
        const d = detector();
        // A room of its own: other files' LiveKit tests use the default room on the same server at the same time
        const r = await startRig({ recognizer: new FakeEars([]).factory, speechObserver: { load: async () => d.model }, yieldBots: { botIds: new Set(['bot1']), policy: 'hold' }, spaceName: `yield-${++roomCount}-${process.pid}` });
        rigs.push(r);
        r.calls.spaceUsers(r.game.spaceName, [{ spaceUserId: 'carol', uuid: 'uuid-carol', tags: [], name: 'carol' } as never]);
        const invitation = new AccessToken(API_KEY, API_SECRET, { identity: r.game.botId, name: r.game.botId });
        invitation.addGrant({ room: r.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
        r.calls.handlePrivateEvent(
            privateEvent(r.game, r.game.botId, { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await invitation.toJwt(), serverUrl: WS_URL } }, { tags: ['bot'], uuid: 'bot-1' })
        );

        const room = new Room();
        lkPeople.push(room);
        const t = new AccessToken(API_KEY, API_SECRET, { identity: 'carol', name: 'carol' });
        t.addGrant({ room: r.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
        await room.connect(WS_URL, await t.toJwt(), { autoSubscribe: true, dynacast: false });
        const source = new AudioSource(48000, 1);
        await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('microphone', source), new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
        let hz = 0;
        let phase = 0;
        timers.push(
            setInterval(() => {
                const samples = new Int16Array(480);
                for (let i = 0; i < samples.length; i++) {
                    samples[i] = hz === 0 ? 0 : Math.round(8000 * Math.sin(phase));
                    phase += (2 * Math.PI * (hz || 1)) / 48000;
                }
                source.captureFrame(new AudioFrame(samples, 48000, 1, 480)).catch(() => undefined);
            }, 10)
        );
        const n = r.worker.counters;
        await waitFor('carol to be heard in the room', () => n.get('observer_accepted_ms_room') > 300, 15_000);
        const finished = (segmentId: string) => r.fromWorker.filter((m): m is Progress => m.type === 'playback.progress' && m.segmentId === segmentId && m.finished);
        return { r, n, finished, mic: (to: number) => (hz = to) };
    }

    it('a hum pauses the bot and it goes on to the end; then a voice stops it, announced once', async () => {
        const { r, n, finished, mic } = await room();
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to speak', () => n.get('segments_started') >= 1, 5000);
        await sleep(500);
        mic(NOISE_HZ);
        await sleep(500);
        mic(0);
        await waitFor('the pause', () => n.get('yield_holds') === 1, 1000);
        await waitFor('the bot to go on', () => n.get('yield_resumes') === 1, 6000);
        await waitFor('the end of the reply', () => finished('seg-1').length > 0, 15_000);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(finished('seg-1')[0].playedMs).toBe(finished('seg-1')[0].totalMs);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);

        r.calls.say(r.game.spaceName, 'seg-2', LONG);
        await waitFor('the bot to speak again', () => n.get('segments_started') >= 2, 5000);
        await sleep(500);
        mic(VOICE_HZ);
        await waitFor('the voice to stop', () => finished('seg-2').length > 0, 3000);
        mic(0);
        await sleep(300);
        expect(finished('seg-2')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(n.get('yield_confirmed_detector')).toBe(1);
        expect(r.violations).toEqual([]);
    }, 60_000);

    it('a steady fan: the bot pauses, goes on while the fan stays, then a voice inside the same stretch stops it', async () => {
        const { r, n, finished, mic } = await room();
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to speak', () => n.get('segments_started') >= 1, 5000);
        await sleep(500);
        mic(NOISE_HZ);
        await waitFor('the pause', () => n.get('yield_holds') === 1, 1000);
        await waitFor('the bot to go on over the fan', () => n.get('yield_continues') === 1, 4000);
        await sleep(800);
        expect(finished('seg-1')).toHaveLength(0);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);
        mic(VOICE_HZ);
        await waitFor('the voice to stop', () => finished('seg-1').length > 0, 3000);
        mic(0);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(n.get('yield_confirmed_detector_while_continuing')).toBe(1);
        expect(r.violations).toEqual([]);
    }, 60_000);
});
