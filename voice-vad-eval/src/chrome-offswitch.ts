// Part 1 check 3: the engineers' off switch with a call running, in a real Chrome.
//
// One person (Chromium, on the proximity path) is in a call with a bot on the built worker image, as shipped. Then the
// engineers' procedure is followed exactly: set VOICE_SPEECH_OBSERVER=0 and restart the worker, while the bot is
// in the middle of a reply. The bot server's own relay reconnects and Chrome makes a new connection (the way the game
// does when the bot asks its person to start again). Then back on again the same way. At each step the same fan is
// played: shipped, the bot pauses and goes on; switched off, it stops as today; switched on again, it pauses again.
//
//   tsx src/chrome-offswitch.ts <worker port> <fixture port> <noise wav> <speech wav> <out json>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { Line, openRig, sleep, waitFor } from './chrome-line.ts';

const [portArg, fixturePortArg, noisePath, speechPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error('usage: chrome-offswitch.ts <worker port> <fixture port> <noise wav> <speech wav> <out json>');
const PORT = Number(portArg);
const IMAGE = process.env.IMAGE ?? 'voice-worker:observer-packaged';
const NAME = `offswitch-${PORT}`;

const fixture = new WebSocketServer({ host: '127.0.0.1', port: Number(fixturePortArg) });
fixture.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
        if (!isBinary && data.toString() === '') ws.send(JSON.stringify({ tokens: [], finished: true }));
    });
});

const docker = (...args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' }).trim();
/** The engineers' procedure: change the setting, restart. Resolves with how long until the worker answers its health check. */
async function restart(switchedOff: boolean): Promise<number> {
    const t = Date.now();
    try {
        docker('rm', '-f', NAME);
    } catch {
        /* none yet */
    }
    docker('run', '-d', '--name', NAME, '--network', 'host', '--memory=512m', '--memory-swap=512m', '--cpus=1', '-e', 'VOICE_WORKER_HOST=127.0.0.1', '-e', `VOICE_WORKER_PORT=${PORT}`, ...(switchedOff ? ['-e', 'VOICE_SPEECH_OBSERVER=0'] : []), IMAGE);
    for (;;) {
        try {
            if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break;
        } catch {
            /* not yet */
        }
        await sleep(100);
    }
    return Date.now() - t;
}

const rig = await openRig(noisePath, speechPath, Number(fixturePortArg));
const steps: Record<string, unknown>[] = [];
const note = (step: Record<string, unknown>) => {
    steps.push(step);
    console.error(JSON.stringify(step));
};
const yieldOf = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([k, v]) => (k.startsWith('yield_') || k.startsWith('observer_loaded')) && v));

await restart(false);
const line = new Line('pause', PORT, rig);
await line.start();
const joins = () => line.fromWorker.filter((m) => m.type === 'participant.join').length;

let seg = 0;
/** The bot speaks; a fan starts; what happened to the reply, and (when it went on) a voice over the fan ending it. */
async function fan(expect: 'pause' | 'today'): Promise<void> {
    const id = `seg-${++seg}`;
    await line.loud();
    line.calls.say(line.game.spaceName, id, 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends. '.repeat(3));
    await waitFor('the bot to be heard', async () => ((await line.peek()) >= 40 ? true : undefined), 10_000);
    await sleep(300);
    const before = await line.counters();
    const t0 = await line.source('noise');
    const finished = () => line.finished(id);
    const out: Record<string, unknown> = { step: `fan, expecting ${expect}` };
    if (expect === 'pause') {
        await waitFor('go on over the fan', async () => ((await line.counters()).yield_continues ?? 0) > (before.yield_continues ?? 0) || finished() !== undefined || undefined, 8000).catch(() => undefined);
        await sleep(700);
        out.wentOnOverFan = finished() === undefined;
        const v0 = await line.source('noise+speech');
        await waitFor('the voice to stop it', () => finished() ?? undefined, 4000).catch(() => undefined);
        out.voiceStoppedIt = (finished() as { interrupted?: boolean } | undefined)?.interrupted === true;
        out.voiceCancelMs = finished() ? finished()!.at - v0 : null;
    } else {
        await waitFor('the stop', () => finished() ?? undefined, 4000).catch(() => undefined);
        out.fanStoppedIt = (finished() as { interrupted?: boolean } | undefined)?.interrupted === true;
        out.fanCancelMs = finished() ? finished()!.at - t0 : null;
    }
    await line.source('silence');
    await sleep(500);
    const after = await line.counters();
    out.yieldAndObserverCounters = yieldOf(after);
    note(out);
    await sleep(1500);
}

/** Switch while the bot is in the middle of a reply, then see everyone come back. */
async function switchWhileSpeaking(toOff: boolean): Promise<void> {
    const id = `seg-${++seg}`;
    await line.loud();
    line.calls.say(line.game.spaceName, id, 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends. '.repeat(3));
    await waitFor('the bot to be heard', async () => ((await line.peek()) >= 40 ? true : undefined), 10_000);
    const joinsBefore = joins();
    const healthyMs = await restart(toOff);
    const t = Date.now();
    await waitFor('the person to be back', () => (joins() > joinsBefore ? true : undefined), 60_000).catch(() => undefined);
    const backMs = joins() > joinsBefore ? Date.now() - t : null;
    // The bot speaks to the person again
    await line.loud();
    const id2 = `seg-${++seg}`;
    line.calls.say(line.game.spaceName, id2, 'Hello again, can you hear me now? ' .repeat(2));
    const heard = await waitFor('the bot to be heard again', async () => ((await line.peek()) >= 25 ? true : undefined), 20_000).then(() => true).catch(() => false);
    note({ step: toOff ? 'switched OFF while the bot spoke' : 'switched back ON while the bot spoke', workerHealthyAfterMs: healthyMs, personReconnectedAfterMs: backMs, botHeardAgain: heard, replyInterrupted: !!line.finished(id) });
    await waitFor('reply to end', () => line.finished(id2) ?? undefined, 15_000).catch(() => undefined);
    await sleep(1000);
}

await fan('pause');
await switchWhileSpeaking(true);
await fan('today');
await switchWhileSpeaking(false);
await fan('pause');
writeFileSync(outPath, JSON.stringify({ steps }, null, 1) + '\n');
await rig.browser.close();
try {
    docker('rm', '-f', NAME);
} catch {
    /* gone */
}
fixture.close();
process.exit(0);
