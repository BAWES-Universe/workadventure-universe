// Drives a running voice worker the way the bot server and people's browsers do: real bridge messages and real media,
// on either path: "lane" = real peer connections (proximity WebRTC) with Opus microphone audio; "room" = a real LiveKit
// room per bubble (needs a livekit-server on 127.0.0.1:7880, as the worker's tests do). Audio is made from the test
// recordings. One bot per bubble; one person per bubble unless PEOPLE_PER_BUBBLE says more, so N streams are
// N / PEOPLE_PER_BUBBLE sessions. Every person talks over continuous background noise; audio goes missing; people leave
// and come back; each bot speaks now and then. With several people in a bubble they say their sentences at the same
// moments, half a second apart (people talking over each other), and with MUTE_EVERY_S one of them stops being heard
// for MUTE_FOR_MS (two seconds unless set) now and then (their mode is set to off, then back) while the others carry on. The worker runs
// elsewhere (worker-under-load.ts, in a capped container).
//   tsx src/load.ts <ws url> <data dir> <streams> <seconds> <out.json> [lane|room]
//   LOAD_TAG=a keeps two generators driving one worker apart (bot and people's names)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Encoder } from '@evan/opus';
import { VoiceCalls } from '../../bots/voice/VoiceCalls.ts';
import { WorkerLink } from '../../bots/voice/VoiceLink.ts';
import { FakeGame, FakeHuman, privateEvent, waitFor } from '../../voice-worker/test/harness.ts';
import { buildManifest } from './fixtures.ts';
import { up3 } from './paths.ts';

// The media libraries are the worker's own installs
const fromWorker = createRequire(new URL('../../voice-worker/package.json', import.meta.url));
const { RtpHeader, RtpPacket } = fromWorker('werift') as typeof import('../../voice-worker/node_modules/werift');
const [url, data, streamsArg, secondsArg, out, pathArg] = process.argv.slice(2);
const streams = Number(streamsArg);
const seconds = Number(secondsArg);
const path = pathArg === 'room' ? 'room' : 'lane';
const perBubble = Math.max(1, Number(process.env.PEOPLE_PER_BUBBLE ?? 1));
const muteEveryMs = Number(process.env.MUTE_EVERY_S ?? 0) * 1000;
const muteForMs = Number(process.env.MUTE_FOR_MS ?? 2000);
const tag = process.env.LOAD_TAG ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_WS_URL ?? 'ws://127.0.0.1:7880';
const lk = path === 'room' ? ((await import(pathToFileURL(fromWorker.resolve('@livekit/rtc-node')).href)) as typeof import('../../voice-worker/node_modules/@livekit/rtc-node')) : undefined;
const sdk = path === 'room' ? ((await import(pathToFileURL(fromWorker.resolve('livekit-server-sdk')).href)) as typeof import('../../voice-worker/node_modules/livekit-server-sdk')) : undefined;
async function roomToken(room: string, identity: string): Promise<string> {
    const t = new sdk!.AccessToken(process.env.LIVEKIT_API_KEY ?? 'devkey', process.env.LIVEKIT_API_SECRET ?? 'secret-secret-secret-secret-12345', { identity, name: identity });
    t.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: true, canPublishSources: [sdk!.TrackSource.MICROPHONE] });
    return t.toJwt();
}

// ---- Audio: a minute of non-speech noise at -35 dBFS (every fourth person: other people talking) with three sentences on top ----
const manifest = buildManifest(data).filter((m) => m.split === 'report');
const noises = manifest.filter((m) => m.kind === 'noise' && m.condition === '-35' && m.label === 'nonspeech');
const babble = manifest.filter((m) => m.kind === 'noise' && m.condition === '-35' && m.label === 'speechlike');
const sentences = manifest.filter((m) => m.kind === 'speech' && m.set === 'en-sentence' && m.condition === 'S20');
function loopFor(person: number): { packets: Buffer[]; wide: Int16Array } {
    const bed = (person % 4 === 3 ? babble : noises)[person % (person % 4 === 3 ? babble.length : noises.length)].build().pcm;
    const pcm = new Int16Array(60 * 16000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = bed[i % bed.length];
    for (let s = 0; s < 3; s++) {
        const say = sentences[(person * 3 + s) % sentences.length].build().pcm;
        const at = (5 + s * 20) * 16000;
        for (let i = 0; i < say.length && at + i < pcm.length; i++) pcm[at + i] = Math.max(-32768, Math.min(32767, pcm[at + i] + say[i]));
    }
    const wide = up3(pcm);
    const packets: Buffer[] = [];
    if (path === 'lane') {
        const encoder = new Encoder({ channels: 1, sample_rate: 48000, application: 'voip' });
        for (let at = 0; at + 960 <= wide.length; at += 960) packets.push(Buffer.from(encoder.encode(wide.subarray(at, at + 960))));
    }
    return { packets, wide };
}

/** One bot's bubble: a session in the worker. */
interface Bubble {
    game: FakeGame;
    calls: VoiceCalls;
    link: WorkerLink;
    roomUp: boolean;
    invited: boolean;
    people: Stream[];
}
interface Stream {
    index: number;
    id: string;
    bubble: Bubble;
    human?: FakeHuman;
    /** Room path: the person's own connection to the LiveKit room and the microphone it publishes. */
    room?: { disconnect(): Promise<void> };
    mic?: { captureFrame(frame: unknown): Promise<void> };
    /** Room path: named in the bubble's roster. */
    named: boolean;
    /** Their mode is off for the moment: what they send is not meant to be heard. */
    muted: boolean;
    wide: Int16Array;
    packets: Buffer[];
    at: number;
    seq: number;
    ts: number;
    joined: boolean;
    holeUntil: number;
}
// sent = microphone audio sent while the person was meant to be heard; sentMuted = sent while their mode was off
const tally = { joins: 0, joinFailures: 0, leaves: 0, sent: 0, sentMuted: 0, withheld: 0, mutes: 0, said: 0, linkDowns: 0, botAudioPackets: 0, errors: [] as string[] };
const all: Stream[] = [];
// The measured stretch: SIGUSR2 starts it and SIGUSR1 ends it, at the same moments as for the worker (scripts/worker-load.sh),
// so what the worker heard in it can be set against what was sent in it
let measuredFrom: { at: number; sent: number; sentMuted: number; withheld: number } | undefined;
let measured: { seconds: number; sent: number; sentMuted: number; withheld: number; audioSecondsSent: number } | undefined;
process.on('SIGUSR2', () => {
    measuredFrom = { at: performance.now(), sent: tally.sent, sentMuted: tally.sentMuted, withheld: tally.withheld };
});
process.on('SIGUSR1', () => {
    if (!measuredFrom) return;
    const sent = tally.sent - measuredFrom.sent;
    measured = { seconds: Math.round((performance.now() - measuredFrom.at) / 1000), sent, sentMuted: tally.sentMuted - measuredFrom.sentMuted, withheld: tally.withheld - measuredFrom.withheld, audioSecondsSent: Math.round((sent * (path === 'room' ? 10 : 20)) / 1000) };
    write();
});

// Written when the measured stretch ends (the worker may be closed under this generator's feet afterwards) and again at the end
function write(): void {
    writeFileSync(out, JSON.stringify({ path, streams, bubbles: bubbles.length, peoplePerBubble: perBubble, muteEverySeconds: muteEveryMs / 1000, muteForMs, seconds, ...tally, measured, stillConnected: all.filter((s) => s.joined).length }, null, 2));
}
const roster = (identity: string, extra: object = {}) => ({ spaceUserId: identity, uuid: `uuid-${identity}`, tags: [], name: identity, ...extra }) as never;
/** Everyone the bubble's roster names now: its people who are in, and the bot. */
const named = (b: Bubble) => [...b.people.filter((p) => p.named).map((p) => roster(p.id)), roster(b.game.botId, { tags: ['bot'] })];
async function joinRoom(s: Stream): Promise<void> {
    const { id, bubble: b } = s;
    const { game, calls } = b;
    try {
        const room = new lk!.Room();
        await room.connect(LIVEKIT_URL, await roomToken(game.spaceName, id), { autoSubscribe: false, dynacast: false });
        const source = new lk!.AudioSource(48000, 1);
        await room.localParticipant!.publishTrack(lk!.LocalAudioTrack.createAudioTrack('mic', source), new lk!.TrackPublishOptions({ source: lk!.TrackSource.SOURCE_MICROPHONE }));
        s.named = true;
        calls.spaceUsers(game.spaceName, named(b));
        if (!b.invited) {
            b.invited = true;
            calls.handlePrivateEvent(privateEvent(game, game.botId, { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: await roomToken(game.spaceName, game.botId), serverUrl: LIVEKIT_URL } }, { tags: ['bot'], uuid: 'bot-1' }));
        }
        await waitFor(`the bot to be in the room of ${id}`, () => b.roomUp, 20000);
        s.room = room;
        s.mic = source as never;
        s.joined = true;
        tally.joins++;
    } catch (error) {
        s.named = false;
        tally.joinFailures++;
        tally.errors.push(String(error));
    }
}
async function leaveRoom(s: Stream): Promise<void> {
    const room = s.room;
    if (!room) return;
    s.joined = false;
    s.room = undefined;
    s.mic = undefined;
    // The bubble's roster no longer names them: the bot stops hearing them
    s.named = false;
    s.bubble.calls.spaceUsers(s.bubble.game.spaceName, named(s.bubble));
    await room.disconnect().catch(() => undefined);
    tally.leaves++;
}
async function join(s: Stream): Promise<void> {
    if (path === 'room') return joinRoom(s);
    const { id } = s;
    const { game, calls } = s.bubble;
    const human = new FakeHuman(id);
    game.humans.set(id, human);
    const before = calls.hasCall(game.spaceName, id);
    calls.spaceUserJoined(game.spaceName, { spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id } as never);
    calls.handlePrivateEvent(privateEvent(game, id, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: id, initiator: false } }));
    for (const signal of await human.offer()) calls.handlePrivateEvent(privateEvent(game, id, { $case: 'webRtcSignal', webRtcSignal: { signal } }));
    try {
        await waitFor(`the audio connection of ${id}`, () => human.state === 'connected', 15000);
        s.human = human;
        s.joined = true;
        tally.joins++;
    } catch (error) {
        tally.joinFailures++;
        tally.errors.push(`${String(error)} (had call before: ${before})`);
        await human.close().catch(() => undefined);
    }
}
async function leave(s: Stream): Promise<void> {
    if (path === 'room') return leaveRoom(s);
    const human = s.human;
    if (!human) return;
    s.joined = false;
    s.human = undefined;
    tally.botAudioPackets += human.audioPackets;
    s.bubble.calls.spaceUserLeft(s.bubble.game.spaceName, human.id);
    s.bubble.game.humans.delete(human.id);
    await human.close().catch(() => undefined);
    tally.leaves++;
}

const bubbles: Bubble[] = [];
for (let index = 0; index < streams; index++) {
    let bubble = bubbles[Math.floor(index / perBubble)];
    if (!bubble) {
        const game = new FakeGame();
        // Each bubble is its own LiveKit room
        (game as { spaceName: string }).spaceName = `load-${tag}${process.pid}-${bubbles.length}`;
        let link!: WorkerLink;
        const made = { game, roomUp: false, invited: false, people: [] } as unknown as Bubble;
        const botName = `bot${tag}${bubbles.length}`;
        const calls = new VoiceCalls(botName, game, (handlers) => {
            link = new WorkerLink({
                url,
                botId: botName,
                onMessage: (message) => {
                    if (message.type === 'room.state') made.roomUp = message.state === 'connected';
                    if (message.type === 'error') tally.errors.push(`worker: ${message.code}`);
                    handlers.onMessage(message);
                },
                onUp: handlers.onUp,
                onDown: () => (tally.linkDowns++, handlers.onDown()),
            });
            link.start();
            return link;
        });
        await waitFor('the bot server to reach the worker', () => link.isUp());
        calls.spaceUsers(game.spaceName, []);
        made.calls = calls;
        made.link = link;
        bubbles.push((bubble = made));
    }
    // Alone in a bubble: anywhere in their minute. With others: the same minute as the others, half a second apart, so their sentences overlap
    const place = bubble.people.length;
    const at = perBubble === 1 ? Math.floor(Math.random() * 3000) : path === 'room' ? place * 24000 : place * 25;
    const stream = { index, id: `p${tag}${index}`, bubble, ...loopFor(index), at, seq: 1000, ts: 5000, joined: false, holeUntil: 0, named: false, muted: false } as Stream;
    bubble.people.push(stream);
    all.push(stream);
}
// People arrive a few at a time, as they would
for (let i = 0; i < all.length; i += 5) await Promise.all(all.slice(i, i + 5).map(join));
console.error(`${tally.joins} of ${streams} people connected`);

const started = performance.now();
let tick = 0;
let lastSay = 0;
let lastChurn = 0;
let lastMute = 0;
let lastHole = 0;
let churning = false;
await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
        const elapsed = performance.now() - started;
        if (elapsed >= seconds * 1000) {
            clearInterval(timer);
            resolve();
            return;
        }
        // Room path: 10 ms of microphone audio at a time, as a browser captures it; a hole is 200 ms not captured
        while (path === 'room' && tick * 10 <= elapsed) {
            tick++;
            for (const s of all) {
                s.at = (s.at + 480) % (s.wide.length - 480);
                if (!s.joined || !s.mic) continue;
                if (elapsed < s.holeUntil) {
                    tally.withheld++;
                    continue;
                }
                void s.mic.captureFrame(new lk!.AudioFrame(s.wide.slice(s.at, s.at + 480), 48000, 1, 480)).catch(() => undefined);
                if (s.muted) tally.sentMuted++;
                else tally.sent++;
            }
        }
        // Lane path: catch up if the clock slipped, so every stream stays continuous at 50 packets a second
        while (path === 'lane' && tick * 20 <= elapsed) {
            tick++;
            for (const s of all) {
                s.at = (s.at + 1) % s.packets.length;
                s.seq++;
                s.ts += 960;
                if (!s.joined || !s.human) continue;
                // About 1 packet in 100 is lost, and now and then 200 ms goes missing in one piece
                if (elapsed < s.holeUntil || Math.random() < 0.01) {
                    tally.withheld++;
                    continue;
                }
                try {
                    s.human.mic.writeRtp(new RtpPacket(new RtpHeader({ sequenceNumber: s.seq & 0xffff, timestamp: s.ts >>> 0, payloadType: 111, ssrc: 4242 + s.index, marker: false }), s.packets[s.at]));
                    if (s.muted) tally.sentMuted++;
                    else tally.sent++;
                } catch {
                    /* closing */
                }
            }
        }
        if (elapsed - lastHole >= 7000) {
            lastHole = elapsed;
            all[Math.floor(Math.random() * all.length)].holeUntil = elapsed + 200;
        }
        if (elapsed - lastSay >= 10000) {
            lastSay = elapsed;
            for (const [i, b] of bubbles.entries()) if (b.calls.say(b.game.spaceName, `seg-${i}-${tally.said}`, 'Here is what I found for you, and there is a little more to say about it.')) tally.said++;
        }
        // One person stops being heard for a moment while the rest of their bubble carries on
        if (muteEveryMs && elapsed - lastMute >= muteEveryMs) {
            lastMute = elapsed;
            const s = all[(Math.floor(elapsed / muteEveryMs) * 7) % all.length];
            if (s.joined && !s.muted && s.bubble.calls.setMode(s.bubble.game.spaceName, 'off', s.id)) {
                s.muted = true;
                tally.mutes++;
                setTimeout(() => {
                    s.bubble.calls.setMode(s.bubble.game.spaceName, 'talk', s.id);
                    s.muted = false;
                }, muteForMs);
            }
        }
        // Someone leaves and comes back every 15 seconds
        if (elapsed - lastChurn >= 15000 && !churning) {
            lastChurn = elapsed;
            churning = true;
            const s = all[Math.floor(elapsed / 15000) % all.length];
            void leave(s)
                .then(() => new Promise((r) => setTimeout(r, 1000)))
                .then(() => join(s))
                .finally(() => (churning = false));
        }
    }, 5);
});
for (const s of all) tally.botAudioPackets += s.human?.audioPackets ?? 0;
write();
console.error(JSON.stringify({ ...tally, errors: tally.errors.slice(0, 3) }));
for (const s of all) {
    await s.human?.close().catch(() => undefined);
    await s.room?.disconnect().catch(() => undefined);
}
for (const b of bubbles) b.calls.shutdown();
process.exit(0);
