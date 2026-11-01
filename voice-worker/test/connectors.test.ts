// Providers chosen per bubble: the registry, streaming speech, and what the worker tells the bot server about each call.
// Everything here is a fake connector registered by the test: no provider, no key that works, no network beyond loopback.
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry, ProviderError, type RecognitionConnector, Secret, type SpeechConnector, type SpeechRequest } from '../src/connectors.ts';
import { Counters } from '../src/counters.ts';
import { FakeEars } from '../src/recognizer.ts';
import { TTS_FRAME_SAMPLES } from '../src/audioFormat.ts';
import type { BotToWorker, PlaybackProgress, WorkerToBot } from '../src/protocol.ts';
import { Speaker } from '../src/speaker.ts';
import { VoiceWorker, type WorkerOptions } from '../src/server.ts';
import type { OutputFrame, OutputTarget } from '../src/transport.ts';
import { checkMessage } from '../src/validate.ts';
import { FakeHuman, sleep, waitFor } from './harness.ts';

/** Audio of a given length: a 440 Hz tone at 24 kHz, loud enough to count as heard. */
const tone = (ms: number): Int16Array => Int16Array.from({ length: (ms / 20) * TTS_FRAME_SAMPLES }, (_, i) => Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / 24000)));

class Gate {
    private release!: () => void;
    readonly opened = new Promise<void>((resolve) => (this.release = resolve));
    open(): void {
        this.release();
    }
}

// ---- the speaker, on its own ----

interface SpeakerRig {
    speaker: Speaker;
    frames: OutputFrame[];
    progress: Omit<PlaybackProgress, 'type' | 'sessionId' | 'ts'>[];
    provider: { ok: number; failed: (number | undefined)[] };
    counters: Counters;
    finished(id: string): Omit<PlaybackProgress, 'type' | 'sessionId' | 'ts'> | undefined;
}

function speakerRig(speak: (request: { text: string; lang?: string; signal: AbortSignal }) => AsyncIterable<Int16Array>, options: { maxReplyMs?: number; speechTimeoutMs?: number } = {}): SpeakerRig {
    const frames: OutputFrame[] = [];
    const progress: SpeakerRig['progress'] = [];
    const provider = { ok: 0, failed: [] as (number | undefined)[] };
    const counters = new Counters();
    const target: OutputTarget = { participantId: 'p', epoch: 1, plays: () => true, sendFrame: (f) => frames.push(f), clear: () => undefined };
    const speaker = new Speaker({
        counters,
        voice: { speak },
        provider: { ok: () => provider.ok++, failed: (status) => provider.failed.push(status) },
        maxReplyMs: options.maxReplyMs ?? 60000,
        speechTimeoutMs: options.speechTimeoutMs ?? 5000,
        targets: () => [target],
        active: () => true,
        progress: (m) => progress.push(m),
    });
    return { speaker, frames, progress, provider, counters, finished: (id) => progress.find((p) => p.segmentId === id && p.finished) };
}

describe('speech is played as it arrives', () => {
    it('plays the first audio before the whole reply is made', async () => {
        const gate = new Gate();
        let finishedMaking = false;
        const r = speakerRig(async function* () {
            yield tone(200);
            await gate.opened;
            yield tone(200);
            finishedMaking = true;
        });
        r.speaker.enqueue('s1', 'a long reply');
        await waitFor('the first frames', () => r.frames.length >= 5, 2000);
        // The rest of the reply does not exist yet
        expect(finishedMaking).toBe(false);
        expect(r.finished('s1')).toBeUndefined();
        const before = r.frames.length;
        // The first chunk is 200 ms, so it runs dry and the speaker waits for the provider instead of ending the reply
        await sleep(400);
        expect(r.frames.length).toBeLessThanOrEqual(10);
        expect(r.finished('s1')).toBeUndefined();
        gate.open();
        await waitFor('the reply to end', () => r.finished('s1') !== undefined, 2000);
        expect(r.frames.length).toBe(20);
        expect(before).toBeLessThan(20);
        expect(r.finished('s1')).toMatchObject({ reason: 'completed', interrupted: false, playedMs: 400, totalMs: 400 });
        expect(r.provider).toEqual({ ok: 1, failed: [] });
        await r.speaker.shutdown();
    });

    it('re-cuts chunks of any size into whole 20 ms frames, and pads the last one', async () => {
        const r = speakerRig(async function* () {
            yield new Int16Array(100).fill(1000);
            yield new Int16Array(0);
            yield new Int16Array(TTS_FRAME_SAMPLES + 37).fill(2000);
        });
        r.speaker.enqueue('s1', 'x');
        await waitFor('the reply to end', () => r.finished('s1') !== undefined, 2000);
        expect(r.frames.every((f) => f.pcm24k.length === TTS_FRAME_SAMPLES)).toBe(true);
        // 100 + 517 samples is 617: one whole frame and a second one padded with silence
        expect(r.frames).toHaveLength(2);
        expect(r.frames[0].pcm24k[99]).toBe(1000);
        expect(r.frames[0].pcm24k[100]).toBe(2000);
        expect(r.frames[1].pcm24k[136]).toBe(2000);
        expect(r.frames[1].pcm24k[137]).toBe(0);
        await r.speaker.shutdown();
    });

    it('stops at the longest a reply may play, reads no further than that, and closes the provider call', async () => {
        let made = 0;
        let aborted = false;
        const r = speakerRig(
            async function* (request) {
                request.signal.addEventListener('abort', () => (aborted = true));
                while (!request.signal.aborted && made < 1000) {
                    made++;
                    yield tone(200);
                }
            },
            { maxReplyMs: 600 }
        );
        r.speaker.enqueue('s1', 'endless');
        await waitFor('the reply to be cut', () => r.finished('s1') !== undefined, 3000);
        expect(r.finished('s1')).toMatchObject({ reason: 'limit', interrupted: true });
        expect(r.finished('s1')!.playedMs).toBe(600);
        expect(r.frames).toHaveLength(30);
        // It did not read the endless stream: only what the reply could play
        expect(made).toBeLessThanOrEqual(4);
        await waitFor('the call to be closed', () => aborted, 1000);
        expect(r.provider).toEqual({ ok: 1, failed: [] });
        await r.speaker.shutdown();
    });

    it('stops within a frame when talked over, drops what was queued, and closes the provider call', async () => {
        let aborted = false;
        const r = speakerRig(async function* (request) {
            request.signal.addEventListener('abort', () => (aborted = true));
            for (let i = 0; i < 100; i++) yield tone(200);
        });
        r.speaker.enqueue('s1', 'a long reply');
        r.speaker.enqueue('s2', 'queued behind it');
        await waitFor('the voice to start', () => r.frames.length >= 10, 2000);
        r.speaker.bargeIn();
        await waitFor('both to end', () => r.finished('s1') !== undefined && r.finished('s2') !== undefined, 2000);
        expect(r.finished('s1')).toMatchObject({ reason: 'barge_in', interrupted: true });
        expect(r.finished('s2')).toMatchObject({ reason: 'barge_in', interrupted: true, playedMs: 0 });
        const count = r.frames.length;
        await sleep(100);
        expect(r.frames.length).toBe(count);
        await waitFor('the call to be closed', () => aborted, 1000);
        // It made audio, so the provider did its job: one report, and it is a good one
        expect(r.provider).toEqual({ ok: 1, failed: [] });
        await r.speaker.shutdown();
    });

    it('reports nothing for a reply that was cut before the provider made any audio', async () => {
        const gate = new Gate();
        const r = speakerRig(async function* () {
            await gate.opened;
            yield tone(200);
        });
        r.speaker.enqueue('s1', 'slow to start');
        await sleep(50);
        r.speaker.stopAll('voice_stop');
        await waitFor('the reply to end', () => r.finished('s1') !== undefined, 2000);
        expect(r.finished('s1')).toMatchObject({ reason: 'voice_stop', playedMs: 0 });
        expect(r.provider).toEqual({ ok: 0, failed: [] });
        await r.speaker.shutdown();
    });
});

describe('a speech provider that fails', () => {
    it('ends the reply with reason provider, after whatever already played, and reports its HTTP status once', async () => {
        const r = speakerRig(async function* () {
            yield tone(200);
            throw new ProviderError('upstream broke', 503);
        });
        r.speaker.enqueue('s1', 'x');
        await waitFor('the reply to end', () => r.finished('s1') !== undefined, 2000);
        expect(r.finished('s1')).toMatchObject({ reason: 'provider', interrupted: true, playedMs: 200 });
        expect(r.provider).toEqual({ ok: 0, failed: [503] });
        expect(r.counters.get('tts_failed')).toBe(1);
        // The next reply is not held up by it
        await r.speaker.shutdown();
    });

    it('treats a provider that goes quiet for too long as failed, with no status', async () => {
        const r = speakerRig(async function* (request) {
            await new Promise((resolve) => request.signal.addEventListener('abort', resolve));
        }, { speechTimeoutMs: 150 });
        r.speaker.enqueue('s1', 'x');
        await waitFor('the reply to end', () => r.finished('s1') !== undefined, 2000);
        expect(r.finished('s1')).toMatchObject({ reason: 'provider', interrupted: true, playedMs: 0 });
        expect(r.provider).toEqual({ ok: 0, failed: [undefined] });
        await r.speaker.shutdown();
    });

    it('treats a reply with no audio at all as failed, and one that throws before it starts the same way', async () => {
        const r = speakerRig(async function* () {
            /* ends at once */
        });
        r.speaker.enqueue('s1', 'x');
        await waitFor('the first to end', () => r.finished('s1') !== undefined, 2000);
        expect(r.finished('s1')).toMatchObject({ reason: 'provider' });
        await r.speaker.shutdown();

        const sync = speakerRig(() => {
            throw new ProviderError('no', 401);
        });
        sync.speaker.enqueue('s1', 'x');
        await waitFor('it to end', () => sync.finished('s1') !== undefined, 2000);
        expect(sync.finished('s1')).toMatchObject({ reason: 'provider' });
        expect(sync.provider.failed).toEqual([401]);
        await sync.speaker.shutdown();
    });

    it('moves on to the next reply', async () => {
        let calls = 0;
        const r = speakerRig(async function* () {
            if (++calls === 1) throw new ProviderError('first fails', 500);
            yield tone(100);
        });
        r.speaker.enqueue('s1', 'x');
        r.speaker.enqueue('s2', 'y');
        await waitFor('both to end', () => r.finished('s2') !== undefined, 2000);
        expect(r.finished('s1')?.reason).toBe('provider');
        expect(r.finished('s2')).toMatchObject({ reason: 'completed', playedMs: 100 });
        expect(r.provider).toEqual({ ok: 1, failed: [500] });
        await r.speaker.shutdown();
    });
});

// ---- the worker, through the bridge ----

const KEY_A = 'sk-alpha-0123456789-SECRET';
const KEY_B = 'sk-bravo-9876543210-SECRET';

/** The bot server's side of the bridge, reduced to a socket that records everything and checks it against the schema. */
class RawBot {
    readonly received: WorkerToBot[] = [];
    /** Every text frame the worker sent, as it went over the wire. */
    readonly wire: string[] = [];
    readonly violations: string[] = [];
    private readonly humans = new Map<string, FakeHuman>();

    private constructor(private readonly ws: WebSocket) {
        ws.on('message', (data) => {
            const text = data.toString();
            this.wire.push(text);
            const message = JSON.parse(text) as WorkerToBot;
            const problem = checkMessage('fromWorker', message);
            if (problem) this.violations.push(problem);
            this.received.push(message);
            if (message.type === 'lane.signal') void this.humans.get(`${message.sessionId}/${message.participantId}`)?.accept(JSON.stringify(message.signal));
        });
    }

    static async connect(port: number): Promise<RawBot> {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge?botId=bot1`);
        await new Promise((resolve, reject) => {
            ws.once('open', resolve);
            ws.once('error', reject);
        });
        return new RawBot(ws);
    }

    send(message: Record<string, unknown>): void {
        const problem = checkMessage('fromBot', message);
        if (problem) this.violations.push(`to worker: ${problem}`);
        this.ws.send(JSON.stringify(message));
    }

    /** Sends without checking, for a message that is meant to be wrong. */
    sendUnchecked(message: Record<string, unknown>): void {
        this.ws.send(JSON.stringify(message));
    }

    of<T extends WorkerToBot['type']>(type: T, sessionId?: string): Extract<WorkerToBot, { type: T }>[] {
        return this.received.filter((m) => m.type === type && (!sessionId || m.sessionId === sessionId)) as Extract<WorkerToBot, { type: T }>[];
    }

    progress(sessionId: string, segmentId: string) {
        return this.of('playback.progress', sessionId).find((m) => m.segmentId === segmentId && m.finished);
    }

    async join(sessionId: string, human: FakeHuman, epoch = 1): Promise<void> {
        this.humans.set(`${sessionId}/${human.id}`, human);
        this.send({ type: 'lane.open', sessionId, participantId: human.id, epoch });
        human.deliver = (signal) => this.send({ type: 'lane.signal', sessionId, participantId: human.id, epoch, signal: JSON.parse(signal) });
        for (const signal of await human.offer()) this.send({ type: 'lane.signal', sessionId, participantId: human.id, epoch, signal: JSON.parse(signal) });
        await waitFor('the audio connection', () => this.of('participant.join', sessionId).some((m) => m.participantId === human.id));
    }

    close(): void {
        this.ws.terminate();
    }
}

const rigs: { worker: VoiceWorker; bot: RawBot }[] = [];
const humans: FakeHuman[] = [];

async function start(connectors: ConnectorRegistry, options: Partial<WorkerOptions> = {}) {
    const worker = new VoiceWorker({ port: 0, host: '127.0.0.1', maxLanes: 50, maxSessionsPerConnection: 8, ice: { iceServers: [] }, connectors, ...options });
    const bot = await RawBot.connect(await worker.listen());
    rigs.push({ worker, bot });
    return { worker, bot };
}

const open = (bot: RawBot, sessionId: string, extra: Record<string, unknown> = {}) => bot.send({ type: 'session.open', sessionId, bubbleId: `bubble-${sessionId}`, botId: 'bot1', ...extra });

const speech = (adapter: string, key: string, voiceId = `voice-${adapter}`) => ({ adapter, model: `model-${adapter}`, voiceId, key });
const recognition = (adapter: string, key: string) => ({ adapter, model: `model-${adapter}`, key });

afterEach(async () => {
    vi.restoreAllMocks();
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const { worker, bot } of rigs.splice(0)) {
        bot.close();
        await worker.close().catch(() => undefined);
    }
});

/** A speech connector that records what it was asked and makes `ms` of audio. */
function recordingSpeech(ms: number, hold?: () => Promise<void>) {
    const requests: SpeechRequest[] = [];
    const connector: SpeechConnector = {
        async *speak(request) {
            requests.push(request);
            await hold?.();
            yield tone(ms);
        },
    };
    return { connector, requests };
}

describe('two bubbles with two different connectors', () => {
    it('speaks and hears with the connector each bubble named, at the same time', async () => {
        // Neither reply can start making audio until both connectors have been called: the two run at once or the test times out
        const called = new Gate();
        let calls = 0;
        const both = async () => {
            if (++calls === 2) called.open();
            await called.opened;
        };
        const voiceA = recordingSpeech(1000, both);
        const voiceB = recordingSpeech(2000, both);
        const earsA = new FakeEars(['alpha one']);
        const earsB = new FakeEars(['bravo two']);
        const heardWith: string[] = [];
        const hearing = (name: string, ears: FakeEars): RecognitionConnector => ({
            listen: (settings, events) => {
                heardWith.push(`${name}:${settings.model}:${settings.key.reveal()}`);
                return ears.factory(events);
            },
        });
        const registry = new ConnectorRegistry()
            .registerSpeech('voice-a', voiceA.connector)
            .registerSpeech('voice-b', voiceB.connector)
            .registerRecognition('ears-a', hearing('a', earsA))
            .registerRecognition('ears-b', hearing('b', earsB));
        const { bot } = await start(registry);
        const alice = new FakeHuman('alice');
        const bob = new FakeHuman('bob');
        humans.push(alice, bob);

        open(bot, 's1', { speech: speech('voice-a', KEY_A), recognition: recognition('ears-a', KEY_A) });
        open(bot, 's2', { speech: speech('voice-b', KEY_B), recognition: recognition('ears-b', KEY_B) });
        await waitFor('both sessions', () => bot.of('session.start').length === 2);
        await bot.join('s1', alice);
        await bot.join('s2', bob);

        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'for alice', committed: true });
        bot.send({ type: 'bot.say', sessionId: 's2', segmentId: 'g2', text: 'for bob', committed: true });
        await waitFor('both replies to end', () => !!bot.progress('s1', 'g1') && !!bot.progress('s2', 'g2'), 8000);

        // Each connector got its own bubble's settings, and only its own
        expect(voiceA.requests).toHaveLength(1);
        expect(voiceB.requests).toHaveLength(1);
        expect(voiceA.requests[0].text).toBe('for alice');
        expect(voiceA.requests[0].settings).toMatchObject({ adapter: 'voice-a', model: 'model-voice-a', voiceId: 'voice-voice-a' });
        expect(voiceA.requests[0].settings.key.reveal()).toBe(KEY_A);
        expect(voiceB.requests[0].settings).toMatchObject({ adapter: 'voice-b', voiceId: 'voice-voice-b' });
        expect(voiceB.requests[0].settings.key.reveal()).toBe(KEY_B);
        // Each person heard their own bubble's voice: one second against two
        expect(bot.progress('s1', 'g1')).toMatchObject({ reason: 'completed', playedMs: 1000 });
        expect(bot.progress('s2', 'g2')).toMatchObject({ reason: 'completed', playedMs: 2000 });
        expect(alice.audioPackets).toBeGreaterThan(40);
        expect(alice.audioPackets).toBeLessThan(75);
        expect(bob.audioPackets).toBeGreaterThan(85);

        // Each person's words went through the recognizer their own bubble named
        alice.startMic(440);
        await sleep(1000);
        alice.stopMic();
        await waitFor('alice\'s words', () => bot.of('user.turn', 's1').some((t) => t.outcome === 'final'), 6000);
        bob.startMic(440);
        await sleep(1000);
        bob.stopMic();
        await waitFor('bob\'s words', () => bot.of('user.turn', 's2').some((t) => t.outcome === 'final'), 6000);
        expect(bot.of('user.turn', 's1').filter((t) => t.outcome === 'final').map((t) => t.text)).toEqual(['alpha one']);
        expect(bot.of('user.turn', 's2').filter((t) => t.outcome === 'final').map((t) => t.text)).toEqual(['bravo two']);
        expect(heardWith).toEqual([`a:model-ears-a:${KEY_A}`, `b:model-ears-b:${KEY_B}`]);
        expect(bot.violations).toEqual([]);
    }, 30000);

    it('hands the bubble\'s language, the reply\'s language and the expression to its connector', async () => {
        const voice = recordingSpeech(100);
        const { bot } = await start(new ConnectorRegistry().registerSpeech('voice-a', voice.connector));
        open(bot, 's1', { speech: { ...speech('voice-a', KEY_A), language: 'ar', endpoint: 'https://tts.example/v1', region: 'eu' }, expression: 'expressive' });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'one', committed: true });
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g2', text: 'two', committed: true, lang: 'en' });
        await waitFor('both replies', () => !!bot.progress('s1', 'g2'));
        expect(voice.requests.map((r) => r.lang)).toEqual(['ar', 'en']);
        expect(voice.requests[0].expression).toBe('expressive');
        expect(voice.requests[0].settings).toMatchObject({ endpoint: 'https://tts.example/v1', region: 'eu', language: 'ar' });
    });

    it('uses the built-in test engine when a bubble names nothing, and says nothing about providers', async () => {
        const { bot } = await start(new ConnectorRegistry());
        open(bot, 's1');
        await waitFor('the session', () => bot.of('session.start').length === 1);
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'hello there', committed: true });
        await waitFor('the reply', () => !!bot.progress('s1', 'g1'));
        expect(bot.progress('s1', 'g1')).toMatchObject({ interrupted: false, playedMs: 0 });
        expect(bot.progress('s1', 'g1')!.totalMs).toBeGreaterThan(0);
        expect(bot.of('provider.ok')).toEqual([]);
        expect(bot.of('provider.failed')).toEqual([]);
    });

    it('can be named explicitly: the test engine is registered as "fake"', async () => {
        const { bot } = await start(new ConnectorRegistry());
        open(bot, 's1', { speech: speech('fake', 'unused') });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'hello there', committed: true });
        await waitFor('the reply', () => !!bot.progress('s1', 'g1'));
        expect(bot.of('provider.ok')).toMatchObject([{ part: 'speech', adapter: 'fake' }]);
    });
});

describe('an adapter the worker does not have', () => {
    it('ends each spoken reply in text, with reason provider, and says which adapter and that no HTTP status was involved', async () => {
        const { bot } = await start(new ConnectorRegistry());
        open(bot, 's1', { speech: speech('nosuch', KEY_A) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'anyone there', committed: true });
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g2', text: 'still nothing', committed: true });
        await waitFor('both replies', () => !!bot.progress('s1', 'g2'));
        for (const id of ['g1', 'g2']) expect(bot.progress('s1', id)).toMatchObject({ finished: true, interrupted: true, reason: 'provider', playedMs: 0 });
        expect(bot.of('provider.failed')).toEqual([
            expect.objectContaining({ part: 'speech', adapter: 'nosuch' }),
            expect.objectContaining({ part: 'speech', adapter: 'nosuch' }),
        ]);
        for (const failed of bot.of('provider.failed')) {
            expect(failed).not.toHaveProperty('status');
            expect(failed).not.toHaveProperty('rejected');
        }
        expect(bot.of('provider.ok')).toEqual([]);
        expect(bot.violations).toEqual([]);
    });

    it('does not touch another bubble on the same worker', async () => {
        const voice = recordingSpeech(200);
        const { bot } = await start(new ConnectorRegistry().registerSpeech('voice-a', voice.connector));
        open(bot, 's1', { speech: speech('nosuch', KEY_A) });
        open(bot, 's2', { speech: speech('voice-a', KEY_B) });
        await waitFor('both sessions', () => bot.of('session.start').length === 2);
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'x', committed: true });
        bot.send({ type: 'bot.say', sessionId: 's2', segmentId: 'g2', text: 'y', committed: true });
        await waitFor('both replies', () => !!bot.progress('s1', 'g1') && !!bot.progress('s2', 'g2'));
        expect(bot.progress('s1', 'g1')?.reason).toBe('provider');
        expect(bot.progress('s2', 'g2')?.interrupted).toBe(false);
    });

    it('hears nothing for a recognition adapter it does not have: the stretch ends with nothing to offer back, and the failure is reported', async () => {
        const { bot } = await start(new ConnectorRegistry());
        const alice = new FakeHuman('alice');
        humans.push(alice);
        open(bot, 's1', { recognition: recognition('nosuch', KEY_A) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        await bot.join('s1', alice);
        alice.startMic(440);
        await sleep(600);
        alice.stopMic();
        await waitFor('the end of the stretch', () => bot.of('user.turn', 's1').length > 0, 6000);
        expect(bot.of('user.turn', 's1').map((t) => t.outcome)).toEqual(['cleared']);
        const [failed] = bot.of('provider.failed', 's1');
        expect(failed).toMatchObject({ part: 'recognition', adapter: 'nosuch' });
        expect(failed).not.toHaveProperty('status');
        expect(bot.of('provider.ok')).toEqual([]);
        expect(bot.violations).toEqual([]);
    }, 20000);
});

describe('what the bot server is told about each provider call', () => {
    it('reports one ok per spoken reply', async () => {
        const voice = recordingSpeech(200);
        const { bot, worker } = await start(new ConnectorRegistry().registerSpeech('voice-a', voice.connector));
        open(bot, 's1', { speech: speech('voice-a', KEY_A) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        for (const id of ['g1', 'g2', 'g3']) bot.send({ type: 'bot.say', sessionId: 's1', segmentId: id, text: id, committed: true });
        await waitFor('all three', () => !!bot.progress('s1', 'g3'));
        expect(bot.of('provider.ok', 's1')).toEqual([
            expect.objectContaining({ part: 'speech', adapter: 'voice-a' }),
            expect.objectContaining({ part: 'speech', adapter: 'voice-a' }),
            expect.objectContaining({ part: 'speech', adapter: 'voice-a' }),
        ]);
        expect(bot.of('provider.failed')).toEqual([]);
        expect(worker.counters.get('provider_ok_speech')).toBe(3);
        expect(bot.violations).toEqual([]);
    });

    it('carries the part, the HTTP status, and rejected only when the key itself was refused', async () => {
        const failures = [401, 403, 429, 500, undefined];
        let n = 0;
        const connector: SpeechConnector = {
            // eslint-disable-next-line require-yield
            async *speak() {
                const status = failures[n++];
                throw new ProviderError('failed', status);
            },
        };
        const { bot } = await start(new ConnectorRegistry().registerSpeech('voice-a', connector));
        open(bot, 's1', { speech: speech('voice-a', KEY_A) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        for (let i = 0; i < failures.length; i++) bot.send({ type: 'bot.say', sessionId: 's1', segmentId: `g${i}`, text: 'x', committed: true });
        await waitFor('all of them', () => !!bot.progress('s1', `g${failures.length - 1}`));
        const reports = bot.of('provider.failed', 's1').map(({ part, adapter, status, rejected }) => ({ part, adapter, status, rejected }));
        expect(reports).toEqual([
            { part: 'speech', adapter: 'voice-a', status: 401, rejected: true },
            { part: 'speech', adapter: 'voice-a', status: 403, rejected: true },
            { part: 'speech', adapter: 'voice-a', status: 429, rejected: undefined },
            { part: 'speech', adapter: 'voice-a', status: 500, rejected: undefined },
            { part: 'speech', adapter: 'voice-a', status: undefined, rejected: undefined },
        ]);
        // Left out, not null: the schema (checked on every message) rejects anything else
        expect(bot.of('provider.failed')[4]).not.toHaveProperty('status');
        expect(bot.of('provider.failed')[2]).not.toHaveProperty('rejected');
        expect(bot.violations).toEqual([]);
    });

    it('reports a stretch of speech the provider answered, and one it gave up on with the status and the words so far', async () => {
        let n = 0;
        const connector: RecognitionConnector = {
            listen: (_settings, events) => {
                const first = ++n === 1;
                let said = false;
                return {
                    push: () => {
                        if (said) return;
                        said = true;
                        if (!first) events.failed('half a sen', { status: 401 });
                    },
                    finish: () => events.final('a whole sentence'),
                    close: () => undefined,
                };
            },
        };
        const { bot } = await start(new ConnectorRegistry().registerRecognition('ears-a', connector));
        const alice = new FakeHuman('alice');
        humans.push(alice);
        open(bot, 's1', { recognition: recognition('ears-a', KEY_A) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        await bot.join('s1', alice);

        alice.startMic(440);
        await sleep(500);
        alice.stopMic();
        await waitFor('the first stretch', () => bot.of('user.turn', 's1').length === 1, 6000);
        expect(bot.of('user.turn', 's1')[0]).toMatchObject({ outcome: 'final', text: 'a whole sentence' });
        expect(bot.of('provider.ok', 's1')).toEqual([expect.objectContaining({ part: 'recognition', adapter: 'ears-a' })]);

        alice.startMic(440);
        await sleep(500);
        alice.stopMic();
        await waitFor('the second stretch', () => bot.of('user.turn', 's1').length === 2, 6000);
        expect(bot.of('user.turn', 's1')[1]).toMatchObject({ outcome: 'lost', reason: 'provider', text: 'half a sen' });
        expect(bot.of('provider.failed', 's1')).toEqual([expect.objectContaining({ part: 'recognition', adapter: 'ears-a', status: 401, rejected: true })]);
        expect(bot.violations).toEqual([]);
    }, 25000);

    it('treats a recognizer that throws as a failure at the provider, not a crash', async () => {
        const connector: RecognitionConnector = {
            listen: () => {
                throw new ProviderError('cannot start', 502);
            },
        };
        const { bot } = await start(new ConnectorRegistry().registerRecognition('ears-a', connector));
        const alice = new FakeHuman('alice');
        humans.push(alice);
        open(bot, 's1', { recognition: recognition('ears-a', KEY_A) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        await bot.join('s1', alice);
        alice.startMic(440);
        await sleep(500);
        alice.stopMic();
        await waitFor('the report', () => bot.of('provider.failed', 's1').length > 0, 6000);
        expect(bot.of('provider.failed', 's1')[0]).toMatchObject({ part: 'recognition', status: 502 });
    }, 20000);
});

describe('provider keys', () => {
    it('never appear in anything the worker sends, counts, serves or logs', async () => {
        const logged: string[] = [];
        for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args.map(String).join(' ')));
        // Connectors that do their worst: error text and a thrown object that name the key
        const speaking: SpeechConnector = {
            // eslint-disable-next-line require-yield
            async *speak(request) {
                throw new ProviderError(`bad key ${request.settings.key.reveal()} for ${JSON.stringify(request.settings)}`, 401);
            },
        };
        const hearing: RecognitionConnector = {
            listen: (settings) => ({
                push: () => {
                    throw new ProviderError(`refused ${settings.key.reveal()}`, 403);
                },
                finish: () => undefined,
                close: () => undefined,
            }),
        };
        const { bot, worker } = await start(new ConnectorRegistry().registerSpeech('voice-a', speaking).registerRecognition('ears-a', hearing));
        const alice = new FakeHuman('alice');
        humans.push(alice);
        open(bot, 's1', { speech: speech('voice-a', KEY_A), recognition: recognition('ears-a', KEY_B) });
        await waitFor('the session', () => bot.of('session.start').length === 1);
        await bot.join('s1', alice);
        bot.send({ type: 'bot.say', sessionId: 's1', segmentId: 'g1', text: 'x', committed: true });
        await waitFor('the speech failure', () => bot.of('provider.failed', 's1').some((m) => m.part === 'speech'));
        // A bubble opened wrongly (no voice): the refusal does not echo the key it came with
        bot.sendUnchecked({ type: 'session.open', sessionId: 's2', bubbleId: 'b2', botId: 'bot1', speech: { adapter: 'voice-a', model: 'm', key: KEY_A } });
        // A status report out of the worker, which carries the counters
        bot.send({ type: 'mode.set', sessionId: 's1', mode: 'talk' });
        alice.startMic(440);
        await waitFor('the recognition failure', () => bot.of('provider.failed', 's1').some((m) => m.part === 'recognition'), 6000);
        alice.stopMic();
        await waitFor('the status and the refusal', () => bot.of('engine.status').length > 0 && bot.of('error', 's2').length > 0);
        await sleep(100);

        expect(bot.of('provider.failed', 's1').map((m) => m.part).sort()).toEqual(['recognition', 'speech']);
        expect(bot.of('error', 's2')[0].code).toBe('invalid_message');
        const everything = [...bot.wire, JSON.stringify(worker.stats()), JSON.stringify(worker.counters.snapshot()), ...logged].join('\n');
        for (const key of [KEY_A, KEY_B]) {
            expect(everything).not.toContain(key);
            expect(everything).not.toContain(key.slice(3, 20));
        }
        expect(bot.violations).toEqual([]);
    }, 25000);

    it('print as a placeholder however they are logged or serialised', () => {
        const secret = new Secret(KEY_A);
        expect(`${secret}`).not.toContain(KEY_A);
        expect(JSON.stringify({ secret })).not.toContain(KEY_A);
        expect(String(secret)).not.toContain(KEY_A);
        expect(secret.reveal()).toBe(KEY_A);
    });
});
