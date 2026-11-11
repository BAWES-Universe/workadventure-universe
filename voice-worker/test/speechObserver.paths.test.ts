// The speech observer beside real conversations with several people, on both ways audio reaches the bot: each person's
// own connection (a proximity bubble) and one LiveKit room. Two things are shown on each path:
//   1. one person stops being heard (their mode, or no longer named in the room) while the others carry on: the observer
//      lets go of that one person and nothing of the others, and starts that person from nothing when they are heard again;
//   2. a session that is closing stays closed for the observer even while its voice is still shutting down and
//      microphones are still arriving.
// The detector is made here (no model, no runtime). The LiveKit half needs a local livekit-server and is skipped without one.
import { afterEach, describe, expect, it } from 'vitest';
import { AccessToken, TrackSource as GrantSource } from 'livekit-server-sdk';
import { AudioFrame, AudioSource, LocalAudioTrack, Room, TrackPublishOptions, TrackSource } from '@livekit/rtc-node';
import { type DetectorModel, STATE } from '../src/speechObserver.ts';
import type { InputFrame } from '../src/transport.ts';
import { FakeHuman, type Rig, privateEvent, sleep, startRig, waitFor } from './harness.ts';

const HTTP_URL = process.env.LIVEKIT_HTTP_URL ?? 'http://127.0.0.1:7880';
const WS_URL = process.env.LIVEKIT_WS_URL ?? 'ws://127.0.0.1:7880';
const API_KEY = process.env.LIVEKIT_API_KEY ?? 'devkey';
const API_SECRET = process.env.LIVEKIT_API_SECRET ?? 'secret-secret-secret-secret-12345';

const serverUp = await fetch(HTTP_URL, { signal: AbortSignal.timeout(1500) }).then(
    (r) => r.ok,
    () => false
);

/** A detector that says "speech" for everything, takes several people in one call, and counts the people it was given. */
function detector() {
    let people = 0;
    let released = 0;
    const answer = () => ({ probability: 0.9, state: new Float32Array(STATE).fill(1) });
    const model: DetectorModel = {
        run: async () => (people++, answer()),
        runMany: async (windows) => windows.map(() => (people++, answer())),
        release: async () => {
            released++;
        },
    };
    return { model, people: () => people, released: () => released };
}

interface Watched {
    r: Rig;
    /** Answers the observer kept, by person, in order. */
    verdicts: string[];
    /** Audio the session was handed, by person, in order. */
    heard: string[];
    kept(person: string): number;
    given(person: string): number;
    observer(): { status: string; streams: number; queuedMs: number; lined: number; callOut: boolean };
}

const rigs: Rig[] = [];
const humans: FakeHuman[] = [];
const rooms: LkPerson[] = [];

async function watched(): Promise<Watched> {
    const verdicts: string[] = [];
    const heard: string[] = [];
    const d = detector();
    const r = await startRig({ input: (f: InputFrame) => heard.push(f.participantId), speechObserver: { load: async () => d.model, onVerdict: (v) => verdicts.push(v.participantId) } });
    rigs.push(r);
    return {
        r,
        verdicts,
        heard,
        kept: (person) => verdicts.filter((p) => p === person).length,
        given: (person) => heard.filter((p) => p === person).length,
        observer: () => r.worker.stats().speechObserver as never,
    };
}

afterEach(async () => {
    for (const p of rooms.splice(0)) await p.leave();
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

const roster = (identity: string, extra: object = {}) => ({ spaceUserId: identity, uuid: `uuid-${identity}`, tags: [], name: identity, ...extra } as never);

/** A person walks into the bot's bubble: a start, then their offer, and their microphone is on. */
async function walkIn(r: Rig, id: string, hz: number): Promise<FakeHuman> {
    const person = new FakeHuman(id);
    humans.push(person);
    r.game.humans.set(id, person);
    r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: id, initiator: false } }));
    for (const signal of await person.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
    await waitFor(`${id}'s audio connection`, () => r.fromWorker.some((m) => m.type === 'participant.join' && m.participantId === id));
    person.startMic(hz);
    return person;
}

/** A person in the LiveKit room with their microphone on. */
class LkPerson {
    readonly room = new Room();
    private timer?: NodeJS.Timeout;

    constructor(readonly identity: string) {}

    async join(roomName: string, hz: number): Promise<this> {
        const t = new AccessToken(API_KEY, API_SECRET, { identity: this.identity, name: this.identity });
        t.addGrant({ room: roomName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
        await this.room.connect(WS_URL, await t.toJwt(), { autoSubscribe: true, dynacast: false });
        const source = new AudioSource(48000, 1);
        await this.room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('microphone', source), new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
        let phase = 0;
        this.timer = setInterval(() => {
            const samples = new Int16Array(480);
            for (let i = 0; i < samples.length; i++) {
                samples[i] = Math.round(8000 * Math.sin(phase));
                phase += (2 * Math.PI * hz) / 48000;
            }
            source.captureFrame(new AudioFrame(samples, 48000, 1, 480)).catch(() => undefined);
        }, 10);
        return this;
    }

    async leave(): Promise<void> {
        clearInterval(this.timer);
        await this.room.disconnect().catch(() => undefined);
    }
}

async function inRoom(roomName: string, identity: string, hz: number): Promise<LkPerson> {
    const p = new LkPerson(identity);
    rooms.push(p);
    return p.join(roomName, hz);
}

/** The game moves the bubble to LiveKit: it hands the bot an invitation made for the bot's own identity. */
async function invite(r: Rig): Promise<void> {
    const t = new AccessToken(API_KEY, API_SECRET, { identity: r.game.botId, name: r.game.botId });
    t.addGrant({ room: r.game.spaceName, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [GrantSource.MICROPHONE] });
    const inner = { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await t.toJwt(), serverUrl: WS_URL } };
    r.calls.handlePrivateEvent(privateEvent(r.game, r.game.botId, inner, { tags: ['bot'], uuid: 'bot-1' }));
}

/**
 * Holds the session's voice in the middle of shutting down, the way a voice that is slow to stop would: `reached` once the
 * session has got that far in closing (it has told the observer by then), and nothing after it happens until `release`.
 */
function holdTheVoice(r: Rig): { reached: Promise<void>; release(): void } {
    type Inside = { connections: Set<{ sessions: Map<string, { speaker: { shutdown(): Promise<void> } }> }> };
    const sessions = [...(r.worker as unknown as Inside).connections].flatMap((c) => [...c.sessions.values()]);
    expect(sessions.length).toBe(1);
    const speaker = sessions[0].speaker;
    const shutdown = speaker.shutdown.bind(speaker);
    let reached!: () => void;
    let release!: () => void;
    const at = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    speaker.shutdown = async () => {
        reached();
        await gate;
        await shutdown();
    };
    return { reached: at, release };
}

const sessionId = (r: Rig): string => (r.toWorker.find((m) => m.type === 'session.open') as { sessionId: string }).sessionId;

/** One person stops being heard while two carry on; then they are heard again. `stop` and `again` are how, on this path. */
async function onePersonStops(w: Watched, [a, b, c]: [string, string, string], path: 'lane' | 'room', stop: () => void, again: () => void): Promise<void> {
    const { r } = w;
    const n = r.worker.counters;
    await waitFor('all three to be watched', () => w.kept(a) > 10 && w.kept(b) > 10 && w.kept(c) > 10);
    expect(w.observer()).toMatchObject({ status: 'on', streams: 3 });
    expect(n.get('observer_streams')).toBe(3);

    stop();
    await waitFor(`${b} to be let go`, () => w.observer().streams === 2);
    // An answer that was already on its way back for them is thrown away, never kept: from here on, nothing of theirs
    await sleep(100);
    const before = { a: w.kept(a), b: w.kept(b), c: w.kept(c), heardB: w.given(b), heardA: w.given(a), heardC: w.given(c), streams: n.get('observer_streams') };
    await sleep(800);
    expect(w.kept(b)).toBe(before.b);
    expect(w.given(b)).toBe(before.heardB);
    expect(n.get('observer_streams')).toBe(before.streams);
    expect(w.observer()).toMatchObject({ status: 'on', streams: 2 });
    // The other two were heard and watched all the while: 800 ms is 40 frames and 25 windows each, with room for a slow machine
    expect(w.given(a) - before.heardA).toBeGreaterThan(15);
    expect(w.given(c) - before.heardC).toBeGreaterThan(15);
    expect(w.kept(a) - before.a).toBeGreaterThan(10);
    expect(w.kept(c) - before.c).toBeGreaterThan(10);
    expect(n.get('observer_streams_ended')).toBe(1);

    again();
    await waitFor(`${b} to be heard again`, () => w.kept(b) > before.b + 10);
    // As a new person would be: a stream of their own started from nothing, not the old one picked up
    expect(n.get('observer_streams')).toBe(4);
    expect(w.observer()).toMatchObject({ status: 'on', streams: 3 });
    expect(n.get('observer_errors')).toBe(0);
    expect(n.get('observer_windows_failed')).toBe(0);
    expect(n.get('observer_overflow_ms')).toBe(0);
    expect(n.get(`observer_accepted_ms_${path}`)).toBe(n.get('observer_windows_accepted') * 32);
    expect(n.get(`observer_accepted_ms_${path === 'lane' ? 'room' : 'lane'}`)).toBe(0);
    expect(r.violations).toEqual([]);
}

/** The session ends while its voice takes its time to stop and microphones keep arriving. */
async function closesForGood(w: Watched, people: string[], path: 'lane' | 'room'): Promise<void> {
    const { r } = w;
    const n = r.worker.counters;
    await waitFor('everyone to be watched', () => people.every((p) => w.kept(p) > 10));
    expect(w.observer()).toMatchObject({ status: 'on', streams: people.length });

    const hold = holdTheVoice(r);
    r.link().send({ type: 'session.end', sessionId: sessionId(r) });
    await hold.reached;
    // The session has told the observer it is over, and is now waiting for its voice: nothing of anyone's is held
    expect(w.observer()).toMatchObject({ streams: 0, queuedMs: 0, lined: 0 });
    const kept = w.verdicts.length;
    const accepted = n.get('observer_windows_accepted');
    const started = n.get('observer_streams');
    const arrived = w.heard.length;

    await sleep(700);
    // Microphones kept arriving at the session all that time (its connections are still up), and every frame was turned away
    expect(w.heard.length - arrived).toBeGreaterThan(15 * people.length);
    expect(n.get('observer_refused_closed')).toBe(w.heard.length - arrived);
    expect(w.verdicts.length).toBe(kept);
    expect(n.get('observer_windows_accepted')).toBe(accepted);
    expect(n.get('observer_streams')).toBe(started);
    expect(w.observer()).toMatchObject({ status: 'on', streams: 0, queuedMs: 0, lined: 0, callOut: false });
    expect(n.get(`observer_offered_ms_${path}`)).toBeGreaterThan(0);

    hold.release();
    await waitFor('the session to finish closing', () => r.worker.laneCount() === 0);
    expect(w.verdicts.length).toBe(kept);
    expect(n.get('observer_windows_accepted')).toBe(accepted);
    expect(w.observer()).toMatchObject({ status: 'on', streams: 0, queuedMs: 0 });
    expect(n.get('observer_errors')).toBe(0);
}

describe('several people on their own connections (a proximity bubble)', () => {
    async function bubble(ids: string[]): Promise<Watched> {
        const w = await watched();
        w.r.calls.spaceUsers(w.r.game.spaceName, ids.map((id) => roster(id)));
        for (const [i, id] of ids.entries()) await walkIn(w.r, id, 330 + 110 * i);
        return w;
    }

    it('one person stops being heard: only theirs is let go, the other two are heard and watched as before, and they start from nothing when heard again', async () => {
        const w = await bubble(['alice', 'bob', 'carol']);
        const space = w.r.game.spaceName;
        await onePersonStops(
            w,
            ['alice', 'bob', 'carol'],
            'lane',
            () => w.r.calls.setMode(space, 'off', 'bob'),
            () => w.r.calls.setMode(space, 'talk', 'bob')
        );
    }, 30_000);

    it('a closing session takes nothing more, while its voice is still shutting down and microphones still arrive', async () => {
        const w = await bubble(['alice', 'bob']);
        await closesForGood(w, ['alice', 'bob'], 'lane');
    }, 30_000);
});

describe.skipIf(!serverUp)('several people in one LiveKit room', () => {
    async function room(ids: string[]): Promise<Watched> {
        const w = await watched();
        for (const [i, id] of ids.entries()) await inRoom(w.r.game.spaceName, id, 330 + 110 * i);
        w.r.calls.spaceUsers(w.r.game.spaceName, ids.map((id) => roster(id)));
        await invite(w.r);
        await waitFor('the bot to be in the room', () => w.r.fromWorker.some((m) => m.type === 'room.state' && m.state === 'connected'));
        return w;
    }

    it('one person is no longer named: only theirs is let go, the other two are heard and watched as before, and they start from nothing when named again', async () => {
        const w = await room(['room_alice', 'room_bob', 'room_carol']);
        const space = w.r.game.spaceName;
        await onePersonStops(
            w,
            ['room_alice', 'room_bob', 'room_carol'],
            'room',
            () => w.r.calls.spaceUserLeft(space, 'room_bob'),
            () => w.r.calls.spaceUserJoined(space, roster('room_bob'))
        );
    }, 30_000);

    it('a closing session takes nothing more, while its voice is still shutting down and microphones still arrive', async () => {
        const w = await room(['room_alice', 'room_bob']);
        await closesForGood(w, ['room_alice', 'room_bob'], 'room');
    }, 30_000);
});
