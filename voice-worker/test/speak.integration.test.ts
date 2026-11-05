// A voice bot speaks and a person talks over it, end to end: fake browsers, the worker with scripted fake ears and fake
// speech, the real bridge, the bot server's relay. Nothing here needs a provider, a key or a network.
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEars } from '../src/recognizer.ts';
import { FakeHuman, type Rig, privateEvent, sleep, startRig, waitFor } from './harness.ts';

const rigs: Rig[] = [];
const humans: FakeHuman[] = [];

/** About eleven seconds of fake speech (65 ms a character). */
const LONG = 'This is a long answer that goes on for quite a while so there is plenty of time to talk over it before it ends.';

async function bubble(options: { maxReplySeconds?: number; people?: string[] } = {}) {
    const ears = new FakeEars(['over you']);
    const r = await startRig({ recognizer: ears.factory, maxReplySeconds: options.maxReplySeconds });
    rigs.push(r);
    const ids = options.people ?? ['alice'];
    r.calls.spaceUsers(r.game.spaceName, ids.map((id) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id }) as never));
    const people: Record<string, FakeHuman> = {};
    for (const id of ids) {
        const person = new FakeHuman(id);
        humans.push(person);
        people[id] = person;
        r.game.humans.set(id, person);
        r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: id, initiator: false } }));
        for (const signal of await person.offer()) {
            r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
        }
        await waitFor('the audio connection', () => r.fromWorker.some((m) => m.type === 'participant.join' && m.participantId === id));
    }
    const progress = (segmentId: string) =>
        r.fromWorker.filter((m) => m.type === 'playback.progress' && m.segmentId === segmentId && m.finished) as Extract<(typeof r.fromWorker)[number], { type: 'playback.progress' }>[];
    return { r, people, progress };
}

afterEach(async () => {
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

describe('a person talks over a voice bot', () => {
    it('stops its voice within 300 ms of the person speaking, and tells the bot server it was cut', async () => {
        const { r, people, progress } = await bubble();
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('the bot to be heard', () => people.alice.loudFrames >= 25);

        const spokeAt = performance.now();
        people.alice.startMic(440);
        await waitFor('the voice to stop', () => progress('seg-1').length > 0, 3000);
        const stoppedIn = performance.now() - spokeAt;
        people.alice.stopMic();

        const [done] = progress('seg-1');
        expect(done).toMatchObject({ interrupted: true, finished: true, reason: 'barge_in' });
        expect(done.playedMs).toBeGreaterThan(400);
        expect(done.playedMs).toBeLessThan(done.totalMs! / 2);
        // From the first sound of the person's voice reaching the worker to the voice stopping, here and with the bridge
        expect(stoppedIn).toBeLessThan(300);
        expect(r.worker.counters.get('barge_ins')).toBe(1);
        // No audio goes on to the person after that
        await sleep(100);
        const heard = people.alice.audioPackets;
        await sleep(300);
        expect(people.alice.audioPackets - heard).toBeLessThanOrEqual(2);
        expect(r.violations).toEqual([]);
    });

    it('does not start again by itself, and drops what was waiting behind it', async () => {
        const { r, people, progress } = await bubble();
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        r.calls.say(r.game.spaceName, 'seg-2', 'and one more thing to say after that');
        await waitFor('the bot to be heard', () => people.alice.loudFrames >= 25);
        people.alice.startMic(440);
        await waitFor('both to be cut', () => progress('seg-1').length > 0 && progress('seg-2').length > 0, 3000);
        people.alice.stopMic();

        expect(progress('seg-1')[0].reason).toBe('barge_in');
        expect(progress('seg-2')[0]).toMatchObject({ playedMs: 0, interrupted: true, reason: 'barge_in' });
        await sleep(1500);
        const quiet = people.alice.audioPackets;
        await sleep(600);
        expect(people.alice.audioPackets - quiet).toBeLessThanOrEqual(2);
        expect(r.worker.counters.get('segments_completed') ?? 0).toBe(0);

        // The next thing the bot says is said as usual
        r.calls.say(r.game.spaceName, 'seg-3', 'back to normal');
        await waitFor('the next reply to finish', () => progress('seg-3').length > 0, 5000);
        expect(progress('seg-3')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
    });

    it('is not stopped by a click or a cough, only by speech', async () => {
        const { r, people, progress } = await bubble();
        r.calls.say(r.game.spaceName, 'seg-1', 'a reply of about three seconds in all, said slowly');
        await waitFor('the bot to be heard', () => people.alice.loudFrames >= 10);
        people.alice.startMic(440);
        await sleep(60);
        people.alice.stopMic();
        await waitFor('the reply to finish', () => progress('seg-1').length > 0, 6000);
        expect(progress('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(r.worker.counters.get('barge_ins')).toBe(0);
    });

    it('is not stopped by a person the bot does not hear', async () => {
        const { r, people, progress } = await bubble();
        r.calls.setMode(r.game.spaceName, 'type_and_listen', 'alice');
        r.calls.say(r.game.spaceName, 'seg-1', 'a reply of about three seconds in all, said slowly');
        await waitFor('the bot to be heard', () => people.alice.loudFrames >= 10);
        people.alice.startMic(440);
        await waitFor('the reply to finish', () => progress('seg-1').length > 0, 6000);
        people.alice.stopMic();
        expect(progress('seg-1')[0]).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(r.worker.counters.get('barge_ins')).toBe(0);
    });

    it('stops the voice for everyone in the bubble when one person speaks', async () => {
        const { r, people, progress } = await bubble({ people: ['alice', 'bob'] });
        r.calls.say(r.game.spaceName, 'seg-1', LONG);
        await waitFor('both to hear the bot', () => people.alice.loudFrames >= 20 && people.bob.loudFrames >= 20);
        people.bob.startMic(440);
        await waitFor('the voice to stop', () => progress('seg-1').length > 0, 3000);
        people.bob.stopMic();
        expect(progress('seg-1')[0].reason).toBe('barge_in');
        await sleep(150);
        const [a, b] = [people.alice.audioPackets, people.bob.audioPackets];
        await sleep(300);
        expect(people.alice.audioPackets - a).toBeLessThanOrEqual(2);
        expect(people.bob.audioPackets - b).toBeLessThanOrEqual(2);
    });
});

describe('the longest a reply plays', () => {
    it('stops at the time the bot server asks for, and says why', async () => {
        const { r, people, progress } = await bubble();
        r.calls.say(r.game.spaceName, 'seg-1', LONG, 1500);
        await waitFor('the reply to be cut', () => progress('seg-1').length > 0, 5000);
        const [done] = progress('seg-1');
        expect(done).toMatchObject({ interrupted: true, reason: 'limit' });
        expect(done.playedMs).toBeGreaterThanOrEqual(1400);
        expect(done.playedMs).toBeLessThanOrEqual(1600);
        expect(people.alice.loudFrames).toBeGreaterThan(20);
    });

    it('never plays longer than the worker allows, whatever the bot server asks', async () => {
        const { r, progress } = await bubble({ maxReplySeconds: 1 });
        r.calls.say(r.game.spaceName, 'seg-1', LONG, 60000);
        await waitFor('the reply to be cut', () => progress('seg-1').length > 0, 5000);
        expect(progress('seg-1')[0]).toMatchObject({ reason: 'limit' });
        expect(progress('seg-1')[0].playedMs).toBeLessThanOrEqual(1100);
    });
});
