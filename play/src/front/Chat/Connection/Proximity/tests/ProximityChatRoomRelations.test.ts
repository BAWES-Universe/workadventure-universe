import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom } from "../ProximityChatRoom";
import type { ProximityChatMessage } from "../ProximityChatRoom";
import { selectedChatMessageToReply } from "../../../Stores/ChatStore";
import { isUsableReaction, isUsableSharedId, QUOTE_MAX_LENGTH } from "../ProximityMessageRelations";
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

describe("Nearby chat reactions and replies", () => {
    let room: ProximityChatRoom;
    let fake: ReturnType<typeof createFakeSpace>;
    const SARA_MESSAGE_ID = "2f1c7a52-9b1e-4c55-a1f0-7d3a2b9c0e11";

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
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
                ["room_4", spaceUser("room_4", "Omar", "c")],
            ])
        );
        await room.joinSpace("bubble", []);
    });

    afterEach(() => {
        selectedChatMessageToReply.set(null);
        room.destroy();
    });

    const conversation = () =>
        Array.from(get(room.messages)).filter(
            (message) => !(message as ProximityChatMessage).session
        ) as ProximityChatMessage[];
    const last = () => conversation()[conversation().length - 1];
    const sentEvents = (kind: string) =>
        fake.space.emitPublicMessage.mock.calls.map(([event]) => event).filter((event) => event.$case === kind);

    it("sends its own id with a message, and keeps the sender's id on a received one", () => {
        room.sendMessage("hello");
        const sent = sentEvents("spaceMessage")[0].spaceMessage;
        expect(sent.id).toBe(last().id);
        expect(get(last().canReact)).toBe(true);

        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: { message: "hi", name: "Sara", id: SARA_MESSAGE_ID },
        });
        expect(last().id).toBe(SARA_MESSAGE_ID);
        expect(get(last().canReact)).toBe(true);
        expect(get(last().canReply)).toBe(true);
    });

    it("shows a message sent twice once, but still shows someone else's message that reuses its id", () => {
        const sara = { sender: "room_3", spaceMessage: { message: "hi", name: "Sara", id: SARA_MESSAGE_ID } };
        fake.emit("spaceMessage", sara);
        fake.emit("spaceMessage", sara);
        expect(conversation()).toHaveLength(1);

        fake.emit("spaceMessage", {
            sender: "room_4",
            spaceMessage: { message: "fake", name: "Omar", id: SARA_MESSAGE_ID },
        });
        expect(conversation()).toHaveLength(2);
        expect(conversation()[0].id).toBe(SARA_MESSAGE_ID);
        expect(get(conversation()[0].content).body).toBe("hi");
        expect(last().id).not.toBe(SARA_MESSAGE_ID);
        expect(get(last().canReact)).toBe(false);
    });

    it("stops taking reactions on messages carried to the next map, but keeps their reactions and replies", async () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: { message: "hi", name: "Sara", id: SARA_MESSAGE_ID },
        });
        await last().addReaction("👍");
        room.stashHistoryForNextScene();

        const nextMap = new ProximityChatRoom(
            "room_1",
            { joinSpace: vi.fn(), leaveSpace: vi.fn() } as unknown as SpaceRegistryInterface,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        try {
            const carried = Array.from(get(nextMap.messages)).find((message) => message.id === SARA_MESSAGE_ID);
            expect(carried).toBeDefined();
            expect(get(carried!.canReact)).toBe(false);
            expect(get(carried!.canReply)).toBe(true);
            expect(carried!.reactions.get("👍")).toBeDefined();

            const sentBefore = sentEvents("spaceMessageReaction").length;
            await carried!.addReaction("🎉");
            expect(sentEvents("spaceMessageReaction")).toHaveLength(sentBefore);
            expect(carried!.reactions.get("🎉")).toBeUndefined();
            // Tapping the reaction already on it doesn't take it back either.
            carried!.reactions.get("👍")!.react();
            expect(sentEvents("spaceMessageReaction")).toHaveLength(sentBefore);
            expect(carried!.reactions.get("👍")).toBeDefined();
        } finally {
            nextMap.destroy();
        }
    });

    it("takes no reactions on a message that came without a usable id (bots, older games)", () => {
        fake.emit("spaceMessage", { sender: "room_3", spaceMessage: { message: "beep", name: "Bot" } });
        expect(get(last().canReact)).toBe(false);
        expect(get(last().canReply)).toBe(true);
    });

    it("shows a reaction from someone else on the message it points at", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: { message: "hi", name: "Sara", id: SARA_MESSAGE_ID },
        });
        fake.emit("spaceMessageReaction", {
            sender: "room_4",
            spaceMessageReaction: { messageId: SARA_MESSAGE_ID, reaction: "🎉", add: true, name: "Omar" },
        });
        const reaction = last().reactions.get("🎉");
        expect(reaction?.users.get("room_4")?.username).toBe("Omar");
        expect(get(reaction!.reacted)).toBe(false);

        fake.emit("spaceMessageReaction", {
            sender: "room_4",
            spaceMessageReaction: { messageId: SARA_MESSAGE_ID, reaction: "🎉", add: false },
        });
        expect(last().reactions.has("🎉")).toBe(false);
    });

    it("toggles your own reaction here and sends each change to the others", async () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: { message: "hi", name: "Sara", id: SARA_MESSAGE_ID },
        });
        const message = last();
        await message.addReaction("👍");
        expect(get(message.reactions.get("👍")!.reacted)).toBe(true);
        // Tapping the chip takes it back.
        message.reactions.get("👍")!.react();
        expect(message.reactions.has("👍")).toBe(false);
        expect(sentEvents("spaceMessageReaction").map((event) => event.spaceMessageReaction)).toEqual([
            { messageId: SARA_MESSAGE_ID, reaction: "👍", add: true },
            { messageId: SARA_MESSAGE_ID, reaction: "👍", add: false },
        ]);
    });

    it("ignores reactions that aren't an emoji or point at no message", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: { message: "hi", name: "Sara", id: SARA_MESSAGE_ID },
        });
        fake.emit("spaceMessageReaction", {
            sender: "room_4",
            spaceMessageReaction: { messageId: SARA_MESSAGE_ID, reaction: "<img src=x>", add: true },
        });
        fake.emit("spaceMessageReaction", {
            sender: "room_4",
            spaceMessageReaction: { messageId: "unknown-message-id", reaction: "👍", add: true },
        });
        expect(last().reactions.size).toBe(0);
    });

    it("sends a reply with a short quote of the original and stops replying", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: { message: "x".repeat(1000), name: "Sara", id: SARA_MESSAGE_ID },
        });
        const original = last();
        selectedChatMessageToReply.set(original);
        room.sendMessage("Agreed");

        expect(last().quotedMessage).toBe(original);
        expect(get(selectedChatMessageToReply)).toBeNull();
        const replyTo = sentEvents("spaceMessage")[0].spaceMessage.replyTo;
        expect(replyTo).toMatchObject({ id: SARA_MESSAGE_ID, senderUserId: "room_3", name: "Sara" });
        expect(replyTo.message.length).toBe(QUOTE_MAX_LENGTH);
    });

    it("leaves a reply picked in another chat alone", () => {
        const elsewhere = { id: "matrix-event" } as unknown as ProximityChatMessage;
        selectedChatMessageToReply.set(elsewhere);
        room.sendMessage("hello");
        expect(sentEvents("spaceMessage")[0].spaceMessage.replyTo).toBeUndefined();
        expect(get(selectedChatMessageToReply)).toBe(elsewhere);
    });

    it("quotes our own copy of the original when we have it, else what the reply carries", () => {
        room.sendMessage("Meeting at 3");
        const mine = last();
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: {
                message: "On my way",
                name: "Sara",
                id: SARA_MESSAGE_ID,
                replyTo: {
                    id: mine.id,
                    senderUserId: "room_1",
                    name: "Me",
                    message: "Meeting at 3",
                    galleryUrls: [],
                    fileNames: [],
                },
            },
        });
        expect(last().quotedMessage).toBe(mine);

        fake.emit("spaceMessage", {
            sender: "room_4",
            spaceMessage: {
                message: "Nice",
                name: "Omar",
                id: "8a6b1f3e-0c2d-4e5f-9a8b-7c6d5e4f3a21",
                replyTo: {
                    id: "c0ffee00-1111-2222-3333-444455556666",
                    senderUserId: "room_3",
                    name: "Sara",
                    message: "",
                    url: "https://cdn.example/a.png",
                    galleryUrls: ["https://cdn.example/b.png"],
                    fileNames: [],
                },
            },
        });
        const quote = last().quotedMessage!;
        expect(quote.isQuotedMessage).toBe(true);
        expect(quote.type).toBe("gallery");
        expect(quote.sender?.username).toBe("Sara");
        expect(get(quote.canReact)).toBe(false);
        expect(get(quote.canReply)).toBe(false);
    });
});

describe("nearby chat relation checks", () => {
    it("accepts uuids as shared ids and nothing odd", () => {
        expect(isUsableSharedId("2f1c7a52-9b1e-4c55-a1f0-7d3a2b9c0e11")).toBe(true);
        expect(isUsableSharedId("")).toBe(false);
        expect(isUsableSharedId("a b")).toBe(false);
        expect(isUsableSharedId(undefined)).toBe(false);
    });

    it("accepts emoji, with skin tones, flags and keycaps, and rejects text", () => {
        for (const emoji of ["👍", "👍🏽", "❤️", "👨‍👩‍👧", "🇸🇦", "1️⃣"]) expect(isUsableReaction(emoji)).toBe(true);
        for (const text of ["", "lol", "👍 nice", "<b>", "x".repeat(40)]) expect(isUsableReaction(text)).toBe(false);
    });
});
