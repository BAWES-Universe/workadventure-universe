import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom } from "../ProximityChatRoom";
import type { ProximityChatMessage } from "../ProximityChatRoom";
import { listableSessions } from "../ProximitySessions";
import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
import { selectedProximitySessionStore } from "../../../Stores/ProximitySessionStore";
import type { ChatRoom } from "../../ChatConnection";
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

        expect(sessions()).toMatchObject([
            { kind: "start", label: "Design room", participants: [], isArea: true },
            { kind: "end", label: "Design room", participants: [], isArea: true },
        ]);
        // Both markers of one stay share its id.
        const [start, end] = sessions();
        expect(start?.sessionId).toBeDefined();
        expect(end?.sessionId).toBe(start?.sessionId);
    });

    it("closes a stay with an end marker even when you were alone in the meeting", async () => {
        room.setDisplayName("Quiet room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(new Map([["room_1", spaceUser("room_1", "Me", "a")]]));
        await room.leaveSpace("bubble", true);

        expect(sessions().map((session) => session?.kind)).toEqual(["start", "end"]);
    });

    it("records the space user ids of the people in a bubble, so they can be found again", async () => {
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        await room.joinSpace("bubble", []);
        const start = sessions().find((session) => session?.kind === "start");
        expect(start?.participantIds).toEqual(["room_3"]);
        expect(start?.isArea).toBe(false);
    });

    it("gives each stay a new id: leaving and coming back is another stay", async () => {
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        const first = room.currentSessionId;
        await room.leaveSpace("bubble", true);
        expect(room.currentSessionId).toBeUndefined();
        await room.joinSpace("bubble", [], true);
        expect(room.currentSessionId).toBeDefined();
        expect(room.currentSessionId).not.toBe(first);
    });

    it("keeps unread per stay: what you didn't read in an ended stay stays unread", async () => {
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        const first = room.currentSessionId ?? "";
        // Joining opened the chat; read something else instead (a message arriving with nothing open opens the chat).
        const otherRoom = { id: "other", isEncrypted: readable(false) } as unknown as ChatRoom;
        selectedRoomStore.set(otherRoom);
        fake.emit("spaceMessage", { sender: "room_3", spaceMessage: { message: "hello", name: "Sara" } });
        expect(get(room.unreadBySession).get(first)).toBe(1);
        expect(get(room.unreadNotificationCount)).toBe(1);

        await room.leaveSpace("bubble", true);
        await room.joinSpace("bubble", [], true);
        // Starting another stay neither clears nor moves it.
        expect(get(room.unreadBySession).get(first)).toBe(1);
        const second = room.currentSessionId ?? "";
        selectedRoomStore.set(otherRoom);
        fake.emit("spaceMessage", { sender: "room_3", spaceMessage: { message: "again", name: "Sara" } });
        expect(get(room.unreadNotificationCount)).toBe(2);

        // Reading the second stay leaves the first one unread.
        room.open(second);
        expect(get(room.unreadBySession).get(second)).toBeUndefined();
        expect(get(room.unreadBySession).get(first)).toBe(1);
        expect(get(room.unreadNotificationCount)).toBe(1);
        room.open(first);
        expect(get(room.unreadNotificationCount)).toBe(0);
    });

    it("shows where a script message lands: the live stay, or the whole timeline when alone", async () => {
        // Alone, with an older stay left selected: the whole timeline (with its composer), not that stay.
        selectedProximitySessionStore.set("an-old-stay");
        room.showLatest();
        expect(get(selectedRoomStore)).toBe(room);
        expect(get(selectedProximitySessionStore)).toBeUndefined();

        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        selectedProximitySessionStore.set("an-old-stay");
        room.showLatest();
        expect(get(selectedProximitySessionStore)).toBe(room.currentSessionId);
    });

    it("splits the timeline into stays, and only stays with real messages make a row", async () => {
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        await room.leaveSpace("bubble", true);
        room.setDisplayName("Other room");
        await room.joinSpace("bubble", [], true);
        fake.emit("spaceMessage", { sender: "room_3", spaceMessage: { message: "hello", name: "Sara" } });
        await room.leaveSpace("bubble", true);

        const all = get(room.sessions);
        expect(all.map((session) => session.label)).toEqual(["Design room", "Other room"]);
        expect(all.every((session) => !session.isLive)).toBe(true);
        expect(listableSessions(all).map((session) => session.label)).toEqual(["Other room"]);
    });

    it("closes the open stay before handing the timeline to the next map", async () => {
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        fake.emit("spaceMessage", { sender: "room_3", spaceMessage: { message: "hello", name: "Sara" } });
        const stayId = room.currentSessionId;
        room.stashHistoryForNextScene();

        expect(room.currentSessionId).toBeUndefined();
        const next = new ProximityChatRoom(
            "room_9",
            {
                joinSpace: () => Promise.resolve(fake.space),
                leaveSpace: () => Promise.resolve(),
            } as unknown as SpaceRegistryInterface,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        const carried = get(next.sessions);
        expect(carried.map((session) => session.id)).toEqual([stayId]);
        expect(carried[0].isLive).toBe(false);
        expect(carried[0].endedAt).toBeDefined();
        next.destroy();
    });

    it("marks a bot reply still streaming as stopped when you leave, in its own stay", async () => {
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Bot", "b")],
            ])
        );
        fake.emit("spaceStreamMessage", {
            sender: "room_3",
            spaceStreamMessage: { responseId: "r1", token: "Once upon", isFinal: false, reset: false, isError: false },
        });
        await room.leaveSpace("bubble", true);
        room.setDisplayName("Other room");
        await room.joinSpace("bubble", [], true);

        const all = get(room.sessions);
        const first = all[0];
        expect(first.messages).toHaveLength(1);
        expect((first.messages[0] as ProximityChatMessage).stoppedOnLeave).toBe(true);
        expect(all[1].messages).toHaveLength(0);
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

    it("inserts a message that could not be sent in one update, with no intermediate state", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 0)));
        room.setDisplayName("Design room");
        await room.joinSpace("bubble", [], true);
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 1)));
        const submittedAt = new Date();
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 24, 10, 2)));
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        await room.leaveSpace("bubble", true);
        vi.useRealTimers();

        const seenLengths: number[] = [];
        const unsubscribe = room.messages.subscribe((messages) => seenLengths.push(messages.length));
        room.addNotSentMessage("hello", [], submittedAt);
        unsubscribe();

        // The initial value on subscribe, then exactly one update with the message in place.
        expect(seenLengths).toEqual([2, 3]);
        const kinds = (Array.from(get(room.messages)) as ProximityChatMessage[]).map((message) =>
            message.notSent ? "notSent" : message.session?.kind
        );
        expect(kinds).toEqual(["start", "notSent", "end"]);
    });

    it("says when a space is being joined but not connected yet", async () => {
        let resolveJoin: (space: SpaceInterface) => void = () => undefined;
        const slowRegistry = {
            joinSpace: () =>
                new Promise<SpaceInterface>((resolve) => {
                    resolveJoin = resolve;
                }),
            leaveSpace: () => Promise.resolve(),
        } as unknown as SpaceRegistryInterface;
        const slowRoom = new ProximityChatRoom(
            "room_1",
            slowRegistry,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        expect(slowRoom.isJoiningSpace).toBe(false);

        const joining = slowRoom.joinSpace("bubble", [], true);
        expect(slowRoom.isJoiningSpace).toBe(true);

        resolveJoin(fake.space as unknown as SpaceInterface);
        await joining;
        expect(slowRoom.isJoiningSpace).toBe(false);
        slowRoom.destroy();
    });
});
