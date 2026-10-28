import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom, type ProximityChatMessage } from "../ProximityChatRoom";
import type { SpaceInterface, SpaceUserExtended } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";
import type { RemotePlayersRepository } from "../../../../Phaser/Game/RemotePlayersRepository";

// The front reads its configuration from window.env at import time.
vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

vi.mock("../../../../Phaser/Game/GameManager", () => {
    return {
        gameManager: {
            getCurrentGameScene: () => ({ playSound: () => undefined }),
        },
    };
});

vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => {
    return {
        CharacterLayerManager: {
            wokaBase64(): Promise<string> {
                return Promise.resolve("");
            },
        },
    };
});

vi.mock("../../../../Api/IframeListener", () => {
    return {
        iframeListener: {
            newChatMessageWritingStatusStream: { subscribe: () => ({ unsubscribe: () => undefined }) },
            startListeningToStreamInBubbleStream: { subscribe: () => ({ unsubscribe: () => undefined }) },
            stopListeningToStreamInBubbleStream: { subscribe: () => ({ unsubscribe: () => undefined }) },
            sendLeaveProximityMeetingEvent: () => undefined,
            sendUserInputChat: () => undefined,
        },
    };
});

vi.mock("../../../../WebRtc/AudioStream/ScriptingOutputAudioStreamManager", () => {
    return {
        ScriptingOutputAudioStreamManager: class {
            close(): void {}
        },
    };
});

vi.mock("../../../../WebRtc/AudioStream/ScriptingInputAudioStreamManager", () => {
    return {
        ScriptingInputAudioStreamManager: class {
            close(): void {}
        },
    };
});

type PublicEvent = { sender: string } & Record<string, unknown>;

function createFakeSpace() {
    const publicEvents = new Map<string, Subject<PublicEvent>>();
    const eventSubject = (name: string) => {
        let subject = publicEvents.get(name);
        if (!subject) {
            subject = new Subject<PublicEvent>();
            publicEvents.set(name, subject);
        }
        return subject;
    };
    const space = {
        destroyed: false,
        usersStore: writable(new Map<string, SpaceUserExtended>()),
        observeUserJoined: new Subject<SpaceUserExtended>(),
        observeUserLeft: new Subject<SpaceUserExtended>(),
        onLeaveSpace: new Subject<void>(),
        observePublicEvent: (name: string) => eventSubject(name).asObservable(),
        observePrivateEvent: (name: string) => eventSubject(name).asObservable(),
        emitPublicMessage: vi.fn(),
        getName: () => "bubble",
    };
    const emit = (name: string, event: PublicEvent) => eventSubject(name).next(event);
    return { space, emit };
}

const BOT_ID = "0b7c1d2e-1111-4222-8333-944455556666";
const user = (spaceUserId: string, name: string, uuid: string, tags: string[]) =>
    ({
        spaceUserId,
        name,
        uuid,
        tags,
        pictureStore: readable(undefined),
        reactiveUser: { availabilityStatus: readable(0) },
    } as unknown as SpaceUserExtended);
const nora = user("room_9", "Nora", `bot-${BOT_ID}`, ["bot"]);
const sara = user("room_3", "Sara", "u-sara", []);
const field = (state: string, line: string, stepState = "running") => ({
    v: 1,
    state,
    line,
    startedAt: 1000,
    steps: [{ doing: "Make a song", done: "Make a song", detail: "funk", state: stepState }],
});
const stream = (sender: string, responseId: string, json: string, isFinal = false, finalContent?: string) => ({
    sender,
    spaceStreamMessage: { responseId, token: "", isFinal, finalContent, isError: false, reset: false, steps: json },
});

describe("ProximityChatRoom bot steps line (#1545)", () => {
    let room: ProximityChatRoom;
    let fake: ReturnType<typeof createFakeSpace>;

    beforeEach(async () => {
        fake = createFakeSpace();
        const spaceRegistry = {
            joinSpace: () => Promise.resolve(fake.space as unknown as SpaceInterface),
            leaveSpace: () => Promise.resolve(),
        } as unknown as SpaceRegistryInterface;
        room = new ProximityChatRoom(
            "room_1",
            spaceRegistry,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_9", nora],
                ["room_3", sara],
            ])
        );
    });

    afterEach(() => room.destroy());

    const lines = () => [...room.messages].filter((message) => (message as ProximityChatMessage).steps);
    const emit = (event: ReturnType<typeof stream>) => fake.emit("spaceStreamMessage", event as unknown as PublicEvent);

    it("draws one line that the bot replaces, with nothing to reply to or react on", () => {
        emit(stream("room_9", "s1", JSON.stringify(field("working", "Make a song")), false, "Make a song…"));
        emit(stream("room_9", "s1", JSON.stringify(field("done", "Make a song", "done")), true, "Make a song"));
        const [line] = lines() as ProximityChatMessage[];
        expect(lines()).toHaveLength(1);
        expect(line.steps && get(line.steps)).toMatchObject({ state: "done", line: "Make a song" });
        expect(get(line.content).body).toBe("Make a song");
        expect(get(line.canReply)).toBe(false);
        expect(get(line.canReact)).toBe(false);
    });

    it("counts the line as nothing unread: the answer that follows does", () => {
        emit(stream("room_9", "s1", JSON.stringify(field("working", "Make a song"))));
        expect(get(room.unreadNotificationCount)).toBe(0);
    });

    it("ignores a steps line from a person, or one it can't read", () => {
        emit(stream("room_3", "s1", JSON.stringify(field("working", "Make a song"))));
        emit(stream("room_9", "s2", "{oops"));
        emit(stream("room_9", "s3", JSON.stringify({ ...field("working", "x"), v: 2 })));
        expect(lines()).toEqual([]);
    });

    it("stops a line still working when you leave, so it doesn't spin on", async () => {
        emit(stream("room_9", "s1", JSON.stringify(field("working", "Make a song"))));
        const [line] = lines() as ProximityChatMessage[];
        await room.leaveSpace("bubble", true);
        expect(line.steps && get(line.steps)?.state).toBe("stopped");
    });
});
