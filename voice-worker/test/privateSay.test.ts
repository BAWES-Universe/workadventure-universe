// A reply for one person alone (game #1993), in the speaker: its audio is handed only to a path that reaches that person
// and nobody else, frame by frame, and it is not said at all on a path other people hear too. The paths here are fakes
// that record every frame they were handed. No provider, no network.
import { describe, expect, it } from 'vitest';
import { Counters } from '../src/counters.ts';
import { TTS_FRAME_SAMPLES } from '../src/audioFormat.ts';
import type { PlaybackProgress } from '../src/protocol.ts';
import { Speaker } from '../src/speaker.ts';
import type { OutputFrame, OutputTarget, Reach } from '../src/transport.ts';
import { sleep, waitFor } from './wait.ts';

/** Audio of a given length: a 440 Hz tone at 24 kHz. */
const tone = (ms: number): Int16Array => Int16Array.from({ length: (ms / 20) * TTS_FRAME_SAMPLES }, (_, i) => Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / 24000)));

/** One path, as the speaker sees it: what it was handed, and for whom. */
class Path implements OutputTarget {
    readonly epoch = 1;
    readonly frames: (string | undefined)[] = [];
    cleared = 0;
    playing = true;
    constructor(readonly participantId: string, public reaches: (person: string) => Reach) {}
    plays(): boolean {
        return this.playing;
    }
    reach(person: string): Reach {
        return this.reaches(person);
    }
    sendFrame(_frame: OutputFrame, onlyFor?: string): void {
        this.frames.push(onlyFor);
    }
    clear(): void {
        this.cleared++;
    }
}

/** A person's own connection: it reaches that person and nobody else. */
const lane = (person: string): Path => new Path(person, (asked) => (asked === person ? 'alone' : 'elsewhere'));
/** A room everyone in it hears: it reaches a person alone only while they are the one person in it. */
const room = (inIt: string[]): Path => new Path('room', (asked) => (inIt.some((person) => person !== asked) ? 'shared' : inIt.includes(asked) ? 'alone' : 'elsewhere'));

function rig(paths: Path[], speakMs = 400) {
    const progress: Omit<PlaybackProgress, 'type' | 'sessionId' | 'ts'>[] = [];
    const counters = new Counters();
    let asked = 0;
    const speaker = new Speaker({
        counters,
        voice: {
            speak: async function* () {
                asked++;
                yield tone(speakMs);
            },
        },
        maxReplyMs: 60000,
        speechTimeoutMs: 5000,
        targets: () => paths,
        active: () => true,
        progress: (m) => progress.push(m),
    });
    const finished = (id: string) => progress.find((p) => p.segmentId === id && p.finished);
    return { speaker, counters, progress, finished, asked: () => asked };
}

describe('a reply for one person alone, in the speaker', () => {
    it('is handed to that person\'s connection and no other, to its last frame', async () => {
        const [alice, bob] = [lane('alice'), lane('bob')];
        const r = rig([alice, bob]);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);

        expect(r.finished('s1')).toMatchObject({ interrupted: false, reason: 'completed', playedMs: 400 });
        expect(alice.frames).toHaveLength(20);
        // Each frame went out with her name on it, so the path itself can refuse it
        expect(alice.frames.every((onlyFor) => onlyFor === 'alice')).toBe(true);
        expect(bob.frames).toEqual([]);
        await r.speaker.shutdown();
    });

    it('is not handed to a connection that opens while it plays', async () => {
        const alice = lane('alice');
        const paths = [alice];
        const r = rig(paths, 600);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the first frames', () => alice.frames.length >= 5, 2000);
        const bob = lane('bob');
        paths.push(bob);
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);

        expect(r.finished('s1')).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(alice.frames).toHaveLength(30);
        expect(bob.frames).toEqual([]);

        // What is said to everyone next reaches both
        r.speaker.enqueue('s2', 'for everyone');
        await waitFor('the next reply to end', () => !!r.finished('s2'), 3000);
        expect(bob.frames).toHaveLength(30);
        expect(bob.frames.every((onlyFor) => onlyFor === undefined)).toBe(true);
        await r.speaker.shutdown();
    });

    it('goes on to that person\'s new connection when theirs is replaced, still to nobody else', async () => {
        const first = lane('alice');
        const bob = lane('bob');
        const paths = [first, bob];
        const r = rig(paths, 600);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the first frames', () => first.frames.length >= 5, 2000);
        const second = lane('alice');
        paths.splice(0, 1, second);
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);

        expect(first.frames.length + second.frames.length).toBe(30);
        expect(second.frames.length).toBeGreaterThan(0);
        expect(bob.frames).toEqual([]);
        await r.speaker.shutdown();
    });

    it('is said into a room only while that person is the one person in it', async () => {
        const alone = room(['alice']);
        const r = rig([alone]);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);
        expect(r.finished('s1')).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(alone.frames).toHaveLength(20);
        await r.speaker.shutdown();
    });

    it('is not said at all, and nothing is asked of the provider, when the room has anyone else in it', async () => {
        const shared = room(['alice', 'bob']);
        const r = rig([shared]);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);

        expect(r.finished('s1')).toEqual({ segmentId: 's1', playedMs: 0, totalMs: 0, finished: true, interrupted: true, reason: 'private' });
        expect(shared.frames).toEqual([]);
        expect(r.asked()).toBe(0);
        expect(r.counters.get('private_unsaid')).toBe(1);

        // The next reply for everyone is said as usual
        r.speaker.enqueue('s2', 'for everyone');
        await waitFor('the next reply to end', () => !!r.finished('s2'), 3000);
        expect(r.finished('s2')).toMatchObject({ interrupted: false, reason: 'completed' });
        expect(shared.frames).toHaveLength(20);
        await r.speaker.shutdown();
    });

    it('stops within a frame when someone else comes into the room, and what was handed over and not yet sent is dropped', async () => {
        const inIt = ['alice'];
        const path = room(inIt);
        const r = rig([path], 2000);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the first frames', () => path.frames.length >= 5, 2000);

        inIt.push('bob');
        const handed = path.frames.length;
        await waitFor('the reply to stop', () => !!r.finished('s1'), 1000);
        // At most the frame that was being handed over as he came in
        expect(path.frames.length - handed).toBeLessThanOrEqual(1);
        expect(r.finished('s1')).toMatchObject({ interrupted: true, reason: 'private' });
        expect(r.finished('s1')!.playedMs).toBeLessThan(2000);
        expect(path.cleared).toBeGreaterThanOrEqual(1);
        expect(r.counters.get('private_stopped')).toBe(1);

        await sleep(200);
        expect(path.frames.length - handed).toBeLessThanOrEqual(1);
        await r.speaker.shutdown();
    });

    it('is handed to no path when none reaches that person', async () => {
        // A room she is not connected to, beside a connection for someone else: neither reaches her
        const elsewhere = room([]);
        const bob = lane('bob');
        const r = rig([elsewhere, bob]);
        r.speaker.enqueue('s1', 'for alice', undefined, undefined, 'alice');
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);

        expect(elsewhere.frames).toEqual([]);
        expect(bob.frames).toEqual([]);
        // Nobody heard a moment of it, so the bot server counts it as not played
        expect(r.finished('s1')).toMatchObject({ playedMs: 0, reason: 'lane_loss' });
        await r.speaker.shutdown();
    });

    it('leaves a reply for everyone as it was: every path that plays gets it', async () => {
        const [alice, bob] = [lane('alice'), lane('bob')];
        const r = rig([alice, bob]);
        r.speaker.enqueue('s1', 'for everyone');
        await waitFor('the reply to end', () => !!r.finished('s1'), 3000);
        expect(alice.frames).toHaveLength(20);
        expect(bob.frames).toHaveLength(20);
        await r.speaker.shutdown();
    });
});
