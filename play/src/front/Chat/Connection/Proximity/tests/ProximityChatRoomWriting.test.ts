import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_WRITING_EXPIRY_MS, ProximityChatRoom } from "../ProximityChatRoom";
import { TYPING_STOP_GRACE_MS } from "../../ChatConnection";
import { botFeeling, forgetBotFeelings } from "../../../Bots/BotMood";
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
const field = (state: string, kind: string, stepState = "running") => ({
    v: 1,
    state,
    line: "Searching",
    startedAt: 1000,
    steps: [{ doing: "Searching", done: "Searched", state: stepState, kind }],
});

describe("ProximityChatRoom pen beside a bot's Woka while it writes", () => {
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
        await room.joinSpace("bubble", [], true);
        fake.space.usersStore.set(
            new Map([
                ["room_9", nora],
                ["room_3", sara],
            ])
        );
    });

    afterEach(() => {
        room.destroy();
        forgetBotFeelings();
        vi.useRealTimers();
    });

    const work = (id: string) => get(botFeeling(id))?.work;
    const typing = (sender: string, isTyping: boolean) =>
        fake.emit("spaceIsTyping", {
            sender,
            spaceIsTyping: { isTyping, characterTextures: [], name: "x" },
        } as unknown as PublicEvent);
    const words = (sender: string, isFinal = false, token = "Hel") =>
        fake.emit("spaceStreamMessage", {
            sender,
            spaceStreamMessage: {
                responseId: "r1",
                token,
                isFinal,
                finalContent: isFinal ? "Hello" : undefined,
                isError: false,
                reset: false,
            },
        } as unknown as PublicEvent);
    const steps = (sender: string, json: object, isFinal = false) =>
        fake.emit("spaceStreamMessage", {
            sender,
            spaceStreamMessage: {
                responseId: "s1",
                token: "",
                isFinal,
                isError: false,
                reset: false,
                steps: JSON.stringify(json),
            },
        } as unknown as PublicEvent);

    it("shows the pen while the bot types, and lets it go once it stopped", () => {
        typing("room_9", true);
        expect(work("room_9")).toBe("write");
        typing("room_9", false);
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS + 1);
        expect(work("room_9")).toBeUndefined();
    });

    it("keeps the pen while the reply words keep coming, past the typing dots, and ends it with the last one", () => {
        typing("room_9", true);
        words("room_9");
        // The typing entry runs out on its own, the words still come
        vi.advanceTimersByTime(12000 + 1);
        words("room_9", false, "lo");
        expect(work("room_9")).toBe("write");
        words("room_9", true);
        expect(work("room_9")).toBeUndefined();
    });

    it("lets the pen go when the words stop without a last one, so it can't stay for good", () => {
        words("room_9");
        expect(work("room_9")).toBe("write");
        vi.advanceTimersByTime(BOT_WRITING_EXPIRY_MS + 1);
        expect(work("room_9")).toBeUndefined();
    });

    it("lets a running tool step name the work, and falls back to the pen between steps", () => {
        typing("room_9", true);
        steps("room_9", field("working", "search"));
        expect(work("room_9")).toBe("search");
        steps("room_9", field("working", "search", "done"));
        expect(work("room_9")).toBe("write");
        steps("room_9", field("done", "search", "done"), true);
        typing("room_9", false);
        vi.advanceTimersByTime(TYPING_STOP_GRACE_MS + 1);
        expect(work("room_9")).toBeUndefined();
    });

    it("shows nothing beside a person who types or writes", () => {
        typing("room_3", true);
        words("room_3");
        expect(get(botFeeling("room_3"))).toBeUndefined();
    });

    it("takes the pen away with the bot when it leaves, or when you leave", async () => {
        words("room_9");
        fake.space.observeUserLeft.next(nora);
        expect(work("room_9")).toBeUndefined();
        words("room_9");
        await room.leaveSpace("bubble", true);
        expect(work("room_9")).toBeUndefined();
    });
});
