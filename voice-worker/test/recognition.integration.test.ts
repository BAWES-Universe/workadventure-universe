// What a person says to a voice bot, end to end: a fake browser's microphone, the worker with scripted fake ears, the
// real bridge, the bot server's relay. Nothing here needs a provider, a key or a network.
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEars } from '../src/recognizer.ts';
import { FakeHuman, type Rig, privateEvent, startRig, waitFor } from './harness.ts';

const rigs: Rig[] = [];
const humans: FakeHuman[] = [];

const SAYING = 'Actually which of them replied this week';

async function bubble(options: { script?: ConstructorParameters<typeof FakeEars>[0]; maxUtteranceSeconds?: number; people?: string[] } = {}) {
    const ears = new FakeEars(options.script ?? [SAYING]);
    const r = await startRig({ recognizer: ears.factory, maxUtteranceSeconds: options.maxUtteranceSeconds });
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
    const sessionId = (r.toWorker[0] as { sessionId: string }).sessionId;
    const states = (to: string) => r.game.drafts.filter(([who]) => who === to).map(([, d]) => d.state);
    return { r, ears, people, sessionId, states };
}

/** Speaks for a while, then goes quiet (a person who stops talking sends no more audio). */
async function speak(person: FakeHuman, ms: number): Promise<void> {
    person.startMic(440);
    await new Promise((resolve) => setTimeout(resolve, ms));
    person.stopMic();
}

afterEach(async () => {
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

describe('a person speaks to a voice bot', () => {
    it('sees their own words fill in as a draft, then one finished line to send as their own', async () => {
        const { r, people, states } = await bubble();
        await speak(people.alice, 1700);
        await waitFor('the finished words', () => states('alice').includes('final'));

        const drafts = r.game.drafts.map(([, d]) => d);
        const live = drafts.filter((d) => d.state === 'live');
        // Each draft has more words than the one before, and every one is for the speaker
        expect(live.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < live.length; i++) expect(live[i].text.startsWith(live[i - 1].text)).toBe(true);
        expect(r.game.drafts.every(([to]) => to === 'alice')).toBe(true);
        expect(drafts.filter((d) => d.state === 'final')).toEqual([{ turnId: drafts[0].turnId, state: 'final', text: SAYING }]);
        // The person's own game sends it, once, and the bot answers it once
        const turnId = drafts[0].turnId;
        expect(r.calls.acceptSpoken(r.game.spaceName, 'alice', turnId, SAYING)).toBe('new');
        expect(r.calls.acceptSpoken(r.game.spaceName, 'alice', turnId, SAYING)).toBe('duplicate');
        expect(r.violations).toEqual([]);
    });

    it('shows each person only their own words', async () => {
        const { r, people } = await bubble({ script: ['from alice here', 'from bob there'], people: ['alice', 'bob'] });
        await speak(people.alice, 1300);
        await waitFor('alice\'s words', () => r.game.drafts.some(([to, d]) => to === 'alice' && d.state === 'final'));
        await speak(people.bob, 1300);
        await waitFor('bob\'s words', () => r.game.drafts.some(([to, d]) => to === 'bob' && d.state === 'final'));
        expect(r.game.drafts.filter(([to]) => to === 'alice').every(([, d]) => 'from alice here'.startsWith(d.text))).toBe(true);
        expect(r.game.drafts.filter(([to]) => to === 'bob').every(([, d]) => 'from bob there'.startsWith(d.text))).toBe(true);
        expect(r.violations).toEqual([]);
    });

    it('hears nobody whose mode does not let the bot hear them', async () => {
        const { r, ears, people } = await bubble();
        r.calls.setMode(r.game.spaceName, 'type_and_listen', 'alice');
        await speak(people.alice, 800);
        expect(ears.started).toBe(0);
        expect(r.game.drafts).toEqual([]);
        expect(r.worker.counters.get('frames_gated')).toBeGreaterThan(10);
    });

    it('drops the words, not even offering them back, when the mode stops listening mid-sentence', async () => {
        const { r, people, states } = await bubble();
        people.alice.startMic();
        await waitFor('words on screen', () => states('alice').includes('live'));
        r.calls.setMode(r.game.spaceName, 'listen_only', 'alice');
        await waitFor('the draft to be cleared', () => states('alice').includes('cleared'));
        people.alice.stopMic();
        expect(states('alice')).not.toContain('final');
        expect(states('alice')).not.toContain('lost');
    });
});

describe('words that did not come through are only offered back', () => {
    it('offers the words back when the connection drops mid-sentence, and nothing is sent', async () => {
        const { r, people, sessionId, states } = await bubble();
        people.alice.startMic();
        await waitFor('words on screen', () => states('alice').includes('live'));
        const open = r.toWorker.find((m) => m.type === 'lane.open') as { epoch: number };
        r.link().send({ type: 'lane.close', sessionId, participantId: 'alice', epoch: open.epoch, reason: 'failed' });
        await waitFor('the words to be offered back', () => states('alice').includes('lost'));
        people.alice.stopMic();

        const lost = r.game.drafts.map(([, d]) => d).find((d) => d.state === 'lost')!;
        expect(lost.reason).toBe('path');
        expect(lost.text.length).toBeGreaterThan(0);
        expect(SAYING.startsWith(lost.text)).toBe(true);
        expect(states('alice')).not.toContain('final');
        expect(r.violations).toEqual([]);
    });

    it('offers the words back when the worker goes away mid-sentence', async () => {
        const { r, people, states } = await bubble();
        people.alice.startMic();
        await waitFor('words on screen', () => states('alice').includes('live'));
        await r.worker.close();
        await waitFor('the words to be offered back', () => states('alice').includes('lost'));
        expect(states('alice')).not.toContain('final');
        expect(r.game.drafts.map(([, d]) => d).find((d) => d.state === 'lost')!.reason).toBe('path');
    });

    it('offers the words back when the voice is stopped mid-sentence, so nothing said is lost', async () => {
        const { r, people, sessionId, states } = await bubble();
        people.alice.startMic();
        await waitFor('words on screen', () => states('alice').includes('live'));
        r.link().send({ type: 'voice.stop', sessionId, reason: 'allowance_ended' });
        await waitFor('the words to be offered back', () => states('alice').includes('lost'));
        expect(r.game.drafts.map(([, d]) => d).find((d) => d.state === 'lost')!.reason).toBe('stopped');
        expect(states('alice')).not.toContain('final');
    });

    it('stops at the limit, offers the words so far back, and never sends them by itself', async () => {
        const { r, people, states } = await bubble({ maxUtteranceSeconds: 1.2 });
        await speak(people.alice, 2600);
        await waitFor('the words to be offered back', () => states('alice').includes('lost'));
        const lost = r.game.drafts.map(([, d]) => d).find((d) => d.state === 'lost')!;
        expect(lost.reason).toBe('cap');
        expect(SAYING.startsWith(lost.text)).toBe(true);
        expect(lost.text).not.toBe(SAYING);
        expect(states('alice')).not.toContain('final');
        expect(r.worker.counters.get('speech_cap_hit')).toBe(1);
    });
});
