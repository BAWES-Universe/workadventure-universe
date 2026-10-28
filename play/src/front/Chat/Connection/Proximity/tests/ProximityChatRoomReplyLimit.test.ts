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
const card = (sender: SpaceUserExtended, botId = BOT_ID, resetsAt = "2026-10-27T20:20:00.000Z") => ({
    sender,
    spaceName: "bubble",
    botReplyLimit: { limit: "universe-ai", resetsAt, who: "member", botId, botName: "Nora" },
});

describe("ProximityChatRoom reply limit card (#1159)", () => {
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

    const cards = () => [...room.messages].filter((message) => (message as ProximityChatMessage).replyLimit);
    const emit = (event: ReturnType<typeof card>) => fake.emit("botReplyLimit", event as unknown as PublicEvent);

    it("shows the bot's card, with nothing to reply to or react on", () => {
        emit(card(nora));
        const [shown] = cards();
        expect(shown.replyLimit).toEqual({
            limit: "universe-ai",
            resetsAt: "2026-10-27T20:20:00.000Z",
            who: "member",
            botId: BOT_ID,
            botName: "Nora",
        });
        expect(get(shown.canReply)).toBe(false);
        expect(get(shown.canReact)).toBe(false);
    });

    it("keeps one card per bot: a newer one takes the last one's place", () => {
        emit(card(nora));
        emit(card(nora, BOT_ID, "2026-10-27T21:00:00.000Z"));
        expect(cards().map((message) => message.replyLimit?.resetsAt)).toEqual(["2026-10-27T21:00:00.000Z"]);
    });

    it("counts the card as unread, as any message that arrives (CodeRabbit on #1524)", () => {
        expect(get(room.unreadNotificationCount)).toBe(0);
        emit(card(nora));
        expect(get(room.unreadNotificationCount)).toBe(1);
        expect(get(room.hasUnreadMessages)).toBe(true);
    });

    it("shows nothing from a bot this person blocked (CodeRabbit on #1524)", () => {
        blackListManager.blackList(nora.uuid);
        try {
            emit(card(nora));
            expect(cards()).toEqual([]);
            expect(get(room.unreadNotificationCount)).toBe(0);
        } finally {
            blackListManager.cancelBlackList(nora.uuid);
        }
    });

    it("ignores a card from a person, or from a bot about another bot", () => {
        const sara = { spaceUserId: "room_3", name: "Sara", uuid: "u-sara", tags: [] } as unknown as SpaceUserExtended;
        emit(card(sara));
        emit(card(nora, "another-bot"));
        expect(cards()).toEqual([]);
    });
});
