// A side finding about TODAY's worker, nothing to do with the speech observer (which is off here): in a LiveKit room,
// is a person heard again after the bot stopped taking their microphone and then takes it again? Two people are in a
// room with the bot and both are heard. One person's mode is set to off (the same bridge message the bot server sends
// when someone stops the bot listening, or changes how they talk to it), and back to talk after a pause. What is
// measured: whether the worker is subscribed to their microphone again, and how much of their audio it hears in the
// next 6 seconds. Needs a livekit-server on 127.0.0.1:7880 with the worker's test keys.
//   tsx src/room-rehear.ts [pause in ms, several] > results/room-rehear.jsonl
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { privateEvent, sleep, startRig, waitFor } from '../../voice-worker/test/harness.ts';

const fromWorker = createRequire(new URL('../../voice-worker/package.json', import.meta.url));
const lk = (await import(pathToFileURL(fromWorker.resolve('@livekit/rtc-node')).href)) as typeof import('../../voice-worker/node_modules/@livekit/rtc-node');
const sdk = (await import(pathToFileURL(fromWorker.resolve('livekit-server-sdk')).href)) as typeof import('../../voice-worker/node_modules/livekit-server-sdk');
const URL_WS = process.env.LIVEKIT_WS_URL ?? 'ws://127.0.0.1:7880';
const pauses = process.argv.slice(2).map(Number).filter((n) => n >= 0);

async function token(room: string, identity: string): Promise<string> {
    const t = new sdk.AccessToken(process.env.LIVEKIT_API_KEY ?? 'devkey', process.env.LIVEKIT_API_SECRET ?? 'secret-secret-secret-secret-12345', { identity, name: identity });
    t.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [sdk.TrackSource.MICROPHONE] });
    return t.toJwt();
}
const roster = (identity: string) => ({ spaceUserId: identity, uuid: `uuid-${identity}`, tags: [], name: identity }) as never;

for (const pauseMs of pauses.length ? pauses : [0, 700, 2000, 5000]) {
    const heard: string[] = [];
    const r = await startRig({ input: (f) => heard.push(f.participantId), speechObserver: false });
    const space = `rehear-${process.pid}-${pauseMs}`;
    (r.game as { spaceName: string }).spaceName = space;
    const rooms: { disconnect(): Promise<void> }[] = [];
    const timers: NodeJS.Timeout[] = [];
    for (const id of ['room_alice', 'room_bob']) {
        const room = new lk.Room();
        rooms.push(room);
        await room.connect(URL_WS, await token(space, id), { autoSubscribe: false, dynacast: false });
        const source = new lk.AudioSource(48000, 1);
        await room.localParticipant!.publishTrack(lk.LocalAudioTrack.createAudioTrack('mic', source), new lk.TrackPublishOptions({ source: lk.TrackSource.SOURCE_MICROPHONE }));
        let phase = 0;
        timers.push(
            setInterval(() => {
                const samples = new Int16Array(480);
                for (let i = 0; i < 480; i++) {
                    samples[i] = Math.round(8000 * Math.sin(phase));
                    phase += (2 * Math.PI * 440) / 48000;
                }
                source.captureFrame(new lk.AudioFrame(samples, 48000, 1, 480)).catch(() => undefined);
            }, 10)
        );
    }
    r.calls.spaceUsers(space, [roster('room_alice'), roster('room_bob')]);
    r.calls.handlePrivateEvent(privateEvent(r.game, r.game.botId, { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await token(space, r.game.botId), serverUrl: URL_WS } }, { tags: ['bot'], uuid: 'bot-1' }));
    const frames = (id: string): number => heard.filter((p) => p === id).length;
    await waitFor('both to be heard', () => frames('room_alice') > 50 && frames('room_bob') > 50);
    r.calls.setMode(space, 'off', 'room_bob');
    await waitFor('the bot to stop taking bob\'s microphone', () => r.worker.roomSubscriptions().length === 1);
    await sleep(pauseMs);
    const before = { bob: frames('room_bob'), alice: frames('room_alice') };
    r.calls.setMode(space, 'talk', 'room_bob');
    await sleep(6000);
    console.log(
        JSON.stringify({
            pauseMs,
            subscribedAgain: r.worker.roomSubscriptions().some((s) => s.identity === 'room_bob'),
            bobSecondsHeardInNext6: Number(((frames('room_bob') - before.bob) / 100).toFixed(1)),
            aliceSecondsHeardInNext6: Number(((frames('room_alice') - before.alice) / 100).toFixed(1)),
            workerAskedToSubscribe: r.worker.counters.get('room_subscribed'),
            workerUnsubscribed: r.worker.counters.get('room_unsubscribed'),
        })
    );
    for (const t of timers) clearInterval(t);
    for (const room of rooms) await room.disconnect().catch(() => undefined);
    r.calls.shutdown();
    await r.worker.close().catch(() => undefined);
}
process.exit(0);
