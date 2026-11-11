// The speech detector deciding (speechObserver.ts `confirm`, recognition.ts `confirmSpeech`): a sound loud enough for
// long enough counts as someone speaking, which stops the bot's voice and holds back its reply, only once the detector
// also hears speech from that person; and as today whenever the detector cannot tell. The detector is made here: it
// calls a window speech when the sound is loud and low (a voice-like 200 Hz tone) and not speech when it is high (a
// 1.2 kHz hum standing in for a fan, typing or a knock), so no model or runtime is needed. Both ways audio reaches the bot
// are covered end to end: a person's own connection (proximity) with the bot speaking, and a LiveKit room.
import { AccessToken, TrackSource as GrantSource } from 'livekit-server-sdk';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { afterEach, describe, expect, it } from 'vitest';
import { Counters } from '../src/counters.ts';
import { FakeEars } from '../src/recognizer.ts';
import { Recognition } from '../src/recognition.ts';
import type { OutgoingMessage } from '../src/session.ts';
import { CONTEXT, type DetectorModel, SpeechObserver, type SpeechObserverSettings, STATE } from '../src/speechObserver.ts';
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

/** A detector that judges each window by its sound, or (held) never answers. */
function detector(mode: 'judge' | 'held' | 'fails' = 'judge') {
    let calls = 0;
    const model: DetectorModel = {
        run: (input) => {
            calls++;
            if (mode === 'held') return new Promise(() => undefined);
            if (mode === 'fails') return Promise.reject(new Error('detector failed'));
            return Promise.resolve({ probability: judgeWindow(input), state: new Float32Array(STATE) });
        },
        release: async () => undefined,
    };
    return { model, calls: () => calls };
}

const tone = (hz: number, samples = 320, start = 0): Int16Array => Int16Array.from({ length: samples }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * hz * (start + i)) / 16000)));
const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

function deciding(mode: 'judge' | 'held' | 'fails' = 'judge', settings: Partial<Omit<SpeechObserverSettings, 'load'>> = {}) {
    const d = detector(mode);
    const counters = new Counters();
    const observer = new SpeechObserver({ counters, load: async () => d.model, decides: true, ...settings });
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
        let went = 0;
        const done = session.confirm(who, epoch, () => went++);
        return { went: () => went, done };
    };
    return { ...d, counters, observer, session, feed, asked };
}

describe('the detector deciding whether a loud sound is someone speaking', () => {
    it('watching only, it changes nothing: the answer is yes at once, as today', async () => {
        const o = deciding('judge', { decides: false });
        await o.observer.ready();
        o.feed(NOISE_HZ, 200);
        await settle();
        const a = o.asked();
        expect(a.went()).toBe(1);
        expect(o.counters.get('observer_decide_asked')).toBe(0);
    });

    it('already hearing speech from them: yes at once', async () => {
        const o = deciding();
        await o.observer.ready();
        o.feed(VOICE_HZ, 200);
        await settle();
        const a = o.asked();
        expect(a.went()).toBe(1);
        expect(o.counters.get('observer_decide_confirmed')).toBe(1);
        expect(o.counters.get('observer_decide_at_once')).toBe(1);
    });

    it('speech that the detector hears a moment after the gate: yes as soon as it does, once', async () => {
        const o = deciding();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100);
        await settle();
        const a = o.asked();
        expect(a.went()).toBe(0);
        o.feed(VOICE_HZ, 40);
        await settle();
        // One window of speech is not yet enough evidence (64 ms)
        expect(a.went()).toBe(0);
        o.feed(VOICE_HZ, 200);
        await settle();
        expect(a.went()).toBe(1);
        o.feed(VOICE_HZ, 400);
        await settle();
        a.done();
        expect(a.went()).toBe(1);
        expect(o.counters.get('observer_decide_confirmed')).toBe(1);
        expect(o.counters.get('observer_decide_held')).toBe(0);
        expect(o.counters.get('observer_decide_fallback')).toBe(0);
    });

    it('only a noise: never yes, however long it goes on; counted when the stretch ends', async () => {
        const o = deciding();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100);
        await settle();
        const a = o.asked();
        for (let i = 0; i < 15; i++) {
            o.feed(NOISE_HZ, 100);
            await settle();
            await sleep(70);
        }
        expect(a.went()).toBe(0);
        a.done();
        expect(o.counters.get('observer_decide_held')).toBe(1);
        // Over: speech later in another stretch is that stretch's own question, never this one's
        o.feed(VOICE_HZ, 300);
        await settle();
        expect(a.went()).toBe(0);
        expect(o.counters.get('observer_decide_fallback')).toBe(0);
    }, 10_000);

    it('their audio stops while it waits: no answer is made up for silence that never came', async () => {
        const o = deciding();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100);
        await settle();
        const a = o.asked();
        await sleep(1300);
        expect(a.went()).toBe(0);
        expect(o.counters.get('observer_decide_fallback')).toBe(0);
    });

    it('cannot tell (not loaded yet, not watching them, another path): yes at once, as today', async () => {
        let loaded!: (m: DetectorModel) => void;
        const counters = new Counters();
        const loading = new SpeechObserver({ counters, load: () => new Promise((resolve) => (loaded = resolve)), decides: true });
        const s = loading.session('s1');
        s.frame({ participantId: 'p1', epoch: 1, pcm16k: tone(NOISE_HZ), droppedMs: 0 });
        let went = 0;
        s.confirm('p1', 1, () => went++);
        expect(went).toBe(1);
        loaded(detector().model);

        const o = deciding('judge', { maxStreams: 1 });
        await o.observer.ready();
        o.feed(NOISE_HZ, 100, 'p1');
        o.feed(NOISE_HZ, 100, 'p2');
        await settle();
        // p2 is beyond the limit, so not watched
        expect(o.asked('p2').went()).toBe(1);
        // p1 on a newer path than the one being watched
        expect(o.asked('p1', 2).went()).toBe(1);
        // Someone it has never been given
        expect(o.asked('p9').went()).toBe(1);
        expect(o.counters.get('observer_decide_fallback')).toBe(3);
        // p1 as watched: waits
        expect(o.asked('p1', 1).went()).toBe(0);
    });

    it('falling behind (no answer for audio it was given): yes, as today', async () => {
        const o = deciding('held');
        await o.observer.ready();
        o.feed(NOISE_HZ, 64);
        await settle();
        const a = o.asked();
        for (let i = 0; i < 10; i++) {
            o.feed(NOISE_HZ, 100);
            await sleep(80);
            if (a.went()) break;
        }
        expect(a.went()).toBe(1);
        expect(o.counters.get('observer_decide_fallback')).toBe(1);
    });

    it('the detector failing until it switches itself off: whoever waited is decided as today, and so is everyone after', async () => {
        const o = deciding('fails', { maxFailures: 2 });
        await o.observer.ready();
        // Less than one window: watched, nothing asked of the detector yet
        o.feed(NOISE_HZ, 20);
        await settle();
        const a = o.asked();
        expect(a.went()).toBe(0);
        o.feed(NOISE_HZ, 200);
        await settle();
        // Its window failed: the one waiting is decided as today
        expect(a.went()).toBe(1);
        for (let i = 0; i < 10 && o.observer.stats().status === 'on'; i++) {
            o.feed(NOISE_HZ, 100);
            await settle();
        }
        expect(o.observer.stats().status).toBe('off');
        expect(o.asked().went()).toBe(1);
    });

    it('someone no longer heard, or a session that closed: nothing of theirs is ever acted on', async () => {
        const o = deciding();
        await o.observer.ready();
        o.feed(NOISE_HZ, 100, 'p1');
        o.feed(NOISE_HZ, 100, 'p2');
        await settle();
        const a = o.asked('p1');
        const b = o.asked('p2');
        o.session.drop((participantId) => participantId === 'p1');
        o.feed(VOICE_HZ, 300, 'p1');
        await settle();
        expect(a.went()).toBe(0);
        o.session.close();
        await sleep(1100);
        expect(b.went()).toBe(0);
        expect(o.counters.get('observer_decide_held')).toBe(0);
    });
});

describe('a stretch of loud sound waits for the detector before it counts as speaking', () => {
    function hearing(confirm: (participantId: string, epoch: number, go: () => void) => () => void) {
        const sent: OutgoingMessage[] = [];
        const spoke: string[] = [];
        const recognition = new Recognition({
            factory: new FakeEars(['']).factory,
            maxUtteranceMs: 180000,
            pauseMs: 400,
            counters: new Counters(),
            send: (m) => sent.push(m),
            onSpeaking: (p) => spoke.push(p),
            confirmSpeech: confirm,
        });
        const feed = (pcm: () => Int16Array, ms: number) => {
            for (let t = 0; t < ms; t += 20) recognition.sink({ participantId: 'p1', epoch: 1, pcm16k: pcm(), droppedMs: 0 });
        };
        return { recognition, sent, spoke, loud: (ms: number) => feed(() => tone(440), ms), quiet: (ms: number) => feed(() => new Int16Array(320), ms), started: () => sent.filter((m) => m.type === 'user.speech_started').length };
    }

    it('not yet speech: no speech_started, the bot is not stopped; then speech once, when the detector says so', () => {
        let go: (() => void) | undefined;
        let asked = 0;
        let settled = 0;
        const h = hearing((_, __, g) => {
            asked++;
            go = g;
            return () => settled++;
        });
        h.loud(400);
        expect(asked).toBe(1);
        expect(h.started()).toBe(0);
        expect(h.spoke).toEqual([]);
        go!();
        go!();
        h.loud(200);
        expect(h.started()).toBe(1);
        expect(h.spoke).toEqual(['p1']);
        expect(asked).toBe(1);
        // Answered: nothing to settle when the stretch ends
        h.quiet(500);
        expect(settled).toBe(0);
    });

    it('never speech: the stretch ends with nothing announced, the one asked is told it is over, and a late yes changes nothing', () => {
        let go: (() => void) | undefined;
        let settled = 0;
        const h = hearing((_, __, g) => {
            go = g;
            return () => settled++;
        });
        h.loud(600);
        h.quiet(500);
        expect(settled).toBe(1);
        go!();
        expect(h.started()).toBe(0);
        expect(h.spoke).toEqual([]);
        expect(h.sent.filter((m) => m.type === 'user.turn')).toMatchObject([{ outcome: 'cleared' }]);
    });

    it('a yes at once is today exactly', () => {
        const h = hearing((_, __, g) => (g(), () => undefined));
        h.loud(80);
        expect(h.started()).toBe(0);
        h.loud(40);
        expect(h.started()).toBe(1);
        expect(h.spoke).toEqual(['p1']);
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

describe('end to end over a person\'s own connection (proximity), the bot speaking', () => {
    async function bubble(decides: boolean) {
        const d = detector();
        const r = await startRig({ recognizer: new FakeEars(['']).factory, speechObserver: { load: async () => d.model, decides } });
        rigs.push(r);
        r.calls.spaceUsers(r.game.spaceName, [{ spaceUserId: 'alice', uuid: 'uuid-alice', tags: [], name: 'alice' } as never]);
        const alice = new FakeHuman('alice');
        humans.push(alice);
        r.game.humans.set('alice', alice);
        r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'alice', initiator: false } }));
        for (const signal of await alice.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal } }));
        await waitFor('the audio connection', () => r.fromWorker.some((m) => m.type === 'participant.join'));
        const progress = (segmentId: string) => r.fromWorker.filter((m) => m.type === 'playback.progress' && m.segmentId === segmentId && m.finished) as Extract<(typeof r.fromWorker)[number], { type: 'playback.progress' }>[];
        return { r, alice, progress };
    }

    it('a long hum does not stop the bot or announce anyone; her voice then stops it quickly', async () => {
        const { r, alice, progress } = await bubble(true);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        alice.startMic(NOISE_HZ);
        await sleep(1500);
        alice.stopMic();
        expect(progress('seg-1')).toEqual([]);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);
        expect(r.worker.counters.get('barge_ins')).toBe(0);
        await waitFor('the hum to be let go', () => r.worker.counters.get('observer_decide_held') >= 1, 3000);

        const spokeAt = performance.now();
        alice.startMic(VOICE_HZ);
        await waitFor('the voice to stop', () => progress('seg-1').length > 0, 3000);
        const stoppedIn = performance.now() - spokeAt;
        alice.stopMic();
        expect(progress('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(r.worker.counters.get('observer_decide_confirmed')).toBe(1);
        // Today's limit for a stop is 300 ms here; the detector adds its windows (about 100 ms) on top
        expect(stoppedIn).toBeLessThan(500);
        expect(r.worker.counters.get('observer_decide_fallback')).toBe(0);
        expect(r.violations).toEqual([]);
    }, 30_000);

    it('watching only, the same hum stops the bot as today', async () => {
        const { r, alice, progress } = await bubble(false);
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => alice.loudFrames >= 25);
        alice.startMic(NOISE_HZ);
        await waitFor('the voice to stop', () => progress('seg-1').length > 0, 3000);
        alice.stopMic();
        expect(progress('seg-1')[0]).toMatchObject({ interrupted: true, reason: 'barge_in' });
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

describe.skipIf(!serverUp)('end to end in a LiveKit room', () => {
    it('a hum from someone in the room announces no one; their voice does, once', async () => {
        const d = detector();
        const r = await startRig({ recognizer: new FakeEars(['']).factory, speechObserver: { load: async () => d.model, decides: true } });
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
        await waitFor('carol to be heard in the room', () => n.get('observer_offered_ms_room') > 300, 15_000);

        hz = NOISE_HZ;
        await sleep(1500);
        hz = 0;
        await waitFor('the hum to be let go', () => n.get('observer_decide_held') >= 1, 4000);
        expect(r.fromWorker.some((m) => m.type === 'user.speech_started')).toBe(false);

        hz = VOICE_HZ;
        await waitFor('her voice to be announced', () => r.fromWorker.some((m) => m.type === 'user.speech_started'), 3000);
        hz = 0;
        await sleep(300);
        expect(r.fromWorker.filter((m) => m.type === 'user.speech_started')).toHaveLength(1);
        expect(n.get('observer_decide_confirmed')).toBe(1);
        expect(n.get('observer_decide_fallback')).toBe(0);
        expect(n.get('observer_accepted_ms_room')).toBeGreaterThan(0);
        expect(r.violations).toEqual([]);
    }, 40_000);
});
