// The pause on the BUILT worker image (round-2 review, step 2), run by hand against a container started by its own
// command. Real pieces: the image's worker, its speech detector (Silero), its Soniox connector, the bot server's relay,
// and a person on their own peer connection. One stand-in: the Soniox endpoint is a local fixture that hears no words
// (a successful empty result), named through the bubble's own `endpoint` setting, so the run is deterministic and free.
//
// The person's microphone plays recorded audio: a steady air conditioner, then a person speaking over it.
//   expect `pause` (the worker started as the image is, no settings): the bot pauses, goes on while the fan stays, then the
//     voice inside the same stretch stops it for good
//   expect `today` (the engineers' off switch: restarted with VOICE_SPEECH_OBSERVER=0): the fan stops it at once
//
//   tsx test/measure/imageYield.ts <worker port> <fixture port> <pause|today> <noise wav> <speech wav> <out json>
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { Encoder } from '@evan/opus';
import { RtpHeader, RtpPacket } from 'werift';
import { VoiceCalls } from '../../../bots/voice/VoiceCalls.ts';
import { WorkerLink } from '../../../bots/voice/VoiceLink.ts';
import type { FromWorker, ToWorker } from '../../../bots/voice/protocol.ts';
import { FakeGame, FakeHuman, privateEvent, sleep, waitFor } from '../harness.ts';

const [portArg, fixturePortArg, expect, noisePath, speechPath, outPath] = process.argv.slice(2);
if (!outPath || (expect !== 'pause' && expect !== 'today')) throw new Error('usage: imageYield.ts <worker port> <fixture port> <pause|today> <noise wav> <speech wav> <out json>');
const port = Number(portArg);
const fixturePort = Number(fixturePortArg);

// ---- The Soniox fixture: takes the config and the audio, hears nothing, finishes when told the audio ended ----
let fixtureStreams = 0;
const fixture = new WebSocketServer({ host: '127.0.0.1', port: fixturePort });
fixture.on('connection', (ws) => {
    fixtureStreams++;
    ws.on('message', (data, isBinary) => {
        if (!isBinary && data.toString() === '') ws.send(JSON.stringify({ tokens: [], finished: true }));
    });
});

// ---- Audio: 16 kHz mono WAV, set to a level, made 48 kHz for the person's Opus microphone ----
function wav16k(path: string): Int16Array {
    const b = readFileSync(path);
    let at = 12;
    while (at < b.length - 8) {
        const id = b.toString('ascii', at, at + 4);
        const size = b.readUInt32LE(at + 4);
        if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + size));
        at += 8 + size + (size % 2);
    }
    throw new Error(`no audio in ${path}`);
}
function atLevel(pcm: Int16Array, dbfs: number): Float64Array {
    let sum = 0;
    for (const v of pcm) sum += v * v;
    const gain = (32768 * 10 ** (dbfs / 20)) / Math.max(1, Math.sqrt(sum / pcm.length));
    return Float64Array.from(pcm, (v) => v * gain);
}
const up3 = (x: Float64Array): Float64Array => {
    const out = new Float64Array(x.length * 3);
    for (let i = 0; i < x.length; i++) {
        const a = x[i];
        const b = i + 1 < x.length ? x[i + 1] : a;
        out[3 * i] = a;
        out[3 * i + 1] = a + (b - a) / 3;
        out[3 * i + 2] = a + (2 * (b - a)) / 3;
    }
    return out;
};
const noise = up3(atLevel(wav16k(noisePath), -30));
const speech = up3(atLevel(wav16k(speechPath), -20));

// ---- The bot server's relay, to the container ----
const game = new FakeGame();
const fromWorker: FromWorker[] = [];
let link!: WorkerLink;
const calls = new VoiceCalls('bot1', game, (handlers) => {
    link = new WorkerLink({
        url: `ws://127.0.0.1:${port}`,
        botId: 'bot1',
        onMessage: (message) => {
            fromWorker.push(message);
            handlers.onMessage(message);
        },
        onUp: handlers.onUp,
        onDown: handlers.onDown,
    });
    const send = link.send.bind(link);
    // The bubble hears with Soniox, at the fixture: the worker's own connector, a deterministic answer
    link.send = (message: ToWorker) =>
        send(message.type === 'session.open' ? ({ ...message, recognition: { adapter: 'soniox', model: 'stt-rt-v6', key: 'fixture', endpoint: `ws://127.0.0.1:${fixturePort}`, language: 'en' } } as ToWorker) : message);
    link.start();
    return link;
});
await waitFor('the relay to reach the worker', () => link.isUp(), 15_000);

const counters = async (): Promise<Record<string, number>> => {
    const stats = (await (await fetch(`http://127.0.0.1:${port}/stats`)).json()) as { counters?: Record<string, number> };
    return stats.counters ?? {};
};

// ---- The person ----
calls.spaceUsers(game.spaceName, [{ spaceUserId: 'alice', uuid: 'uuid-alice', tags: [], name: 'alice' } as never]);
const alice = new FakeHuman('alice');
game.humans.set('alice', alice);
calls.handlePrivateEvent(privateEvent(game, 'alice', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'alice', initiator: false } }));
for (const signal of await alice.offer()) calls.handlePrivateEvent(privateEvent(game, 'alice', { $case: 'webRtcSignal', webRtcSignal: { signal } }));
await waitFor('the audio connection', () => fromWorker.some((m) => m.type === 'participant.join'), 15_000);

let source: 'silence' | 'noise' | 'noise+speech' = 'silence';
let noiseAt = 0;
let speechAt = 0;
const encoder = new Encoder({ channels: 1, sample_rate: 48000, application: 'voip' });
let seq = 1000;
let ts = 5000;
const mic = setInterval(() => {
    const frame = new Int16Array(960);
    for (let i = 0; i < frame.length; i++) {
        let v = 0;
        if (source !== 'silence') v += noise[noiseAt++ % noise.length];
        if (source === 'noise+speech') v += speech[speechAt++ % speech.length];
        frame[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
    }
    const header = new RtpHeader({ sequenceNumber: seq++ & 0xffff, timestamp: (ts += 960) >>> 0, payloadType: 111, ssrc: 4242, marker: false });
    try {
        alice.mic.writeRtp(new RtpPacket(header, Buffer.from(encoder.encode(frame))));
    } catch {
        /* closed */
    }
}, 20);

const start = performance.now();
const timeline: [number, string][] = [];
const note = (what: string) => timeline.push([Math.round(performance.now() - start), what]);
const finished = (id: string) => fromWorker.filter((m) => m.type === 'playback.progress' && m.segmentId === id && (m as { finished?: boolean }).finished) as unknown as { interrupted: boolean; reason: string; playedMs: number; totalMs: number }[];
const yieldOf = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([k, v]) => k.startsWith('yield_') && v));

await sleep(3000);
const LONG = 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends. ';
calls.say(game.spaceName, 'seg-1', LONG.repeat(4));
await waitFor('the bot to be heard', () => alice.loudFrames >= 25, 10_000);
note('bot heard');
source = 'noise';
note('fan on');
const result: Record<string, unknown> = { expect, image: process.env.IMAGE_ID ?? 'unknown' };
if (expect === 'pause') {
    const n = async (k: string) => (await counters())[k] ?? 0;
    for (const until = performance.now() + 2000; (await n('yield_holds')) < 1 && performance.now() < until; ) await sleep(50);
    note(`held: ${await n('yield_holds')}`);
    for (const until = performance.now() + 5000; (await n('yield_continues')) < 1 && performance.now() < until; ) await sleep(50);
    note(`went on over the fan: ${await n('yield_continues')}`);
    const packets = alice.audioPackets;
    await sleep(1500);
    result.botPacketsWhileFanOn = alice.audioPackets - packets;
    result.finishedWhileFanOn = finished('seg-1').length;
    result.speechStartedWhileFanOn = fromWorker.filter((m) => m.type === 'user.speech_started').length;
    source = 'noise+speech';
    note('voice over the fan');
    for (const until = performance.now() + 4000; finished('seg-1').length === 0 && performance.now() < until; ) await sleep(20);
    note(`reply ended: ${JSON.stringify(finished('seg-1')[0] ?? null)}`);
} else {
    for (const until = performance.now() + 4000; finished('seg-1').length === 0 && performance.now() < until; ) await sleep(20);
    note(`reply ended: ${JSON.stringify(finished('seg-1')[0] ?? null)}`);
}
source = 'silence';
await sleep(3000);
const c = await counters();
result.timeline = timeline;
result.finished = finished('seg-1')[0] ?? null;
result.speechStarted = fromWorker.filter((m) => m.type === 'user.speech_started').length;
result.yieldCounters = yieldOf(c);
result.observer = { windowsAccepted: c.observer_windows_accepted ?? 0, speechWindows: c.observer_speech_windows ?? 0, loaded: c.observer_loaded ?? 0 };
result.fixtureStreams = fixtureStreams;
writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
clearInterval(mic);
await alice.close();
fixture.close();
process.exit(0);
