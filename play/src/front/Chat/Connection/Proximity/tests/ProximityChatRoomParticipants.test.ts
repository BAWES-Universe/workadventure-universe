import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterType } from "@workadventure/messages";
import { ProximityChatRoom } from "../ProximityChatRoom";
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

// Joining a bubble with someone shows a notification: keep it out of the test environment.
vi.mock("../../../../Notification/NotificationManager", () => {
    return {
        notificationManager: {
            createNotification: () => undefined,
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
        emitPublicMessage: vi.fn(),
        getName: () => "bubble",
    };
    const emit = (name: string, event: PublicEvent) => eventSubject(name).next(event);
    return { space, emit };
}

function spaceUser(spaceUserId: string, name: string, uuid: string): SpaceUserExtended {
    return {
        spaceUserId,
        name,
        uuid,
        tags: [],
        pictureStore: readable(undefined),
        reactiveUser: { availabilityStatus: readable(0) },
    } as unknown as SpaceUserExtended;
}

describe("ProximityChatRoom participants", () => {
    let room: ProximityChatRoom;
    let fake: ReturnType<typeof createFakeSpace>;

    beforeEach(() => {
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
    });

    afterEach(() => {
        room.destroy();
    });

    const participantIds = () => get(room.participants).map((participant) => participant.id);

    it("starts alone, with no space", () => {
        expect(get(room.spaceKind)).toBe("none");
        expect(participantIds()).toEqual([]);
        expect(get(room.spaceJoinedAt)).toBeUndefined();
    });

    it("lists everyone but this tab's own avatar, including other tabs of the same account", async () => {
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "account-a")],
                // Another tab of the same account: a clone, which must show as a participant.
                ["room_2", spaceUser("room_2", "Me", "account-a")],
                ["room_3", spaceUser("room_3", "Sara", "account-b")],
            ])
        );

        expect(get(room.spaceKind)).toBe("meeting");
        expect(participantIds()).toEqual(["room_2", "room_3"]);
        expect(get(room.participants).map((participant) => participant.name)).toEqual(["Me", "Sara"]);
        expect(get(room.spaceJoinedAt)).toBeTypeOf("number");
    });

    it("updates as people join and leave", async () => {
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(new Map([["room_1", spaceUser("room_1", "Me", "a")]]));
        expect(participantIds()).toEqual([]);

        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_4", spaceUser("room_4", "Omar", "c")],
            ])
        );
        expect(participantIds()).toEqual(["room_4"]);
    });

    it("marks a speaker or listener zone as a stream, where only streaming people are listed", async () => {
        await room.joinSpace("bubble", [], true, FilterType.LIVE_STREAMING_USERS);
        expect(get(room.spaceKind)).toBe("stream");
    });

    it("clears the participants when the space is left", async () => {
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );

        await room.leaveSpace("bubble", true);

        expect(participantIds()).toEqual([]);
        expect(get(room.spaceKind)).toBe("none");
        expect(get(room.spaceJoinedAt)).toBeUndefined();
        // The timeline is kept: leaving adds a marker, it removes nothing.
        expect(get(room.messages).length).toBeGreaterThan(0);
    });
});
