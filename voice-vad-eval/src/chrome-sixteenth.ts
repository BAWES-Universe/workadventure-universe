// Part 1 gap: the 16th person. 15 people (9 on their own connections, 6 in LiveKit rooms) keep the detector's 15 places busy on the
// built image as shipped; a real Chromium joins as the 16th and a fan plays over the bot. Expected: the 16th is not watched, so today's rule
// decides (the fan stops the reply). Then the 15 leave and the same fan is played again: the pause (hold, go on).
//   tsx src/chrome-sixteenth.ts <worker port> <fixture port> <noise wav> <speech wav> <out json>   (the 15 are started by the caller against the same port)
import { writeFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { Line, openRig, sleep, waitFor } from './chrome-line.ts';

const [portArg, fixturePortArg, noisePath, speechPath, outPath, loadPidArg] = process.argv.slice(2);
const fixture = new WebSocketServer({ host: '127.0.0.1', port: Number(fixturePortArg) });
fixture.on('connection', (ws) => ws.on('message', (d, bin) => { if (!bin && d.toString() === '') ws.send(JSON.stringify({ tokens: [], finished: true })); }));
const rig = await openRig(noisePath, speechPath, Number(fixturePortArg));
const line = new Line('pause', Number(portArg), rig);
const stats = async () => (await line.counters());
await line.start();
const out: Record<string, unknown> = {};
async function fan(label: string): Promise<void> {
    const id = `seg-${label}`;
    await line.loud();
    line.calls.say(line.game.spaceName, id, 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends. '.repeat(3));
    await waitFor('bot heard', async () => (await line.peek()) >= 40, 10_000);
    await sleep(300);
    const before = await stats();
    const t0 = await line.source('noise');
    await waitFor('stop or go on', async () => line.finished(id) !== undefined || ((await stats()).yield_continues ?? 0) > (before.yield_continues ?? 0), 8000).catch(() => undefined);
    const f = line.finished(id) as { at: number; interrupted?: boolean } | undefined;
    const after = await stats();
    out[label] = {
        fanStoppedTheReply: f?.interrupted === true,
        stoppedAfterMs: f ? Math.round(f.at - t0) : null,
        pauseHolds: (after.yield_holds ?? 0) - (before.yield_holds ?? 0),
        pauseGoOns: (after.yield_continues ?? 0) - (before.yield_continues ?? 0),
        notWatchedFallbacks: Object.fromEntries(Object.entries(after).filter(([k, v]) => /fallback|streams_refused|overflow/.test(k) && !k.endsWith('_ms') && v).map(([k, v]) => [k, v - (before[k] ?? 0)])),
        peakWatched: after.observer_peak_streams,
    };
    await line.source('speech');
    await waitFor('end', () => line.finished(id) !== undefined, 6000).catch(() => undefined);
    await line.source('silence');
    await sleep(1500);
    console.error(label, JSON.stringify(out[label]));
}
await fan('sixteenth-person-with-15-busy');
if (loadPidArg) process.kill(Number(loadPidArg), 'SIGTERM');
await sleep(8000);
await fan('alone-after-the-15-left');
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
await rig.browser.close();
fixture.close();
process.exit(0);
