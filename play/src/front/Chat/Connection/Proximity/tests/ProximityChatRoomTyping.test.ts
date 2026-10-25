import { Subject } from "rxjs";
import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom, TYPING_EXPIRY_MS } from "../ProximityChatRoom";
import { TYPING_STOP_GRACE_MS } from "../../ChatConnection";
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
        emitPublicMessage: vi.fn(),
        getName: () => "bubble",
    };
    const emit = (name: string, event: PublicEvent) => eventSubject(name).next(event);
    return { space, emit };
}

const typing = (sender: string, isTyping: boolean) => ({
    sender,
    spaceIsTyping: { isTyping, characterTextures: [], name: sender },
});

describe("ProximityChatRoom typing indicator", () => {
    let room: ProximityChatRoom;
    let fake: ReturnType<typeof createFakeSpace>;

    beforeEach(async () => {
        vi.useFakeTimers();
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
        // A meeting room chat does not wait for the first users, which keeps the setup small.
        await room.joinSpace("bubble", [], true);
    });

    afterEach(() => {
        room.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const typingIds = () => get(room.typingMembers).map((member) => member.id);

    it("removes the entry on stop even when the members list does not know the sender", () => {
        fake.emit("spaceIsTyping", typing("room_2", true));
        expect(typingIds()).toEqual(["room_2"]);

        // The members list is empty (it lags the events): the stop must still be applied.
        fake.emit("spaceIsTyping", typing("room_2", false));
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS);
        expect(typingIds()).toEqual([]);
    });

    it("keeps the dots a moment after a stop, and a new start in that moment keeps them on (#1379)", () => {
        fake.emit("spaceIsTyping", typing("room_2", true));
        fake.emit("spaceIsTyping", typing("room_2", false));
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS - 1);
        expect(typingIds()).toEqual(["room_2"]);

        fake.emit("spaceIsTyping", typing("room_2", true));
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS);
        expect(typingIds()).toEqual(["room_2"]);
    });

    it("ignores a stop from someone who was not typing", () => {
        fake.emit("spaceIsTyping", typing("room_2", false));
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS);
        expect(typingIds()).toEqual([]);
    });

    it("keeps clones of the same account apart", () => {
        fake.emit("spaceIsTyping", typing("room_2", true));
        fake.emit("spaceIsTyping", typing("room_3", true));
        fake.emit("spaceIsTyping", typing("room_2", false));
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS);
        expect(typingIds()).toEqual(["room_3"]);
    });

    it("expires an entry when no stop arrives, and each typing event refreshes the expiry", () => {
        fake.emit("spaceIsTyping", typing("room_2", true));
        vi.advanceTimersByTime(TYPING_EXPIRY_MS - 1000);
        fake.emit("spaceIsTyping", typing("room_2", true));
        vi.advanceTimersByTime(TYPING_EXPIRY_MS - 1000);
        expect(typingIds()).toEqual(["room_2"]);

        vi.advanceTimersByTime(1000);
        expect(typingIds()).toEqual([]);
    });

    it("clears the sender's entry when their message arrives", () => {
        fake.emit("spaceIsTyping", typing("room_2", true));
        fake.emit("spaceIsTyping", typing("room_3", true));

        fake.emit("spaceMessage", {
            sender: "room_2",
            spaceMessage: { message: "hello", characterTextures: [], name: "room_2" },
        });

        expect(typingIds()).toEqual(["room_3"]);
        expect(get(room.messages).some((message) => get(message.content).body === "hello")).toBe(true);
    });

    it("takes the dots away at once when the message arrives right after the stop", () => {
        // Sending says "stopped" first, then the message comes: the message does not wait for the grace.
        fake.emit("spaceIsTyping", typing("room_2", true));
        fake.emit("spaceIsTyping", typing("room_2", false));
        fake.emit("spaceMessage", {
            sender: "room_2",
            spaceMessage: { message: "sent", characterTextures: [], name: "room_2" },
        });

        expect(typingIds()).toEqual([]);
    });

    it("clears the entries and their timers when the room is destroyed", () => {
        fake.emit("spaceIsTyping", typing("room_2", true));
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        room.destroy();

        expect(typingIds()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("clears the entries and their timers when the bubble is left", async () => {
        fake.emit("spaceIsTyping", typing("room_2", true));

        await room.leaveSpace("bubble", true);

        expect(typingIds()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
