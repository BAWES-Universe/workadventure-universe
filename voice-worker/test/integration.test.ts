// The worker, the bot server's relay and fake browsers talking through the real bridge. Fake speech only.
import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import WebSocket from 'ws';
import type { InputFrame } from '../src/transport.ts';
import { FakeHuman, type Rig, connectPeople, privateEvent, sleep, startRig, waitFor } from './harness.ts';

const rigs: Rig[] = [];
const humans: FakeHuman[] = [];

async function rig(options: Parameters<typeof startRig>[0] = {}): Promise<Rig> {
    const r = await startRig(options);
    rigs.push(r);
    return r;
}

const human = (id: string, withVideo = false): FakeHuman => {
    const h = new FakeHuman(id, withVideo);
    humans.push(h);
    return h;
};

/** What the game does when a person walks into a voice bot's bubble: a start, then the person's offer and candidates. */
async function connectBot(r: Rig, person: FakeHuman): Promise<void> {
    r.game.humans.set(person.id, person);
    r.calls.handlePrivateEvent(privateEvent(r.game, person.id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: person.id, initiator: false } }));
    for (const signal of await person.offer()) {
        r.calls.handlePrivateEvent(privateEvent(r.game, person.id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
    }
}

const joined = (r: Rig, id: string) => r.fromWorker.some((m) => m.type === 'participant.join' && m.participantId === id);

afterEach(async () => {
    for (const h of humans.splice(0)) await h.close().catch(() => undefined);
    for (const r of rigs.splice(0)) {
        r.calls.shutdown();
        await r.worker.close().catch(() => undefined);
    }
});

describe('a voice bot and a person in a peer-to-peer bubble', () => {
    it('carries fake bot speech to the person and counts the permitted microphone audio', async () => {
        const frames: InputFrame[] = [];
        const r = await rig({ input: (f) => frames.push(f) });
        const alice = human('alice');
        await connectBot(r, alice);
        await waitFor('the audio connection', () => joined(r, 'alice'));

        alice.startMic(440);
        r.calls.say(r.game.spaceName, 'seg-1', 'hello there, this is the bot talking');
        await waitFor('bot audio at the person', () => alice.loudFrames >= 30);
        await waitFor('the microphone to be counted', () => r.worker.counters.get('frames_heard') >= 30);

        expect(alice.audioPackets).toBeGreaterThanOrEqual(30);
        expect(r.worker.counters.get('rtp_out')).toBeGreaterThanOrEqual(30);
        // The microphone arrives as 20 ms frames of 16 kHz audio, loud like the tone that was sent
        expect(frames[0].pcm16k.length).toBe(320);
        expect(frames[0].participantId).toBe('alice');
        expect(Math.max(...frames.slice(5).map((f) => Math.max(...f.pcm16k)))).toBeGreaterThan(3000);
        expect(r.worker.counters.get('heard_ms')).toBeGreaterThanOrEqual(r.worker.counters.get('frames_heard') * 19);
        // The tile of the bot shows an unmuted audio-only participant
        await waitFor('the constraint message', () => alice.dataMessages.length > 0);
        expect(alice.dataMessages[0]).toEqual({ type: 'constraint', message: { audio: true, video: false } });

        await waitFor('the segment to finish', () => r.fromWorker.some((m) => m.type === 'playback.progress' && m.finished));
        const done = r.fromWorker.find((m) => m.type === 'playback.progress' && m.finished);
        expect(done).toMatchObject({ segmentId: 'seg-1', interrupted: false, reason: 'completed' });
        expect(r.violations).toEqual([]);
    });

    it('takes no microphone audio unless the mode listens, and plays nothing when the mode is off', async () => {
        const r = await rig();
        const alice = human('alice');
        await connectBot(r, alice);
        await waitFor('the audio connection', () => joined(r, 'alice'));
        alice.startMic();
        await waitFor('microphone audio', () => r.worker.counters.get('frames_heard') >= 10);

        r.calls.setMode(r.game.spaceName, 'listen_only', 'alice');
        await sleep(100);
        const heard = r.worker.counters.get('frames_heard');
        await sleep(400);
        expect(r.worker.counters.get('frames_heard')).toBe(heard);
        expect(r.worker.counters.get('frames_gated')).toBeGreaterThan(10);

        // Still hears the bot
        const before = alice.audioPackets;
        r.calls.say(r.game.spaceName, 'seg-2', 'still here');
        await waitFor('bot audio', () => alice.audioPackets > before + 10);

        r.calls.setMode(r.game.spaceName, 'off', 'alice');
        await sleep(100);
        const quiet = alice.audioPackets;
        r.calls.say(r.game.spaceName, 'seg-3', 'nobody should hear this');
        await waitFor('the segment to be done', () => r.fromWorker.filter((m) => m.type === 'playback.progress' && m.finished).length >= 2);
        expect(alice.audioPackets - quiet).toBeLessThanOrEqual(2);
        expect(r.violations).toEqual([]);
    });

    it('refuses video: only the audio of an offer is answered', async () => {
        const r = await rig();
        const alice = human('alice', true);
        await connectBot(r, alice);
        await waitFor('the audio connection', () => joined(r, 'alice'));

        expect(alice.pc.remoteDescription!.sdp).toMatch(/m=video 0 /);
        expect(alice.pc.remoteDescription!.sdp).toMatch(/m=audio [1-9]/);
        expect(r.worker.counters.get('tracks_refused')).toBe(0);
        expect(alice.videoPackets).toBe(0);
        expect(r.violations).toEqual([]);
    });

    it('keeps one path when the person connects again: the old one is closed, and its messages are dropped', async () => {
        const r = await rig();
        const first = human('alice');
        await connectBot(r, first);
        await waitFor('the first connection', () => joined(r, 'alice'));
        const firstOpen = r.toWorker.find((m) => m.type === 'lane.open')!;
        first.startMic();

        const second = human('alice');
        await connectBot(r, second);
        await waitFor('the second connection', () => r.fromWorker.filter((m) => m.type === 'participant.join').length >= 2);
        expect(r.worker.laneCount()).toBe(1);
        expect(r.worker.counters.get('lanes_closed')).toBe(1);

        // Only the new path carries the bot's voice
        const oldBefore = first.audioPackets;
        const newBefore = second.audioPackets;
        r.calls.say(r.game.spaceName, 'seg-4', 'only the new connection hears me');
        await waitFor('audio on the new path', () => second.audioPackets > newBefore + 20);
        expect(first.audioPackets).toBe(oldBefore);

        // A late message addressed to the old epoch changes nothing
        const stale = r.worker.counters.get('stale_dropped');
        r.link().send({ type: 'lane.close', sessionId: (firstOpen as { sessionId: string }).sessionId, participantId: 'alice', epoch: (firstOpen as { epoch: number }).epoch });
        await waitFor('the stale message to be dropped', () => r.worker.counters.get('stale_dropped') > stale);
        expect(r.worker.laneCount()).toBe(1);
        expect(r.fromWorker.some((m) => m.type === 'error' && m.code === 'stale_epoch')).toBe(true);
        // ... and the old path is not announced as leaving: the bot server replaced it itself
        expect(r.fromWorker.filter((m) => m.type === 'participant.leave')).toEqual([]);
        expect(r.violations).toEqual([]);
    });

    it('leaves the people in the bubble talking to each other when the worker stops, and the bot goes text-only', async () => {
        const r = await rig();
        const alice = human('alice');
        const bob = human('bob');
        await connectPeople(alice, bob);
        await waitFor('the two people to connect', () => alice.state === 'connected' && bob.pc.connectionState === 'connected');
        await connectBot(r, alice);
        await waitFor('the audio connection', () => joined(r, 'alice'));
        alice.startMic();
        bob.startMic();
        await waitFor('both people to hear each other', () => alice.audioPackets > 20 && bob.audioPackets > 20);

        await r.worker.close();
        await waitFor('the bot to give up its call', () => r.game.disconnects.includes('alice'));
        expect(r.calls.hasCall(r.game.spaceName, 'alice')).toBe(false);

        // People's own audio goes on, unchanged
        const aliceBefore = alice.audioPackets;
        const bobBefore = bob.audioPackets;
        await sleep(700);
        expect(alice.audioPackets - aliceBefore).toBeGreaterThanOrEqual(25);
        expect(bob.audioPackets - bobBefore).toBeGreaterThanOrEqual(25);
        expect(alice.pc.connectionState).toBe('connected');

        // A new person arriving gets no audio connection with the bot, only a disconnect: the bot stays text-only
        const carol = human('carol');
        r.game.humans.set('carol', carol);
        r.calls.handlePrivateEvent(privateEvent(r.game, 'carol', { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: 'carol', initiator: false } }));
        expect(r.game.disconnects).toContain('carol');
        expect(r.calls.stats.refusedStart).toBeGreaterThanOrEqual(1);
    });
});

describe('the bridge', () => {
    it('refuses a bot server without the secret, and accepts it with the secret', async () => {
        const r = await rig({ secret: 's3cret' });
        const without = new WebSocket(`ws://127.0.0.1:${r.workerPort}/bridge?botId=intruder`);
        const refused = await new Promise<boolean>((resolve) => {
            without.on('open', () => resolve(false));
            without.on('error', () => resolve(true));
        });
        expect(refused).toBe(true);
        expect(r.worker.counters.get('bridge_unauthorized')).toBe(1);
        expect(r.link().isUp()).toBe(true);
    });

    it('survives request paths that are not valid URLs, on plain requests and on upgrades', async () => {
        const r = await rig();
        const raw = (request: string) =>
            new Promise<string>((resolve) => {
                const socket = net.connect(r.workerPort, '127.0.0.1', () => socket.write(request));
                let data = '';
                socket.on('data', (d) => (data += d));
                socket.on('close', () => resolve(data));
                socket.on('error', () => resolve(data));
                setTimeout(() => socket.destroy(), 1500);
            });
        for (const path of ['//', '//%', '//bridge?botId=x', '/%zz']) {
            const plain = await raw(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
            expect(plain).toMatch(/^HTTP\/1\.1 (400|404)/);
            const upgrade = await raw(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
            expect(upgrade).toMatch(/^HTTP\/1\.1 400/);
        }
        // Still serving, and the bot's own connection is untouched
        const health = await fetch(`http://127.0.0.1:${r.workerPort}/health`);
        expect(health.status).toBe(200);
        expect(r.link().isUp()).toBe(true);
        expect(r.worker.counters.get('http_bad_url')).toBeGreaterThanOrEqual(1);
    });

    it('answers a message that is not in the contract with an error and does nothing else', async () => {
        const r = await rig();
        r.calls.say(r.game.spaceName, 'x', 'no bubble yet');
        const sessionId = 'bot1.9';
        r.link().send({ type: 'lane.open', sessionId, participantId: 'alice', epoch: 1 });
        r.link().send({ type: 'lane.open', sessionId, participantId: 'alice', epoch: 0 } as never);
        r.link().send({ type: 'lane.signal', sessionId, participantId: 'alice', epoch: 1, signal: { type: 'offer', sdp: '' } } as never);
        await waitFor('the worker to answer', () => r.fromWorker.filter((m) => m.type === 'error').length >= 3);
        const codes = r.fromWorker.filter((m) => m.type === 'error').map((m) => (m as { code: string }).code);
        expect(codes).toContain('no_session');
        expect(codes).toContain('invalid_message');
        expect(r.worker.laneCount()).toBe(0);
    });

    it('turns away a connection over the limit, and the person is told to disconnect', async () => {
        const r = await rig({ maxLanes: 1 });
        const alice = human('alice');
        const bob = human('bob');
        await connectBot(r, alice);
        await waitFor('the first connection', () => joined(r, 'alice'));
        await connectBot(r, bob);
        await waitFor('the second one to be refused', () => r.game.disconnects.includes('bob'));
        expect(r.worker.laneCount()).toBe(1);
        expect(r.worker.counters.get('lanes_refused')).toBe(1);
        expect(r.violations).toEqual([]);
    });
});
