import { Subject } from "rxjs";
import { get, writable } from "svelte/store";
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
        emitPrivateMessage: vi.fn(),
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
const someone = {
    spaceUserId: "room_4",
    name: "Sara",
    uuid: "u-4",
    tags: ["member"],
} as unknown as SpaceUserExtended;

const askField = (revision = 0, answer?: Record<string, unknown>, id = "act-1") =>
    JSON.stringify({
        v: 1,
        kind: "approval",
        id,
        revision,
        title: "Send an email",
        lines: [{ label: "To", text: "Fahad" }],
        options: [
            { id: "approve", label: "Send email" },
            { id: "decline", label: "Don't send" },
        ],
        expiresAt: 1_000_000 + 600_000,
        now: 1_000_000,
        waitMinutes: 10,
        ...(answer ? { answer } : {}),
    });
const botAsk = (sender: SpaceUserExtended, over: Record<string, unknown> = {}) => ({
    sender,
    spaceName: "bubble",
    botAsk: {
        botId: BOT_ID,
        botName: "Nora",
        kind: "card",
        id: "act-1",
        revision: 0,
        body: askField(),
        ...over,
    },
});

describe("ProximityChatRoom card and private replies from a bot (#1658)", () => {
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

    const messages = () => [...room.messages] as ProximityChatMessage[];
    const cards = () => messages().filter((message) => message.ask);
    const replies = () => messages().filter((message) => message.privateReply);
    const emit = (event: ReturnType<typeof botAsk>) => fake.emit("botAsk", event as unknown as PublicEvent);

    it("shows the card as one the person alone has, with nothing to reply to or react on", () => {
        emit(botAsk(nora));
        const [shown] = cards();
        const ask = get(shown.ask!);
        expect(ask).toMatchObject({ id: "act-1", revision: 0, title: "Send an email", private: true });
        expect(ask?.answer).toBeUndefined();
        expect(get(shown.canReply)).toBe(false);
        expect(get(shown.canReact)).toBe(false);
    });

    it("changes the card it showed when the bot sends it again, and keeps one", () => {
        emit(botAsk(nora));
        emit(botAsk(nora, { revision: 1, body: askField(1, { option: "approve" }) }));
        expect(cards()).toHaveLength(1);
        expect(get(cards()[0].ask!)).toMatchObject({ revision: 1, answer: { option: "approve" } });
    });

    it("does not let another bot that uses the same card id change the card or take its taps", async () => {
        const mira = {
            spaceUserId: "room_8",
            name: "Mira",
            uuid: "bot-other",
            tags: ["bot"],
        } as unknown as SpaceUserExtended;
        emit(botAsk(nora));
        emit(botAsk(mira, { botId: "other", botName: "Mira", revision: 1, body: askField(1, { option: "approve" }) }));
        expect(cards()).toHaveLength(1);
        expect(get(cards()[0].ask!)).toMatchObject({ revision: 0 });
        await room.answerBotAsk({ id: "act-1", revision: 0 }, { action: "decide", option: "approve" });
        expect(fake.space.emitPrivateMessage).toHaveBeenCalledWith(expect.anything(), nora.spaceUserId);
    });

    it("ignores an older word about a card that arrives late", () => {
        emit(botAsk(nora, { revision: 2, body: askField(2, { closed: true }) }));
        emit(botAsk(nora, { revision: 1, body: askField(1) }));
        expect(get(cards()[0].ask!)).toMatchObject({ revision: 2, answer: { closed: true } });
    });

    it("takes a card sent again after a reload as the card it is, once", () => {
        emit(botAsk(nora));
        emit(botAsk(nora));
        expect(cards()).toHaveLength(1);
    });

    it("shows a reply only this person needs, once, marked as theirs alone", () => {
        emit(botAsk(nora, { kind: "reply", id: "r-1", revision: 0, body: "Tap Send email on the card to send it." }));
        emit(botAsk(nora, { kind: "reply", id: "r-1", revision: 0, body: "Tap Send email on the card to send it." }));
        expect(replies()).toHaveLength(1);
        expect(get(replies()[0].content).body).toBe("Tap Send email on the card to send it.");
        expect(get(replies()[0].canReact)).toBe(false);
    });

    it("refuses a card from a player, so nobody can put a card on someone else's screen", () => {
        emit(botAsk(someone));
        expect(cards()).toHaveLength(0);
    });

    it("refuses a card a bot sends as another bot", () => {
        emit(botAsk(nora, { botId: "another-bot" }));
        expect(cards()).toHaveLength(0);
    });

    it("refuses a card whose body is not a card", () => {
        emit(botAsk(nora, { body: "not json" }));
        emit(botAsk(nora, { body: JSON.stringify({ v: 1, kind: "other" }) }));
        expect(cards()).toHaveLength(0);
    });

    it("sends a tap to the bot that showed the card, with only the card, its revision and the tap", async () => {
        emit(botAsk(nora));
        await room.answerBotAsk({ id: "act-1", revision: 0 }, { action: "decide", option: "approve" });
        expect(fake.space.emitPrivateMessage).toHaveBeenCalledWith(
            {
                $case: "botAskAnswer",
                botAskAnswer: { askId: "act-1", revision: 0, tap: '{"action":"decide","option":"approve"}' },
            },
            "room_9"
        );
    });

    it("cannot send a tap for a card it never showed", async () => {
        await expect(room.answerBotAsk({ id: "nope", revision: 0 }, { action: "close" })).rejects.toThrow();
        expect(fake.space.emitPrivateMessage).not.toHaveBeenCalled();
    });

    it("does not hand a card that still waits to the next map, where nothing could answer it, but hands one that ended", () => {
        emit(botAsk(nora));
        emit(botAsk(nora, { id: "act-2", body: askField(1, { option: "approve" }, "act-2"), revision: 1 }));
        expect(cards()).toHaveLength(2);
        room.stashHistoryForNextScene();
        const spaceRegistry = {
            joinSpace: () => Promise.resolve(fake.space as unknown as SpaceInterface),
            leaveSpace: () => Promise.resolve(),
        } as unknown as SpaceRegistryInterface;
        const next = new ProximityChatRoom(
            "room_9",
            spaceRegistry,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        const carried = [...next.messages] as ProximityChatMessage[];
        const carriedCards = carried.filter((message) => message.ask);
        expect(carriedCards).toHaveLength(1);
        expect(get(carriedCards[0].ask!)?.answer).toEqual({ option: "approve" });
        next.destroy();
    });

    describe('"Continue privately" on a reply only this person sees (#1993)', () => {
        const noraHere = () =>
            fake.space.usersStore.set(
                new Map([
                    [
                        "room_9",
                        {
                            ...nora,
                            chatID: `@bot_${BOT_ID}:matrix.test`,
                            reactiveUser: { availabilityStatus: writable(0) },
                            pictureStore: writable(undefined),
                        } as unknown as SpaceUserExtended,
                    ],
                ])
            );

        it("tells the bot that wrote it, and nobody else, which direct chat was opened", () => {
            noraHere();
            emit(botAsk(nora, { kind: "reply", id: "p1", revision: 0, body: "It is at 10 on Thursday." }));
            const reply = replies()[0];
            expect(reply.sender?.chatId).toBe(`@bot_${BOT_ID}:matrix.test`);

            room.continuedPrivately(reply, "!dm:matrix.test");

            expect(fake.space.emitPrivateMessage).toHaveBeenCalledTimes(1);
            expect(fake.space.emitPrivateMessage).toHaveBeenCalledWith(
                {
                    $case: "botAskAnswer",
                    botAskAnswer: {
                        askId: `${BOT_ID}-reply-p1`,
                        revision: 0,
                        tap: '{"action":"continue","room":"!dm:matrix.test"}',
                    },
                },
                "room_9"
            );
            expect(fake.space.emitPublicMessage).not.toHaveBeenCalled();
        });

        it("says nothing once the bot has left: the answer reaches that chat with their next message there", () => {
            noraHere();
            emit(botAsk(nora, { kind: "reply", id: "p1", revision: 0, body: "It is at 10 on Thursday." }));
            const reply = replies()[0];
            fake.space.usersStore.set(new Map());

            room.continuedPrivately(reply, "!dm:matrix.test");

            expect(fake.space.emitPrivateMessage).not.toHaveBeenCalled();
        });

        it("says nothing for a reply whose bot this chat never knew", () => {
            emit(botAsk(nora, { kind: "reply", id: "p1", revision: 0, body: "It is at 10 on Thursday." }));
            room.continuedPrivately(replies()[0], "!dm:matrix.test");
            expect(fake.space.emitPrivateMessage).not.toHaveBeenCalled();
        });
    });

    it("counts the card as unread, as any message that arrives", () => {
        expect(get(room.unreadNotificationCount)).toBe(0);
        emit(botAsk(nora));
        expect(get(room.unreadNotificationCount)).toBe(1);
    });
});
