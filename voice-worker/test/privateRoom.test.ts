// A reply for one person alone (game #1993), in the bot's LiveKit participant. The bot has one track in the room and
// everyone connected can take it, so the room checks who is connected each time a frame is handed over: such a frame
// goes into the track only while that person is the one other participant, and what the track still holds is dropped
// the moment anyone else connects. The LiveKit SDK is replaced with a room the test fills by hand, and every frame
// that reaches the track is recorded. (test/livekit.test.ts proves the same against a real media server.)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TTS_FRAME_SAMPLES } from '../src/audioFormat.ts';

const rooms: FakeRoom[] = [];
const sources: FakeSource[] = [];

class FakeRoom {
    readonly remoteParticipants = new Map<string, { identity: string; trackPublications: Map<string, never> }>();
    readonly localParticipant = { publishTrack: vi.fn(async () => undefined) };
    private readonly handlers = new Map<string, (...args: unknown[]) => void>();
    constructor() {
        rooms.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void): void {
        this.handlers.set(event, handler);
    }
    async connect(): Promise<void> {}
    async disconnect(): Promise<void> {}
    /** Someone connects to the room, as the media server tells the bot. */
    joins(identity: string): void {
        const participant = { identity, trackPublications: new Map<string, never>() };
        this.remoteParticipants.set(identity, participant);
        this.handlers.get('participantConnected')?.(participant);
    }
    leaves(identity: string): void {
        this.remoteParticipants.delete(identity);
    }
}

class FakeSource {
    captured = 0;
    cleared = 0;
    constructor() {
        sources.push(this);
    }
    async captureFrame(): Promise<void> {
        this.captured++;
    }
    clearQueue(): void {
        this.cleared++;
    }
    async close(): Promise<void> {}
}

vi.mock('@livekit/rtc-node', () => ({
    Room: FakeRoom,
    RoomEvent: { TrackPublished: 'trackPublished', TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed', Disconnected: 'disconnected', ParticipantConnected: 'participantConnected' },
    AudioSource: FakeSource,
    AudioFrame: class {},
    AudioStream: class {},
    LocalAudioTrack: { createAudioTrack: () => ({}) },
    TrackPublishOptions: class {},
    TrackSource: { SOURCE_MICROPHONE: 2 },
    TrackKind: { KIND_AUDIO: 1 },
}));

const { RoomTransport } = await import('../src/roomTransport.ts');

const frame = () => ({ pcm24k: new Int16Array(TTS_FRAME_SAMPLES), opus: () => Buffer.alloc(0) });

async function inRoom(people: string[], named: string[] = people) {
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
    for (const identity of people) fake.joins(identity);
    await room.start();
    room.setPeople(named.map((participantId) => ({ participantId, mode: 'talk' as const })));
    const source = sources[sources.length - 1];
    return { room, fake, source, count: (name: string) => counts.get(name) ?? 0 };
}

beforeEach(() => {
    rooms.length = 0;
    sources.length = 0;
});

describe('who the room reaches', () => {
    it('reaches a person alone only while they are the one other participant connected', async () => {
        const { room, fake } = await inRoom(['room_alice']);
        expect(room.reach('room_alice')).toBe('alone');
        // Someone the bot was told nothing about still hears the bot's track
        fake.joins('room_stranger');
        expect(room.reach('room_alice')).toBe('shared');
        fake.leaves('room_stranger');
        expect(room.reach('room_alice')).toBe('alone');
        // Named in the bubble, but not connected to the room: it reaches them not at all
        fake.leaves('room_alice');
        expect(room.reach('room_alice')).toBe('elsewhere');
    });
});

describe('a frame of a reply for one person alone, handed to the room', () => {
    it('goes into the track while that person is the only one connected', async () => {
        const { room, source } = await inRoom(['room_alice']);
        room.sendFrame(frame(), 'room_alice');
        room.sendFrame(frame(), 'room_alice');
        expect(source.captured).toBe(2);
    });

    it('is dropped, whatever the caller checked, when anyone else is connected: a person, another bot, someone not named', async () => {
        const { room, fake, source, count } = await inRoom(['room_alice', 'room_bob'], ['room_alice']);
        room.sendFrame(frame(), 'room_alice');
        expect(source.captured).toBe(0);
        expect(count('private_frames_refused')).toBe(1);

        // A frame for everyone goes out as before
        room.sendFrame(frame());
        expect(source.captured).toBe(1);

        fake.leaves('room_bob');
        room.sendFrame(frame(), 'room_alice');
        expect(source.captured).toBe(2);
    });

    it('is dropped when that person is not connected, or their own mode does not play', async () => {
        const { room, fake, source } = await inRoom(['room_alice']);
        room.setPeople([{ participantId: 'room_alice', mode: 'speak_and_read' }]);
        room.sendFrame(frame(), 'room_alice');
        expect(source.captured).toBe(0);

        room.setPeople([{ participantId: 'room_alice', mode: 'talk' }]);
        fake.leaves('room_alice');
        room.sendFrame(frame(), 'room_alice');
        expect(source.captured).toBe(0);
    });

    it('has what the track still holds dropped at once when someone else connects', async () => {
        const { room, fake, source, count } = await inRoom(['room_alice']);
        room.sendFrame(frame(), 'room_alice');
        expect(source.cleared).toBe(0);

        fake.joins('room_bob');
        expect(source.cleared).toBe(1);
        expect(count('room_private_cleared')).toBe(1);
        // And nothing more of it goes in
        room.sendFrame(frame(), 'room_alice');
        expect(source.captured).toBe(1);
    });

    it('is left alone when it is that person who connects again', async () => {
        const { room, fake, source } = await inRoom(['room_alice']);
        room.sendFrame(frame(), 'room_alice');
        fake.joins('room_alice');
        expect(source.cleared).toBe(0);
    });

    it('does not drop what is said to everyone when someone connects', async () => {
        const { room, fake, source } = await inRoom(['room_alice']);
        room.sendFrame(frame());
        fake.joins('room_bob');
        expect(source.cleared).toBe(0);
    });

    it('no longer drops anything once the last of it has gone out', async () => {
        vi.useFakeTimers();
        try {
            const { room, fake, source } = await inRoom(['room_alice']);
            room.sendFrame(frame(), 'room_alice');
            await vi.advanceTimersByTimeAsync(2000);
            fake.joins('room_bob');
            expect(source.cleared).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
