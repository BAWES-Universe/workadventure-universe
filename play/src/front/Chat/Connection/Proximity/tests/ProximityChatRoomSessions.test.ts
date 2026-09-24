import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom } from "../ProximityChatRoom";
import type { ProximityChatMessage } from "../ProximityChatRoom";
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
            sendJoinProximityMeetingEvent: () => undefined,
            sendParticipantJoinProximityMeetingEvent: () => undefined,
            sendParticipantLeaveProximityMeetingEvent: () => undefined,
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
        getUsers: () => Promise.resolve(get(space.usersStore)),
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

describe("ProximityChatRoom sessions", () => {
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
        vi.useRealTimers();
        room.destroy();
    });

    const sessions = () => Array.from(get(room.messages)).map((message) => (message as ProximityChatMessage).session);

    it("changes its space generation on every join and leave", async () => {
        const initial = room.spaceGeneration;
        await room.joinSpace("bubble", [], true);
        const joined = room.spaceGeneration;
        expect(joined).not.toBe(initial);
        await room.leaveSpace("bubble", true);
        expect(room.spaceGeneration).not.toBe(joined);
    });

    it("writes a typed start marker naming the meeting area, and an end marker on leave", async () => {
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        // The display name is reset before leaving: the end marker still names the area.
        room.setDisplayName("Proximity Chat");
        await room.leaveSpace("bubble", true);

        expect(sessions()).toEqual([
            { kind: "start", label: "Design room", participants: [] },
            { kind: "end", label: "Design room", participants: [] },
        ]);
    });

    it("writes a start marker naming the people of a bubble", async () => {
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
                ["room_4", spaceUser("room_4", "Omar", "c")],
            ])
        );
        await room.joinSpace("bubble", []);

        const start = sessions().find((session) => session?.kind === "start");
        // The label is formatted with the translations; the names come from the space.
        expect(start?.participants).toEqual(["Sara", "Omar"]);
    });

    it("puts a message that could not be sent back at the end of its own group, never broadcast", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 0)));
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 1)));
        const submittedAt = new Date();
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 2)));
        await room.leaveSpace("bubble", true);
        room.setDisplayName("Other room");
        await room.joinSpace("bubble", [], true);

        room.addNotSentMessage("look at this", ["plan.png"], submittedAt);

        vi.useRealTimers();
        const messages = Array.from(get(room.messages)) as ProximityChatMessage[];
        const kinds = messages.map((message) => (message.notSent ? "notSent" : message.session?.kind));
        expect(kinds).toEqual(["start", "notSent", "end", "start"]);
        const notSent = messages[1];
        expect(get(notSent.content)).toMatchObject({ body: "look at this", fileNames: ["plan.png"] });
        expect(notSent.isMyMessage).toBe(true);
        expect(fake.space.emitPublicMessage).not.toHaveBeenCalled();
    });
});
