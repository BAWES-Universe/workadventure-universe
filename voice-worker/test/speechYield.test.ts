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
    const model: DetectorModel = {
        run: (input) => {
            if (mode === 'held') return new Promise(() => undefined);
            if (mode === 'fails') return Promise.reject(new Error('detector failed'));
            return Promise.resolve({ probability: judgeWindow(input), state: new Float32Array(STATE) });
        },
        release: async () => undefined,
    };
    return { model };
}

const tone = (hz: number, samples = 320, start = 0): Int16Array => Int16Array.from({ length: samples }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * hz * (start + i)) / 16000)));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe('a stop word', () => {
    it('counts as the first words of a stretch, as a whole word, in English and Arabic', () => {
        for (const yes of ['stop', 'Stop!', 'wait', 'please stop', 'ok wait a sec', 'hold on', 'وقف', 'خلاص', 'استنى شوي']) expect(isStopCommand(yes), yes).toBe(true);
    });
    it('not "no", not inside another word, not turned around, not in passing', () => {
        for (const no of ['no', 'no no', 'stopwatch', 'waiting', "don't stop", 'do not stop', 'لا توقف', 'I would never want it to stop', '', 'mm-hm']) expect(isStopCommand(no), no).toBe(false);
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
        return { counters, observer, session, feed, asked };
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
        await sleep(250);
        expect(o.session.heard('p1', 1)!.ageMs).toBeGreaterThanOrEqual(250);
        expect(o.session.heard('p1', 2)).toBeUndefined();
        o.session.drop(() => true);
        expect(o.session.heard('p1', 1)).toBeUndefined();
    });
});

describe('hearing tells the control how each stretch it was asked about ended', () => {
    function hearing(script: (string | FakeUtterance)[], answer: boolean, maxUtteranceMs = 180000) {
        const sent: OutgoingMessage[] = [];
        const spoke: [string, boolean][] = [];
        const log: string[] = [];
        let speech: ((stop: boolean) => void) | undefined;
        const control: Interruptions = {
            loud: (turn, s) => {
                log.push(`loud ${turn.participantId}`);
                speech = s;
                return answer;
            },
            words: (_, text) => log.push(`words ${text}`),
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
            interruptions: { loud: () => true, words: () => undefined, ended: (_, how) => ended.push(how) },
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

    it('a hole in the audio or the limit: "lost"', () => {
        const gap = hearing([''], true);
        gap.loud(200);
        gap.loud(100, 500);
        gap.quiet(500);
        expect(gap.log.filter((l) => l.startsWith('ended'))).toEqual(['ended lost']);
        const cap = hearing([''], true, 600);
        cap.loud(800);
        expect(cap.log.filter((l) => l.startsWith('ended'))).toEqual(['ended lost']);
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
    const views = new Map<string, { ageMs: number; quietMs: number; speech: boolean }>();
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
    const loud = (p: string, turnId = `t-${p}`) => control.loud({ participantId: p, epoch: 1, turnId }, (stop) => spoke.push([p, stop]));
    const fresh = (p: string, quietMs = 0, speech = false) => views.set(p, { ageMs: 20, quietMs, speech });
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
        c.views.set('p1', { ageMs: 900, quietMs: 0, speech: false });
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
        c.views.set('p1', { ageMs: 900, quietMs: 900, speech: false });
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

describe('the speaker, held and let go', () => {
    /** A reply whose every 20 ms frame carries its own number, so order and gaps can be read off what was sent. */
    function numbered(frames: number) {
        const sent: { n: number; at: number }[] = [];
        const progress: unknown[] = [];
        const target: OutputTarget = { participantId: 'p', epoch: 1, plays: () => true, sendFrame: (f) => sent.push({ n: f.pcm24k[0], at: performance.now() }), clear: () => undefined };
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
    async function bubble(yieldBots: boolean) {
        const d = detector();
        const r = await startRig({
            recognizer: new FakeEars([]).factory,
            speechObserver: { load: async () => d.model },
            ...(yieldBots ? { yieldBots: { botIds: new Set(['bot1']), policy: 'hold' as const } } : {}),
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

describe.skipIf(!serverUp)('end to end in a LiveKit room, the bot speaking', () => {
    it('a hum pauses the bot and it goes on to the end; then a voice stops it, announced once', async () => {
        const d = detector();
        const r = await startRig({ recognizer: new FakeEars([]).factory, speechObserver: { load: async () => d.model }, yieldBots: { botIds: new Set(['bot1']), policy: 'hold' } });
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

        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to speak', () => n.get('segments_started') >= 1, 5000);
        await sleep(500);
        hz = NOISE_HZ;
        await sleep(500);
        hz = 0;
        await waitFor('the pause', () => n.get('yield_holds') === 1, 1000);
        await waitFor('the bot to go on', () => n.get('yield_resumes') === 1, 6000);
        await waitFor('the end of the reply', () => finished('seg-1').length > 0, 15_000);
        expect(finished('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(finished('seg-1')[0].playedMs).toBe(finished('seg-1')[0].totalMs);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);

        r.calls.say(r.game.spaceName, 'seg-2', LONG);
        await waitFor('the bot to speak again', () => n.get('segments_started') >= 2, 5000);
        await sleep(500);
        hz = VOICE_HZ;
        await waitFor('the voice to stop', () => finished('seg-2').length > 0, 3000);
        hz = 0;
        await sleep(300);
        expect(finished('seg-2')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(n.get('yield_confirmed_detector')).toBe(1);
        expect(r.violations).toEqual([]);
    }, 60_000);
});
