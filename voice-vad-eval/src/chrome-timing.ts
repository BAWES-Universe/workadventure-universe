// Part 1 check 4: timing in a REAL Chrome with the REAL speech detector, today's rule beside the pause, paired.
//
// Real pieces: Chromium (WebRTC stack, Opus, jitter buffer) as the person, on its own peer connection over the
// proximity path; the built worker image with its Silero detector and its Soniox connector; the bot server's relay.
// Stand-ins: the Soniox endpoint is a local fixture that hears no words (so only the detector can stop a reply),
// the microphone is recorded audio played into Chrome through Web Audio (a fan at -30 dBFS, a person speaking at
// -20 dBFS), and the listening is a page worklet (rms of what the bot's audio decodes to, per 128 samples).
// Two workers run side by side: the image as shipped (the pause) and the image with the engineers' off switch
// (VOICE_SPEECH_OBSERVER=0, today's rule). Trials alternate between them, so slow minutes hit both.
//
//   tsx src/chrome-timing.ts <port pause> <port today> <fixture port> <noise wav> <speech wav> <trials per kind> <out json>
//
// Clocks: the page's clock and this process's clock are the same machine's clock (Date.now), so "from the sound
// starting at the microphone" is the moment the page switched the recorded audio on. Chrome's own capture and
// encoding delay is inside every number, as it would be with a real microphone, but a real microphone adds its own.
import { writeFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { Line, openRig, sleep, waitFor } from './chrome-line.ts';

const [pausePortArg, todayPortArg, fixturePortArg, noisePath, speechPath, trialsArg, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: chrome-timing.ts <port pause> <port today> <fixture port> <noise wav> <speech wav> <trials> <out json>');
const TRIALS = Number(trialsArg);
const TRANSPORT = process.env.TRANSPORT === 'livekit' ? 'livekit' : 'proximity';

// the Soniox fixture: hears nothing, finishes when told the audio ended
const fixture = new WebSocketServer({ host: '127.0.0.1', port: Number(fixturePortArg) });
fixture.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
        if (!isBinary && data.toString() === '') ws.send(JSON.stringify({ tokens: [], finished: true }));
    });
});
const rig = await openRig(noisePath, speechPath, Number(fixturePortArg));
const browser = rig.browser;

type Kind = 'voice' | 'hum' | 'fan';
interface Trial {
    behaviour: 'today' | 'pause';
    kind: Kind;
    k: number;
    /** From the sound starting at the microphone to the bot falling silent at Chrome (no 100 ms of audio after it). */
    silentMs?: number;
    /** From the sound starting to the worker saying the reply ended as interrupted. */
    cancelMs?: number;
    /** From the sound starting to the pause counter moving (polled every 20 ms). */
    holdMs?: number;
    /** From the sound starting to the worker deciding to go on. */
    continueMs?: number;
    /** From the worker deciding to go on to the bot heard again in Chrome. */
    backMs?: number;
    /** The reply ended as interrupted before any decision to go on. */
    stoppedByNoise: boolean;
    /** A voice over the noise, then to silence in Chrome. */
    voiceSilentMs?: number;
    voiceCancelMs?: number;
}

const GAP_MS = 100;
/** The last loud arrival from `from` on that is followed by 100 ms with none. */
function silentAt(loud: number[], from: number, until = Infinity): number | undefined {
    const xs = loud.filter((t) => t >= from - 40 && t <= until).sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i++) {
        const next = i + 1 < xs.length ? xs[i + 1] : until === Infinity ? xs[i] + GAP_MS : until;
        if (next - xs[i] >= GAP_MS && xs[i] >= from - 20) return xs[i];
    }
    return undefined;
}
const LONG = 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends. '.repeat(3);

async function trial(line: Line, kind: Kind, k: number): Promise<Trial> {
    const id = `seg-${kind}-${k}`;
    const out: Trial = { behaviour: line.behaviour, kind, k, stoppedByNoise: false };
    await line.loud();
    line.calls.say(line.game.spaceName, id, LONG);
    await waitFor('the bot to be heard in chrome', async () => ((await line.peek()) >= 40 ? true : undefined), 10_000);
    await sleep(300);
    const before = await line.counters();
    let stopPoll = false;
    let heldAt: number | undefined;
    let continuedAt: number | undefined;
    const poll = (async () => {
        while (!stopPoll) {
            try {
                const c = await line.counters();
                const now = Date.now();
                if (heldAt === undefined && (c.yield_holds ?? 0) > (before.yield_holds ?? 0)) heldAt = now;
                if (continuedAt === undefined && (c.yield_resumes ?? 0) + (c.yield_continues ?? 0) > (before.yield_resumes ?? 0) + (before.yield_continues ?? 0)) continuedAt = now;
            } catch {
                /* ignore */
            }
            await sleep(15);
        }
    })();
    const interrupted = () => line.finished(id)?.interrupted === true;
    const done = () => line.finished(id) !== undefined;
    try {
        const t0 = await line.source(kind === 'voice' ? 'speech' : 'noise');
        if (kind === 'voice') {
            await waitFor('the stop', () => done() || undefined, 4000).catch(() => undefined);
            await sleep(300);
            await line.source('silence');
        } else if (kind === 'hum') {
            await sleep(500);
            await line.source('silence');
            if (line.behaviour === 'today') await waitFor('the stop', () => done() || undefined, 4000).catch(() => undefined);
            else await waitFor('go on', () => (continuedAt !== undefined || done() ? true : undefined), 8000).catch(() => undefined);
            await sleep(700);
        } else {
            if (line.behaviour === 'today') await waitFor('the stop', () => done() || undefined, 4000).catch(() => undefined);
            else await waitFor('go on over the fan', () => (continuedAt !== undefined || done() ? true : undefined), 8000).catch(() => undefined);
            await sleep(700);
        }
        const loud = await line.loud();
        const decided = continuedAt;
        out.stoppedByNoise = kind !== 'voice' && interrupted() && decided === undefined;
        const at = silentAt(loud, t0, decided ?? Infinity);
        if (at !== undefined) out.silentMs = at - t0;
        const f = line.finished(id);
        if (f && decided === undefined) out.cancelMs = f.at - t0;
        if (heldAt !== undefined) out.holdMs = heldAt - t0;
        if (decided !== undefined) {
            out.continueMs = decided - t0;
            const back = loud.find((t) => t > decided);
            if (back !== undefined) out.backMs = back - decided;
        }
        if (kind === 'fan' && decided !== undefined && !done()) {
            const v0 = await line.source('noise+speech');
            await waitFor('the stop', () => done() || undefined, 4000).catch(() => undefined);
            await sleep(300);
            const vloud = await line.loud();
            const vat = silentAt(vloud, v0);
            if (vat !== undefined) out.voiceSilentMs = vat - v0;
            const vf = line.finished(id);
            if (vf) out.voiceCancelMs = vf.at - v0;
        }
    } finally {
        stopPoll = true;
        await poll;
        await line.source('silence');
    }
    // end the reply if it is still going, so the next trial starts clean
    if (!done()) {
        await line.source('speech');
        await waitFor('the reply to end', () => done() || undefined, 6000).catch(() => undefined);
        await line.source('silence');
    }
    await sleep(2500);
    return out;
}

const lines = [new Line('today', Number(todayPortArg), rig, TRANSPORT), new Line('pause', Number(pausePortArg), rig, TRANSPORT)];
for (const l of lines) await l.start();
const results: Trial[] = [];
for (const kind of ['voice', 'hum', 'fan'] as const) {
    for (let k = 0; k < (kind === 'voice' ? TRIALS : Math.ceil(TRIALS / 2)); k++) {
        for (const l of kind === 'fan' || kind === 'hum' ? lines : lines) {
            const t = await trial(l, kind, k);
            results.push(t);
            console.error(JSON.stringify(t));
        }
    }
}
const stats: Record<string, Record<string, number>> = {};
for (const l of lines) stats[l.behaviour] = await l.counters();
writeFileSync(outPath, JSON.stringify({ transport: TRANSPORT, trials: results, chrome: browser.version(), counters: stats }, null, 1) + '\n');
await browser.close();
fixture.close();
process.exit(0);
