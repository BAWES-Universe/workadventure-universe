import { Subject } from "rxjs";
import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom, type ProximityChatMessage } from "../ProximityChatRoom";
import type { SpaceInterface, SpaceUserExtended } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";
import type { RemotePlayersRepository } from "../../../../Phaser/Game/RemotePlayersRepository";
import { blackListManager } from "../../../../WebRtc/BlackListManager";

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
    const events = new Map<string, Subject<PublicEvent>>();
    const eventSubject = (name: string) => {
        let subject = events.get(name);
        if (!subject) {
            subject = new Subject<PublicEvent>();
            events.set(name, subject);
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
const TAVILY = { serverId: "srv-1", name: "Tavily", since: "2026-11-05T09:54:00.000Z", kind: "oauth" };
const ATTIO = { serverId: "srv-2", name: "Attio", since: "2026-11-05T09:55:00.000Z", kind: "key" };
const signIn = (sender: SpaceUserExtended, lost: unknown[], revision = 1, botId = BOT_ID) => ({
    sender,
    spaceName: "bubble",
    botAsk: {
        botId,
        botName: "Nora",
        kind: "signin",
        id: `signin-${botId}`,
        revision,
        body: JSON.stringify({ lost }),
    },
});

describe("ProximityChatRoom tool sign-in card (#1819)", () => {
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
    });

    afterEach(() => room.destroy());

    const cards = () => [...room.messages].filter((message) => (message as ProximityChatMessage).toolSignIn);
    const emit = (event: ReturnType<typeof signIn>) => fake.emit("botAsk", event as unknown as PublicEvent);

    it("shows the bot's card, with nothing to reply to or react on", () => {
        emit(signIn(nora, [TAVILY]));
        const [shown] = cards();
        expect(shown.toolSignIn).toEqual({ botId: BOT_ID, botName: "Nora", lost: [TAVILY] });
        expect(get(shown.canReply)).toBe(false);
        expect(get(shown.canReact)).toBe(false);
    });

    it("keeps one card per bot: a newer one takes the last one's place", () => {
        emit(signIn(nora, [TAVILY], 1));
        emit(signIn(nora, [TAVILY, ATTIO], 2));
        expect(cards().map((message) => message.toolSignIn?.lost.length)).toEqual([2]);
    });

    it("ignores an older word of the bot that arrives late", () => {
        emit(signIn(nora, [TAVILY, ATTIO], 5));
        emit(signIn(nora, [TAVILY], 4));
        expect(cards().map((message) => message.toolSignIn?.lost.length)).toEqual([2]);
    });

    it("takes the card back when the bot says nothing is lost any more", () => {
        emit(signIn(nora, [TAVILY], 1));
        emit(signIn(nora, [], 2));
        expect(cards()).toEqual([]);
        // and a new outage shows a new card
        emit(signIn(nora, [TAVILY], 3));
        expect(cards()).toHaveLength(1);
    });

    it("counts the card as unread, as any message that arrives", () => {
        expect(get(room.unreadNotificationCount)).toBe(0);
        emit(signIn(nora, [TAVILY]));
        expect(get(room.unreadNotificationCount)).toBe(1);
    });

    it("shows nothing from a bot this person blocked", () => {
        blackListManager.blackList(nora.uuid);
        try {
            emit(signIn(nora, [TAVILY]));
            expect(cards()).toEqual([]);
        } finally {
            blackListManager.cancelBlackList(nora.uuid);
        }
    });

    it("ignores a card from a person, or from a bot about another bot", () => {
        const sara = { spaceUserId: "room_3", name: "Sara", uuid: "u-sara", tags: [] } as unknown as SpaceUserExtended;
        emit(signIn(sara, [TAVILY]));
        emit(signIn(nora, [TAVILY], 1, "another-bot"));
        expect(cards()).toEqual([]);
    });

    it("ignores a card whose list is not one", () => {
        fake.emit("botAsk", {
            sender: nora,
            spaceName: "bubble",
            botAsk: { botId: BOT_ID, botName: "Nora", kind: "signin", id: "x", revision: 1, body: "{nope" },
        } as unknown as PublicEvent);
        expect(cards()).toEqual([]);
    });
});
