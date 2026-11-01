// The bot in a LiveKit bubble, against a real local livekit-server (see the README for how to run one). The test is
// skipped when none answers. People are LiveKit clients; the bot is the worker's own participant, reached through the
// same bridge and relay as in a peer-to-peer bubble. Fake speech only.
import { afterEach, describe, expect, it } from 'vitest';
import { AccessToken, TrackSource as GrantSource } from 'livekit-server-sdk';
import {
    AudioFrame,
    AudioSource,
    AudioStream,
    LocalAudioTrack,
    LocalVideoTrack,
    Room,
    RoomEvent,
    TrackKind,
    TrackPublishOptions,
    TrackSource,
    VideoBufferType,
    VideoFrame,
    VideoSource,
} from '@livekit/rtc-node';
import { FakeEars } from '../src/recognizer.ts';
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

/** Tokens as back/src/Model/Services/LivekitService.ts makes them: the bot may send a microphone and nothing else. */
async function token(room: string, identity: string, sources: GrantSource[]): Promise<string> {
    const t = new AccessToken(API_KEY, API_SECRET, { identity, name: identity });
    t.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: sources.length > 0, canPublishSources: sources });
    return t.toJwt();
}
const ALL = [GrantSource.CAMERA, GrantSource.MICROPHONE, GrantSource.SCREEN_SHARE, GrantSource.SCREEN_SHARE_AUDIO];

const rms = (pcm: Int16Array): number => Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / Math.max(1, pcm.length));

/** A person in the LiveKit room: sends what it is told to, listens to the bot, and records what it can see. */
class LkPerson {
    readonly room = new Room();
    /** Loud audio frames heard, by who they came from. */
    private readonly loud = new Map<string, number>();
    private timers: NodeJS.Timeout[] = [];

    constructor(readonly identity: string) {}

    async join(roomName: string, sources = ALL): Promise<this> {
        this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind !== TrackKind.KIND_AUDIO) return;
            void (async () => {
                try {
                    for await (const frame of new AudioStream(track, { sampleRate: 48000, numChannels: 1 })) {
                        if (rms(frame.data) > 300) this.loud.set(participant.identity, (this.loud.get(participant.identity) ?? 0) + 1);
                    }
                } catch {
                    /* closed */
                }
            })();
            void publication;
        });
        await this.room.connect(WS_URL, await token(roomName, this.identity, sources), { autoSubscribe: true, dynacast: false });
        return this;
    }

    loudFrom(identity: string): number {
        return this.loud.get(identity) ?? 0;
    }

    private tone(source: AudioSource, hz: number): void {
        let phase = 0;
        this.timers.push(
            setInterval(() => {
                const samples = new Int16Array(480);
                for (let i = 0; i < samples.length; i++) {
                    samples[i] = Math.round(8000 * Math.sin(phase));
                    phase += (2 * Math.PI * hz) / 48000;
                }
                source.captureFrame(new AudioFrame(samples, 48000, 1, 480)).catch(() => undefined);
            }, 10)
        );
    }

    async publishAudio(sourceKind: TrackSource, hz = 440): Promise<void> {
        const source = new AudioSource(48000, 1);
        await this.room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack(`audio-${sourceKind}`, source), new TrackPublishOptions({ source: sourceKind }));
        this.tone(source, hz);
    }

    async publishVideo(sourceKind: TrackSource): Promise<void> {
        const source = new VideoSource(64, 64);
        await this.room.localParticipant!.publishTrack(LocalVideoTrack.createVideoTrack(`video-${sourceKind}`, source), new TrackPublishOptions({ source: sourceKind }));
        this.timers.push(setInterval(() => source.captureFrame(new VideoFrame(new Uint8Array(64 * 64 * 4).fill(120), 64, 64, VideoBufferType.RGBA)), 100));
    }

    /** What this person sees the bot publishing. */
    botPublications(botIdentity: string): { source: TrackSource; kind: TrackKind }[] {
        const bot = this.room.remoteParticipants.get(botIdentity);
        return [...(bot?.trackPublications.values() ?? [])].map((p) => ({ source: p.source!, kind: p.kind! }));
    }

    async leave(): Promise<void> {
        for (const t of this.timers.splice(0)) clearInterval(t);
        await this.room.disconnect().catch(() => undefined);
    }
}

const rigs: Rig[] = [];
const people: LkPerson[] = [];
const humans: FakeHuman[] = [];

const person = (identity: string): LkPerson => {
    const p = new LkPerson(identity);
    people.push(p);
    return p;
};

afterEach(async () => {
    for (const p of people.splice(0)) await p.leave();
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

/** The game moves the bubble to LiveKit: it hands the bot an invitation made for the bot's own identity. */
async function invite(r: Rig, roomName: string, sources = [GrantSource.MICROPHONE]): Promise<void> {
    const inner = { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await token(roomName, r.game.botId, sources), serverUrl: WS_URL } };
    r.calls.handlePrivateEvent(privateEvent(r.game, r.game.botId, inner, { tags: ['bot'], uuid: 'bot-1' }));
}

const leave = (r: Rig): void =>
    r.calls.handlePrivateEvent(privateEvent(r.game, r.game.botId, { $case: 'livekitDisconnectMessage', livekitDisconnectMessage: {} }, { tags: ['bot'], uuid: 'bot-1' }));

const roster = (identity: string, extra: object = {}) => ({ spaceUserId: identity, uuid: `uuid-${identity}`, tags: [], name: identity, ...extra } as never);

const roomUp = (r: Rig) => r.fromWorker.some((m) => m.type === 'room.state' && m.state === 'connected');

describe.skipIf(!serverUp)('a voice bot in a LiveKit bubble', () => {
    it('speaks into the room, hears only the microphone of the people it was told about, and subscribes to nothing else', async () => {
        const frames: InputFrame[] = [];
        const r = await startRig({ input: (f) => frames.push(f) });
        rigs.push(r);
        const roomName = r.game.spaceName;

        const alice = await person('room_alice').join(roomName);
        // Everything a person could send besides a microphone
        await alice.publishAudio(TrackSource.SOURCE_MICROPHONE, 440);
        await alice.publishVideo(TrackSource.SOURCE_CAMERA);
        await alice.publishVideo(TrackSource.SOURCE_SCREENSHARE);
        await alice.publishAudio(TrackSource.SOURCE_SCREENSHARE_AUDIO, 880);
        // Someone in the room the bot was not told about, and another bot that talks
        const bob = await person('room_bob').join(roomName);
        await bob.publishAudio(TrackSource.SOURCE_MICROPHONE, 330);
        const otherBot = await person('room_otherbot').join(roomName);
        await otherBot.publishAudio(TrackSource.SOURCE_MICROPHONE, 550);

        r.calls.spaceUsers(r.game.spaceName, [roster('room_alice'), roster('room_otherbot', { tags: ['bot'], uuid: 'bot-2' }), roster(r.game.botId, { tags: ['bot'] })]);
        await invite(r, roomName);
        await waitFor('the bot to be in the room', () => roomUp(r));
        r.calls.say(r.game.spaceName, 'seg-1', 'hello everyone, this is the bot talking in the room');

        // The bot's voice reaches every person in the room, as one microphone track and nothing else
        await waitFor('bot audio at the people', () => alice.loudFrom(r.game.botId) >= 20 && bob.loudFrom(r.game.botId) >= 20);
        expect(alice.botPublications(r.game.botId)).toEqual([{ source: TrackSource.SOURCE_MICROPHONE, kind: TrackKind.KIND_AUDIO }]);

        // Alice's microphone is counted
        await waitFor('the microphone to be counted', () => r.worker.counters.get('frames_heard') >= 30);
        expect(frames.every((f) => f.participantId === 'room_alice' && f.pcm16k.length % 160 === 0)).toBe(true);
        expect(Math.max(...frames.slice(10).map((f) => Math.max(...f.pcm16k)))).toBeGreaterThan(3000);

        // The bot is subscribed to that one track: not her camera, her screen, her screen's audio, bob, or the other bot
        await sleep(500);
        const subscriptions = r.worker.roomSubscriptions();
        expect(subscriptions).toEqual([{ identity: 'room_alice', source: TrackSource.SOURCE_MICROPHONE, kind: TrackKind.KIND_AUDIO }]);
        expect(r.worker.counters.get('room_subscribed')).toBe(1);
        expect(r.worker.counters.get('room_refused')).toBe(0);
        expect(r.fromWorker.some((m) => m.type === 'room.state' && m.state === 'failed')).toBe(false);
        expect(r.violations).toEqual([]);
    });

    it('stops hearing a person who is no longer named, and starts hearing one who joins', async () => {
        const r = await startRig();
        rigs.push(r);
        const roomName = r.game.spaceName;
        const alice = await person('room_alice').join(roomName);
        await alice.publishAudio(TrackSource.SOURCE_MICROPHONE);
        const bob = await person('room_bob').join(roomName);
        await bob.publishAudio(TrackSource.SOURCE_MICROPHONE, 330);

        r.calls.spaceUsers(r.game.spaceName, [roster('room_alice')]);
        await invite(r, roomName);
        await waitFor('alice to be heard', () => r.worker.roomSubscriptions().length === 1);

        r.calls.spaceUserJoined(r.game.spaceName, roster('room_bob'));
        await waitFor('bob to be heard', () => r.worker.roomSubscriptions().length === 2);
        r.calls.spaceUserLeft(r.game.spaceName, 'room_alice');
        await waitFor('alice to be dropped', () => r.worker.roomSubscriptions().map((s) => s.identity).join() === 'room_bob');
        expect(r.worker.counters.get('room_unsubscribed')).toBeGreaterThanOrEqual(1);
    });

    it('does not hear anyone when the mode does not listen, and plays nothing to a mode that does not play', async () => {
        const r = await startRig();
        rigs.push(r);
        const alice = await person('room_alice').join(r.game.spaceName);
        await alice.publishAudio(TrackSource.SOURCE_MICROPHONE);
        r.calls.spaceUsers(r.game.spaceName, [roster('room_alice')]);
        await invite(r, r.game.spaceName);
        await waitFor('alice to be heard', () => r.worker.roomSubscriptions().length === 1);

        r.calls.setMode(r.game.spaceName, 'type_and_listen');
        await waitFor('the subscription to end', () => r.worker.roomSubscriptions().length === 0);
        r.calls.setMode(r.game.spaceName, 'off');
        const before = alice.loudFrom(r.game.botId);
        r.calls.say(r.game.spaceName, 'seg-quiet', 'nobody should hear this');
        await sleep(600);
        expect(alice.loudFrom(r.game.botId)).toBe(before);
        expect(r.worker.counters.get('room_frames_out')).toBe(0);
    });

    it('shows a person the words it hears from their microphone in the room, to them only, and offers them back if the room is lost mid-sentence', async () => {
        const ears = new FakeEars(['in the meeting room which of them replied', 'and then the room went away']);
        const r = await startRig({ recognizer: ears.factory });
        rigs.push(r);
        const roomName = r.game.spaceName;
        await person('room_alice').join(roomName);
        const bob = await person('room_bob').join(roomName);
        await bob.publishAudio(TrackSource.SOURCE_MICROPHONE, 330);
        r.calls.spaceUsers(r.game.spaceName, [roster('room_alice'), roster('room_bob')]);
        await invite(r, roomName);
        await waitFor('the bot to be in the room', () => roomUp(r));

        // Bob talks; alice is silent. Only bob gets words, and only bob is shown them
        await waitFor('bob\'s words', () => r.game.drafts.some(([to, d]) => to === 'room_bob' && d.state === 'live'));
        expect(r.game.drafts.every(([to]) => to === 'room_bob')).toBe(true);
        await sleep(300);
        // The room goes away mid-sentence: what was heard is offered back, nothing is sent
        leave(r);
        await waitFor('the words to be offered back', () => r.game.drafts.some(([, d]) => d.state === 'lost'));
        const lost = r.game.drafts.find(([, d]) => d.state === 'lost')!;
        expect(lost[0]).toBe('room_bob');
        expect(lost[1].reason).toBe('path');
        expect(r.game.drafts.some(([, d]) => d.state === 'final')).toBe(false);
        expect(r.violations).toEqual([]);
    });

    it('keeps one audio path while the bubble moves from peer-to-peer to LiveKit and back', async () => {
        const frames: InputFrame[] = [];
        const r = await startRig({ input: (f) => frames.push(f) });
        rigs.push(r);
        const roomName = r.game.spaceName;
        const id = 'room_alice';
        r.calls.spaceUsers(roomName, [roster(id)]);

        // 1. Peer-to-peer
        const first = new FakeHuman(id);
        humans.push(first);
        r.game.humans.set(id, first);
        r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: id, initiator: false } }));
        for (const signal of await first.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
        await waitFor('the peer connection', () => r.fromWorker.some((m) => m.type === 'participant.join'));
        r.calls.say(roomName, 'p2p-1', 'speaking over the direct connection to one person');
        await waitFor('bot audio over the peer connection', () => first.audioPackets >= 20);
        expect(r.worker.laneCount()).toBe(1);

        // 2. The game moves the bubble to LiveKit: the lane is closed, the room is the only path
        const alice = await person(id).join(roomName);
        await alice.publishAudio(TrackSource.SOURCE_MICROPHONE);
        await invite(r, roomName);
        await waitFor('the room', () => roomUp(r));
        await waitFor('the peer connection to be closed', () => r.fromWorker.some((m) => m.type === 'participant.leave' && m.reason === 'superseded'));
        expect(r.worker.laneCount()).toBe(1);
        expect(r.worker.counters.get('lanes_closed')).toBe(1);
        const p2pBefore = first.audioPackets;
        const lkBefore = alice.loudFrom(r.game.botId);
        r.calls.say(roomName, 'lk-1', 'now speaking in the room instead of the direct connection');
        await waitFor('bot audio in the room', () => alice.loudFrom(r.game.botId) >= lkBefore + 20);
        expect(first.audioPackets).toBe(p2pBefore);
        // A late word for the old connection is dropped, not acted on
        const stale = r.worker.counters.get('stale_dropped');
        const sessionId = r.toWorker.find((m) => m.type === 'lane.open')!.sessionId;
        r.link().send({ type: 'lane.signal', sessionId, participantId: id, epoch: 1, signal: { type: 'candidate', candidate: { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host', sdpMLineIndex: 0, sdpMid: '0' } } });
        await waitFor('the stale signal to be dropped', () => r.worker.counters.get('stale_dropped') > stale);
        expect(r.worker.laneCount()).toBe(1);

        // 3. Back to peer-to-peer: the room is left, the newer lane is the only path
        leave(r);
        await waitFor('the bot to leave the room', () => !alice.room.remoteParticipants.has(r.game.botId));
        const second = new FakeHuman(id);
        humans.push(second);
        r.game.humans.set(id, second);
        r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: id, initiator: false } }));
        for (const signal of await second.offer()) r.calls.handlePrivateEvent(privateEvent(r.game, id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
        await waitFor('the new peer connection', () => r.fromWorker.filter((m) => m.type === 'participant.join').length === 2);
        const lkAfter = alice.loudFrom(r.game.botId);
        r.calls.say(roomName, 'p2p-2', 'back on the direct connection');
        await waitFor('bot audio over the new connection', () => second.audioPackets >= 20);
        expect(alice.loudFrom(r.game.botId)).toBe(lkAfter);
        expect(r.worker.laneCount()).toBe(1);
        expect(r.worker.roomSubscriptions()).toEqual([]);
        expect(r.violations).toEqual([]);
    });

    it('leaves the bot out of the room and text-only when the token it was given is not for the bot\'s own room', async () => {
        const r = await startRig();
        rigs.push(r);
        // A token for a room that does not exist cannot be joined with the wrong key
        const bad = new AccessToken(API_KEY, 'not-the-secret-not-the-secret-not-the-secret', { identity: r.game.botId });
        bad.addGrant({ room: r.game.spaceName, roomJoin: true });
        const inner = { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await bad.toJwt(), serverUrl: WS_URL } };
        r.calls.handlePrivateEvent(privateEvent(r.game, r.game.botId, inner, { tags: ['bot'], uuid: 'bot-1' }));
        await waitFor('the failure', () => r.fromWorker.some((m) => m.type === 'room.state' && m.state === 'failed'), 20000);
        expect(r.worker.laneCount()).toBe(0);
        expect(r.worker.roomSubscriptions()).toEqual([]);
    });

    it('is held to a microphone by the media server itself, whatever the bot asks for', async () => {
        const watcher = await person('room_watcher').join('limits-room');
        const attempts: [string, () => Promise<void>][] = [];
        const bots: LkPerson[] = [];
        for (const [name, publish] of [
            ['camera', (p: LkPerson) => p.publishVideo(TrackSource.SOURCE_CAMERA)],
            ['screen', (p: LkPerson) => p.publishVideo(TrackSource.SOURCE_SCREENSHARE)],
            ['screen_audio', (p: LkPerson) => p.publishAudio(TrackSource.SOURCE_SCREENSHARE_AUDIO)],
            ['microphone', (p: LkPerson) => p.publishAudio(TrackSource.SOURCE_MICROPHONE)],
        ] as const) {
            // One bot for each attempt: a refused publish may leave that connection waiting
            const bot = await person(`room_bot_${name}`).join('limits-room', [GrantSource.MICROPHONE]);
            bots.push(bot);
            attempts.push([name, () => publish(bot)]);
        }
        await Promise.all(attempts.map(([, run]) => Promise.race([run().catch(() => undefined), sleep(4000)])));
        await sleep(500);
        const seen = (name: string) => watcher.botPublications(`room_bot_${name}`);
        expect(seen('camera')).toEqual([]);
        expect(seen('screen')).toEqual([]);
        expect(seen('screen_audio')).toEqual([]);
        expect(seen('microphone')).toEqual([{ source: TrackSource.SOURCE_MICROPHONE, kind: TrackKind.KIND_AUDIO }]);
    }, 30000);
});
