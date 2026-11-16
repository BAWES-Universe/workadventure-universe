// Asking again for a microphone that did not come back (see RESUBSCRIBE_CHECK_MS in src/roomTransport.ts), and what a late
// "subscribed" from the ask before does to it. The LiveKit SDK is replaced with a room the test fills and fires by hand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rooms: FakeRoom[] = [];

class FakeRoom {
    readonly remoteParticipants = new Map<string, { identity: string; trackPublications: Map<string, FakePublication> }>();
    readonly localParticipant = { publishTrack: vi.fn(async () => undefined) };
    private readonly handlers = new Map<string, (...args: unknown[]) => void>();
    constructor() {
        rooms.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void): void {
        this.handlers.set(event, handler);
    }
    emit(event: string, ...args: unknown[]): void {
        this.handlers.get(event)?.(...args);
    }
    async connect(): Promise<void> {}
    async disconnect(): Promise<void> {}
}

/** A microphone the bot asks for; the media server answers only when the test says so (the subscription never flips by itself). */
class FakePublication {
    subscribed = false;
    readonly kind = 1;
    readonly source = 2;
    readonly asked: boolean[] = [];
    constructor(readonly sid: string) {}
    setSubscribed(on: boolean): void {
        this.asked.push(on);
    }
}

vi.mock('@livekit/rtc-node', () => ({
    Room: FakeRoom,
    RoomEvent: { TrackPublished: 'trackPublished', TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed', Disconnected: 'disconnected', ParticipantConnected: 'participantConnected' },
    AudioSource: class {
        clearQueue(): void {}
        async close(): Promise<void> {}
        async captureFrame(): Promise<void> {}
    },
    AudioFrame: class {},
    AudioStream: class {},
    LocalAudioTrack: { createAudioTrack: () => ({}) },
    TrackPublishOptions: class {},
    TrackSource: { SOURCE_MICROPHONE: 2 },
    TrackKind: { KIND_AUDIO: 1 },
}));

const { RoomTransport } = await import('../src/roomTransport.ts');

async function inRoom() {
    const counts = new Map<string, number>();
    const deps = {
        counters: { inc: (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1) },
        input: vi.fn(),
        onGone: vi.fn(),
        onConnected: vi.fn(),
        voiceActive: () => true,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const room = new RoomTransport(1, 'ws://x', 'token', deps as any);
    const fake = rooms[rooms.length - 1];
    const publication = new FakePublication('TR_alice');
    const alice = { identity: 'room_alice', trackPublications: new Map([[publication.sid, publication]]) };
    fake.remoteParticipants.set('room_alice', alice);
    await room.start();
    return { room, fake, alice, publication, count: (name: string) => counts.get(name) ?? 0 };
}

beforeEach(() => {
    rooms.length = 0;
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('asking again for a microphone that did not come back', () => {
    it('asks once more after the gap even when a late "subscribed" from the ask before arrives in it', async () => {
        const { room, fake, alice, publication } = await inRoom();
        const arrives = () => fake.emit('trackSubscribed', { sid: publication.sid, kind: 1 }, publication, alice);
        room.setPeople([{ participantId: 'room_alice', mode: 'talk' }]);
        arrives();
        // Listening stops and comes back; the microphone does not arrive by itself
        room.setMode('off', 'room_alice');
        room.setMode('talk', 'room_alice');
        publication.asked.length = 0;

        // The first check: not arrived, so the bot lets go and waits the short gap before asking again
        await vi.advanceTimersByTimeAsync(1000);
        expect(publication.asked).toEqual([false]);
        // The "subscribed" of the ask before comes in during that gap
        await vi.advanceTimersByTimeAsync(50);
        arrives();
        await vi.advanceTimersByTimeAsync(200);

        expect(publication.asked).toEqual([false, true]);
    });

    it('stops watching once the microphone arrives', async () => {
        const { room, fake, alice, publication, count } = await inRoom();
        const arrives = () => {
            publication.subscribed = true;
            fake.emit('trackSubscribed', { sid: publication.sid, kind: 1 }, publication, alice);
        };
        room.setPeople([{ participantId: 'room_alice', mode: 'talk' }]);
        arrives();
        room.setMode('off', 'room_alice');
        publication.subscribed = false;
        room.setMode('talk', 'room_alice');
        publication.asked.length = 0;

        await vi.advanceTimersByTimeAsync(500);
        arrives();
        await vi.advanceTimersByTimeAsync(5000);

        expect(publication.asked).toEqual([]);
        expect(count('room_resubscribe_retries')).toBe(0);
    });
});
