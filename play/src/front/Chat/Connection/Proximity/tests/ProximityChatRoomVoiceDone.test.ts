import { Subject } from "rxjs";
import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom } from "../ProximityChatRoom";
import type { SpaceInterface, SpaceUserExtended } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";
import type { RemotePlayersRepository } from "../../../../Phaser/Game/RemotePlayersRepository";
import { blackListManager } from "../../../../WebRtc/BlackListManager";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import { botFeeling, forgetBotFeelings } from "../../../Bots/BotMood";

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
const nora = {
    spaceUserId: "room_9",
    name: "Nora",
    uuid: `bot-${BOT_ID}`,
    tags: ["bot"],
} as unknown as SpaceUserExtended;
const done = (sender: SpaceUserExtended, botId = BOT_ID) => ({
    sender,
    spaceName: "bubble",
    botVoiceDone: { botId, botName: "Nora" },
});

describe("ProximityChatRoom: a voice bot stopped listening because the person said they are done (#1670)", () => {
    let room: ProximityChatRoom;
    let fake: ReturnType<typeof createFakeSpace>;

    beforeEach(async () => {
        loadLocale("en-US");
        setLocale("en-US");
        fake = createFakeSpace();
        fake.space.usersStore.set(new Map([[nora.spaceUserId, nora]]));
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
    });

    afterEach(() => {
        room.destroy();
        forgetBotFeelings();
    });

    const lines = () => [...room.messages].map((message) => get(message.content).body);
    const emit = (event: ReturnType<typeof done>) => fake.emit("botVoiceDone", event as unknown as PublicEvent);

    it("tells the person, in their own chat, to use the bot's name to talk again", () => {
        emit(done(nora));
        expect(lines()).toContain("Done talking with Nora. Use its name to talk again.");
    });

    it("shows nothing from a bot this person blocked, from a person, or from a bot about another bot", () => {
        const sara = { spaceUserId: "room_3", name: "Sara", uuid: "u-sara", tags: [] } as unknown as SpaceUserExtended;
        emit(done(sara));
        emit(done(nora, "another-bot"));
        blackListManager.blackList(nora.uuid);
        try {
            emit(done(nora));
        } finally {
            blackListManager.cancelBlackList(nora.uuid);
        }
        expect(lines().filter((line) => line?.startsWith("Done talking"))).toEqual([]);
    });

    it("draws the wave on the bot's box from a final reply that has no words", () => {
        fake.emit("spaceStreamMessage", {
            sender: nora.spaceUserId,
            spaceStreamMessage: {
                responseId: "r1",
                token: "",
                isFinal: true,
                finalContent: "",
                isError: false,
                reset: false,
                mood: "👋",
            },
        } as unknown as PublicEvent);
        expect(get(botFeeling(nora.spaceUserId))?.mood).toBe("👋");
    });

    it("still ignores an empty final that carries no wave", () => {
        fake.emit("spaceStreamMessage", {
            sender: nora.spaceUserId,
            spaceStreamMessage: {
                responseId: "r2",
                token: "",
                isFinal: true,
                finalContent: "",
                isError: false,
                reset: false,
                mood: "🙂",
            },
        } as unknown as PublicEvent);
        expect(get(botFeeling(nora.spaceUserId))).toBeUndefined();
    });
});
