// A reply for one person alone (game #1993), end to end over peer-to-peer connections: fake browsers, the real worker,
// the real bridge and the bot server's relay. What is checked is what each browser really received: every audio packet
// that arrived is counted. Fake speech only; nothing here needs a provider, a key or a network.
import { afterEach, describe, expect, it } from 'vitest';
import { FakeHuman, type Rig, privateEvent, sleep, startRig, waitFor } from './harness.ts';

const rigs: Rig[] = [];
const humans: FakeHuman[] = [];

/** About six seconds of fake speech (65 ms a character). */
const LONG = 'This is an answer for one person that goes on long enough for someone else to walk up.';
const SHORT = 'and this one is for everyone here';

async function connect(r: Rig, id: string): Promise<FakeHuman> {
    const person = new FakeHuman(id);
    humans.push(person);
    r.game.humans.set(id, person);
    const joins = r.fromWorker.filter((m) => m.type === 'participant.join' && m.participantId === id).length;
    r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: id, initiator: false } }));
    for (const signal of await person.offer()) {
        r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
    }
    await waitFor(`the audio connection of ${id}`, () => r.fromWorker.filter((m) => m.type === 'participant.join' && m.participantId === id).length > joins);
    return person;
}

async function bubble(ids: string[]) {
    const r = await startRig();
    rigs.push(r);
    r.calls.spaceUsers(r.game.spaceName, ids.map((id) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id }) as never));
    const people: Record<string, FakeHuman> = {};
    for (const id of ids) people[id] = await connect(r, id);
    const finished = (segmentId: string) =>
        r.fromWorker.find((m) => m.type === 'playback.progress' && m.segmentId === segmentId && m.finished) as Extract<(typeof r.fromWorker)[number], { type: 'playback.progress' }> | undefined;
    return { r, people, finished };
}

afterEach(async () => {
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

describe('a reply for one person alone, over peer-to-peer connections', () => {
    it('is said by a worker that names what it can do, with the person on the message', async () => {
        const { r, people, finished } = await bubble(['alice']);
        expect(r.fromWorker.find((m) => m.type === 'session.start')).toMatchObject({ features: ['say.onlyFor'] });
        expect(r.calls.keepsToOne(r.game.spaceName)).toBe(true);

        expect(r.calls.say(r.game.spaceName, 'one-1', SHORT, undefined, 'alice')).toBe(true);
        expect(r.toWorker.find((m) => m.type === 'bot.say')).toMatchObject({ segmentId: 'one-1', onlyFor: 'alice' });
        await waitFor('the reply to end', () => !!finished('one-1'), 6000);
        expect(finished('one-1')).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(people.alice.loudFrames).toBeGreaterThan(40);
        expect(r.violations).toEqual([]);
    });

    it('reaches that person and not one packet reaches the other person in the bubble', async () => {
        const { r, people, finished } = await bubble(['alice', 'bob']);
        const before = people.bob.audioPackets;
        r.calls.say(r.game.spaceName, 'one-1', SHORT, undefined, 'alice');
        await waitFor('the reply to end', () => !!finished('one-1'), 6000);
        await sleep(200);

        expect(finished('one-1')).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(people.alice.loudFrames).toBeGreaterThan(40);
        expect(people.bob.audioPackets).toBe(before);
        expect(r.worker.counters.get('private_frames_refused') ?? 0).toBe(0);

        // His connection works: what is said to everyone next reaches him too
        r.calls.say(r.game.spaceName, 'all-1', SHORT);
        await waitFor('the next reply to end', () => !!finished('all-1'), 6000);
        expect(people.bob.loudFrames).toBeGreaterThan(40);
        expect(r.violations).toEqual([]);
    });

    it('goes on for its person when someone walks up while it plays, and they are sent none of it', async () => {
        const { r, people, finished } = await bubble(['alice']);
        r.calls.say(r.game.spaceName, 'one-1', LONG, undefined, 'alice');
        await waitFor('the reply to be heard', () => people.alice.loudFrames >= 25);

        // Bob walks up and his audio connects while the reply is still playing
        r.calls.spaceUserJoined(r.game.spaceName, { spaceUserId: 'bob', uuid: 'uuid-bob', tags: [], name: 'bob' } as never);
        const bob = await connect(r, 'bob');
        expect(finished('one-1')).toBeUndefined();
        const heardWhenHeCame = people.alice.loudFrames;

        await waitFor('the reply to end', () => !!finished('one-1'), 10000);
        await sleep(200);
        // It was said to its end, to her
        expect(finished('one-1')).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(people.alice.loudFrames).toBeGreaterThan(heardWhenHeCame + 25);
        // Not one packet of it reached him
        expect(bob.audioPackets).toBe(0);

        // What is said to everyone next reaches him
        r.calls.say(r.game.spaceName, 'all-1', SHORT);
        await waitFor('the next reply to end', () => !!finished('all-1'), 6000);
        expect(bob.loudFrames).toBeGreaterThan(40);
        expect(r.violations).toEqual([]);
    }, 30000);

    it('goes on to its person\'s new connection when they connect again, and still to nobody else', async () => {
        const { r, people, finished } = await bubble(['alice', 'bob']);
        const bobBefore = people.bob.audioPackets;
        r.calls.say(r.game.spaceName, 'one-1', LONG, undefined, 'alice');
        await waitFor('the reply to be heard', () => people.alice.loudFrames >= 25);

        const again = await connect(r, 'alice');
        expect(finished('one-1')).toBeUndefined();
        const oldAtSwitch = people.alice.audioPackets;
        await waitFor('the rest on the new connection', () => again.loudFrames >= 25, 6000);
        await waitFor('the reply to end', () => !!finished('one-1'), 10000);
        await sleep(200);

        // The connection she had before carries nothing more, and his carried nothing at all
        expect(people.alice.audioPackets - oldAtSwitch).toBeLessThanOrEqual(2);
        expect(people.bob.audioPackets).toBe(bobBefore);
        expect(r.violations).toEqual([]);
    }, 30000);

    it('is heard by nobody when its person has no audio connected, whoever else has', async () => {
        const { r, people, finished } = await bubble(['bob']);
        const before = people.bob.audioPackets;
        // The relay would not say it yet (it waits for her audio); even said, the worker hands it to no connection
        expect(r.calls.hasAudience(r.game.spaceName, 'alice')).toBe(false);
        expect(r.calls.hasAudience(r.game.spaceName)).toBe(true);
        r.calls.say(r.game.spaceName, 'one-1', SHORT, undefined, 'alice');
        await waitFor('the reply to end', () => !!finished('one-1'), 6000);

        expect(finished('one-1')).toMatchObject({ playedMs: 0 });
        expect(people.bob.audioPackets).toBe(before);
        expect(r.violations).toEqual([]);
    });
});
