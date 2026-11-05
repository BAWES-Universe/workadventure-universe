// A LiveKit join that finishes after the worker let go of the room is closed at once (Sentry finding on #1718).
// The LiveKit SDK is replaced with a room whose join the test finishes by hand.
import { describe, expect, it, vi } from 'vitest';

const rooms: FakeRoom[] = [];

class FakeRoom {
    finishJoin!: () => void;
    failJoin!: (e: Error) => void;
    joined = false;
    disconnects = 0;
    readonly remoteParticipants = new Map();
    readonly localParticipant = { publishTrack: vi.fn(async () => undefined) };
    constructor() {
        rooms.push(this);
    }
    on(): void {}
    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.finishJoin = () => {
                this.joined = true;
                resolve();
            };
            this.failJoin = reject;
        });
    }
    async disconnect(): Promise<void> {
        this.disconnects += 1;
        // Like the SDK: closing a room that is not connected yet does nothing
        if (this.joined) this.joined = false;
    }
}

vi.mock('@livekit/rtc-node', () => ({
    Room: FakeRoom,
    RoomEvent: { TrackPublished: 'p', TrackSubscribed: 's', TrackUnsubscribed: 'u', Disconnected: 'd' },
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

function transport() {
    const deps = {
        counters: { inc: vi.fn() },
        input: { push: vi.fn() },
        onGone: vi.fn(),
        onConnected: vi.fn(),
        voiceActive: () => true,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const room = new RoomTransport(1, 'ws://x', 'token', deps as any);
    return { room, deps, fake: rooms[rooms.length - 1] };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('a join that finishes after the room was let go', () => {
    it('is closed when stop() ran while joining', async () => {
        const { room, deps, fake } = transport();
        const started = room.start();
        await room.stop();
        fake.finishJoin();
        await started;
        await tick();
        expect(fake.joined).toBe(false);
        expect(room.connected).toBe(false);
        expect(deps.onConnected).not.toHaveBeenCalled();
        expect(fake.localParticipant.publishTrack).not.toHaveBeenCalled();
    });

    it('is closed when the join timed out first', async () => {
        vi.useFakeTimers();
        try {
            const { room, fake } = transport();
            const started = room.start();
            const failed = expect(started).rejects.toThrow('connect timed out');
            await vi.advanceTimersByTimeAsync(60_000);
            await failed;
            // The session drops the room after a failed start
            await room.stop();
            fake.finishJoin();
            await vi.advanceTimersByTimeAsync(0);
            expect(fake.joined).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('still connects normally when nothing let go of it', async () => {
        const { room, deps, fake } = transport();
        const started = room.start();
        fake.finishJoin();
        await started;
        expect(fake.joined).toBe(true);
        expect(room.connected).toBe(true);
        expect(deps.onConnected).toHaveBeenCalledOnce();
    });
});
