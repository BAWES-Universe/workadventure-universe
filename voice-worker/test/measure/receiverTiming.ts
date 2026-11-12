// What a listener actually receives when someone talks or makes a noise over the bot: timestamps of the bot's audio as it
// ARRIVES at a person's connection (proximity: a werift peer decoding RTP; LiveKit: a room participant's AudioStream), on
// loopback, with SYNTHETIC input (tones from a fake microphone, a fake detector judging by pitch, scripted ears). Not a
// browser, not a phone, not a real network. Not part of the test suite (no .test.ts): run by hand.
//   npx tsx test/measure/receiverTiming.ts <out.json> [trials per case, default 10]
// For each transport, today's rule (a bot outside the rollout) and the pause (a bot in it):
//   voice: the bot is talking; a voice starts. When does the bot fall silent at the listener, and is it for good?
//   hum:   a 0.5 s noise. When does it fall silent, and when does it come back (pause only)?
//   fan:   a noise that stays on. Silent, back while it stays (pause only), then a voice: silent again for good.
// "Silent at the listener" is the arrival time of the last loud bot frame before a 100 ms gap with none.
import { writeFileSync } from 'node:fs';
import { AccessToken, TrackSource as GrantSource } from 'livekit-server-sdk';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { FakeEars } from '../../src/recognizer.ts';
import { CONTEXT, type DetectorModel, STATE } from '../../src/speechObserver.ts';
import { FakeHuman, type Rig, privateEvent, sleep, startRig, waitFor } from '../harness.ts';

const VOICE_HZ = 200;
const NOISE_HZ = 1200;
const LONG = 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends.';
const GAP_MS = 100;
const WS_URL = process.env.LIVEKIT_WS_URL ?? 'ws://127.0.0.1:7880';
const API_KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const API_SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret-secret-secret-secret-12345';

/** Speech when loud and low: few sign changes in the window. Quiet is never speech. (As in speechYield.test.ts.) */
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
const model: DetectorModel = { run: async (input) => ({ probability: judgeWindow(input), state: new Float32Array(STATE) }), release: async () => undefined };
const rms = (pcm: Int16Array): number => Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / Math.max(1, pcm.length));

interface Line {
    r: Rig;
    /** Arrival times of loud bot audio at the listener. */
    loud: number[];
    mic: (hz: number) => void;
    close: () => Promise<void>;
}

async function proximity(enrolled: boolean): Promise<Line> {
    const r = await startRig({
        recognizer: new FakeEars([]).factory,
        speechObserver: { load: async () => model },
        ...(enrolled ? { yieldBots: { botIds: new Set(['bot1']), policy: 'hold' as const } } : {}),
    });
    r.calls.spaceUsers(r.game.spaceName, [{ spaceUserId: 'alice', uuid: 'uuid-alice', tags: [], name: 'alice' } as never]);
    const alice = new FakeHuman('alice');
    r.game.humans.set('alice', alice);
    const loud: number[] = [];
    alice.onAudio = (isLoud) => {
        if (isLoud) loud.push(performance.now());
    };
    r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'alice', initiator: false } }));
    for (const signal of await alice.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal } }));
    await waitFor('the audio connection', () => r.fromWorker.some((m) => m.type === 'participant.join'));
    const mic = (hz: number) => {
        alice.stopMic();
        alice.startMic(hz);
    };
    mic(0);
    await waitFor('the detector to hear her', () => r.worker.counters.get('observer_windows_accepted') > 10, 5000);
    return {
        r,
        loud,
        mic,
        close: async () => {
            await alice.close();
            r.calls.shutdown();
            await r.worker.close();
        },
    };
}

async function livekit(enrolled: boolean): Promise<Line> {
    const r = await startRig({
        recognizer: new FakeEars([]).factory,
        speechObserver: { load: async () => model },
        ...(enrolled ? { yieldBots: { botIds: new Set(['bot1']), policy: 'hold' as const } } : {}),
        spaceName: `receiver-${enrolled ? 'pause' : 'today'}-${process.pid}`,
    });
    r.calls.spaceUsers(r.game.spaceName, [{ spaceUserId: 'carol', uuid: 'uuid-carol', tags: [], name: 'carol' } as never]);
    const invitation = new AccessToken(API_KEY, API_SECRET, { identity: r.game.botId, name: r.game.botId });
    invitation.addGrant({ room: r.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
    r.calls.handlePrivateEvent(
        privateEvent(r.game, r.game.botId, { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await invitation.toJwt(), serverUrl: WS_URL } }, { tags: ['bot'], uuid: 'bot-1' })
    );
    const room = new Room();
    const loud: number[] = [];
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== TrackKind.KIND_AUDIO || participant.identity !== r.game.botId) return;
        void (async () => {
            try {
                for await (const frame of new AudioStream(track, { sampleRate: 48000, numChannels: 1 })) if (rms(frame.data) > 300) loud.push(performance.now());
            } catch {
                /* closed */
            }
        })();
    });
    const t = new AccessToken(API_KEY, API_SECRET, { identity: 'carol', name: 'carol' });
    t.addGrant({ room: r.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
    await room.connect(WS_URL, await t.toJwt(), { autoSubscribe: true, dynacast: false });
    const source = new AudioSource(48000, 1);
    await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('microphone', source), new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    let hz = 0;
    let phase = 0;
    const timer = setInterval(() => {
        const samples = new Int16Array(480);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = hz === 0 ? 0 : Math.round(8000 * Math.sin(phase));
            phase += (2 * Math.PI * (hz || 1)) / 48000;
        }
        source.captureFrame(new AudioFrame(samples, 48000, 1, 480)).catch(() => undefined);
    }, 10);
    await waitFor('carol to be heard in the room', () => r.worker.counters.get('observer_accepted_ms_room') > 300, 15_000);
    return {
        r,
        loud,
        mic: (to) => (hz = to),
        close: async () => {
            clearInterval(timer);
            await room.disconnect().catch(() => undefined);
            r.calls.shutdown();
            await r.worker.close();
        },
    };
}

/** The last loud arrival at or after `from` that is followed by a gap of GAP_MS with none (or undefined while still loud). */
function silentAt(loud: number[], from: number, until = Infinity): number | undefined {
    const xs = loud.filter((t) => t >= from - 40 && t <= until);
    for (let i = 0; i < xs.length; i++) {
        const next = i + 1 < xs.length ? xs[i + 1] : until;
        if (next - xs[i] >= GAP_MS && xs[i] >= from - 20) return xs[i];
    }
    return undefined;
}
const firstAfter = (loud: number[], from: number) => loud.find((t) => t > from);
const countIn = (loud: number[], from: number, to: number) => loud.filter((t) => t > from && t <= to).length;

interface Trial {
    transport: string;
    behaviour: 'today' | 'pause';
    kind: 'voice' | 'hum' | 'fan';
    /** From the sound starting at the microphone to the bot falling silent at the listener. */
    silentMs?: number;
    /** It stopped for good (the reply ended as interrupted). */
    stopped: boolean;
    /** From the worker deciding to go on to the bot being heard again at the listener. */
    backMs?: number;
    /** Loud frames heard in the 500 ms after it came back (no burst: about 500 ms worth). */
    framesAfterBack?: number;
    /** Fan: from the voice starting to the bot falling silent for good. */
    voiceSilentMs?: number;
    /** The pause's own counters that moved during the trial (what it decided, and why). */
    why?: Record<string, number>;
}

async function trial(line: Line, transport: string, behaviour: 'today' | 'pause', kind: Trial['kind'], k: number): Promise<Trial> {
    const { r, loud, mic } = line;
    const n = r.worker.counters;
    const segmentId = `seg-${kind}-${k}`;
    const finished = () => r.fromWorker.find((m) => m.type === 'playback.progress' && m.segmentId === segmentId && m.finished) as { interrupted: boolean } | undefined;
    const startedLoud = loud.length;
    r.calls.say(r.game.spaceName, segmentId, LONG);
    await waitFor('the bot to be heard', () => loud.length - startedLoud >= 25, 10_000);
    await sleep(300);
    const resumesBefore = n.get('yield_resumes') + n.get('yield_continues');
    // When the worker decides to go on, to the nearest 5 ms
    let decidedAt: number | undefined;
    const watch = setInterval(() => {
        if (decidedAt === undefined && n.get('yield_resumes') + n.get('yield_continues') > resumesBefore) decidedAt = performance.now();
    }, 5);
    const before = n.snapshot() as Record<string, number>;
    const t0 = performance.now();
    const result: Trial = { transport, behaviour, kind, stopped: false };
    try {
        if (kind === 'voice') {
            mic(VOICE_HZ);
            await waitFor('the stop', () => finished() !== undefined, 4000);
            await sleep(300);
            mic(0);
            const at = silentAt(loud, t0);
            result.silentMs = at === undefined ? undefined : at - t0;
        } else if (kind === 'hum') {
            mic(NOISE_HZ);
            await sleep(500);
            mic(0);
            if (behaviour === 'today') await waitFor('the stop', () => finished() !== undefined, 4000);
            else await waitFor('the bot to go on', () => decidedAt !== undefined || finished() !== undefined, 8000);
            await sleep(700);
            const at = silentAt(loud, t0, decidedAt ?? Infinity);
            result.silentMs = at === undefined ? undefined : at - t0;
            if (decidedAt !== undefined) {
                const back = firstAfter(loud, decidedAt);
                result.backMs = back === undefined ? undefined : back - decidedAt;
                if (back !== undefined) result.framesAfterBack = countIn(loud, back, back + 500);
            }
        } else {
            mic(NOISE_HZ);
            if (behaviour === 'today') await waitFor('the stop', () => finished() !== undefined, 4000);
            else await waitFor('the bot to go on over the fan', () => decidedAt !== undefined || finished() !== undefined, 8000);
            await sleep(700);
            const at = silentAt(loud, t0, decidedAt ?? Infinity);
            result.silentMs = at === undefined ? undefined : at - t0;
            if (decidedAt !== undefined && !finished()) {
                const back = firstAfter(loud, decidedAt);
                result.backMs = back === undefined ? undefined : back - decidedAt;
                if (back !== undefined) result.framesAfterBack = countIn(loud, back, back + 500);
                const v0 = performance.now();
                mic(VOICE_HZ);
                await waitFor('the stop', () => finished() !== undefined, 4000);
                await sleep(300);
                const vat = silentAt(loud, v0);
                result.voiceSilentMs = vat === undefined ? undefined : vat - v0;
            }
            mic(0);
        }
        await waitFor('the reply to end', () => finished() !== undefined, 20_000);
        result.stopped = finished()!.interrupted;
        const after = n.snapshot() as Record<string, number>;
        result.why = Object.fromEntries(Object.entries(after).filter(([k, v]) => k.startsWith('yield_') && !k.endsWith('_ms') && v !== (before[k] ?? 0)).map(([k, v]) => [k.slice(6), v - (before[k] ?? 0)]));
    } finally {
        clearInterval(watch);
        mic(0);
    }
    await sleep(2000);
    return result;
}

const [outPath, trialsArg] = process.argv.slice(2);
if (!outPath) throw new Error('usage: receiverTiming.ts <out.json> [trials]');
const trials = Number(trialsArg ?? 10);
const results: Trial[] = [];
for (const [transport, make] of [
    ['proximity', proximity],
    ['livekit', livekit],
] as const) {
    for (const behaviour of ['today', 'pause'] as const) {
        const line = await make(behaviour === 'pause');
        try {
            for (const kind of behaviour === 'today' ? (['voice', 'hum'] as const) : (['voice', 'hum', 'fan'] as const)) {
                for (let k = 0; k < trials; k++) {
                    const t = await trial(line, transport, behaviour, kind, k);
                    results.push(t);
                    console.error(JSON.stringify(t));
                }
            }
        } finally {
            await line.close();
        }
    }
}
writeFileSync(outPath, JSON.stringify(results, null, 1) + '\n');
process.exit(0);
