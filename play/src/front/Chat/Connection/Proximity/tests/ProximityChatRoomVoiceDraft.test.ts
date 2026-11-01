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
const sara = { spaceUserId: "room_3", name: "Sara", uuid: "u-sara", tags: [] } as unknown as SpaceUserExtended;
const hears = (state: string, text: string, turnId = "1-1", sender = nora, botId = BOT_ID) => ({
    sender,
    spaceName: "bubble",
    botVoiceDraft: { botId, botName: "Nora", turnId, state, text, reason: "" },
});

describe("ProximityChatRoom: what a voice bot hears this person say (#1664)", () => {
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

    const emit = (event: ReturnType<typeof hears>) => fake.emit("botVoiceDraft", event as unknown as PublicEvent);
    const drafts = () => get(room.voiceDrafts);
    /** What went out to the others in the bubble as a chat line. */
    const sent = () =>
        fake.space.emitPublicMessage.mock.calls
            .map(([event]) => event)
            .filter((event) => event.$case === "spaceMessage")
            .map((event) => event.spaceMessage);
    // The chat's own markers (someone joining, a divider) are not lines
    const lines = () =>
        ([...room.messages] as ProximityChatMessage[]).filter(
            (message) => message.session === undefined && message.type === "proximity"
        );

    it("shows their words as a live draft that fills in place, and sends nothing while they talk", () => {
        emit(hears("live", "Actually which"));
        emit(hears("live", "Actually which of them"));
        expect(drafts()).toEqual([
            { botId: BOT_ID, botName: "Nora", turnId: "1-1", state: "live", text: "Actually which of them" },
        ]);
        expect(sent()).toEqual([]);
        expect(lines()).toEqual([]);
    });

    it("sends one normal line from them, with the bot and the turn named, when every word came through", () => {
        emit(hears("live", "Actually which"));
        emit(hears("final", "Actually which of them replied this week"));
        expect(drafts()).toEqual([]);
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({
            message: "Actually which of them replied this week",
            spoken: { botId: BOT_ID, turnId: "1-1" },
        });
        // It is their own line in their chat, with the mic mark
        expect(lines()).toHaveLength(1);
        expect(lines()[0].isMyMessage).toBe(true);
        expect(lines()[0].spoken).toBe(true);
        expect(get(lines()[0].content).body).toBe("Actually which of them replied this week");
    });

    it("sends a typed line without any mark of speech", () => {
        room.sendMessage("typed hello");
        expect(sent()[0].spoken).toBeUndefined();
        expect(lines()[0].spoken).toBeFalsy();
    });

    it("lets a typed line win over unfinished speech: its words go to the message box, not sent", () => {
        const toBox: string[] = [];
        const watching = room.voiceWordsForComposer.subscribe((words) => toBox.push(words));
        emit(hears("live", "Actually which"));
        room.sendMessage("typed hello");
        expect(drafts()[0].state).toBe("held");
        emit(hears("live", "Actually which of them"));
        expect(toBox).toEqual([]);
        emit(hears("final", "Actually which of them replied"));
        expect(sent().map((line) => line.message)).toEqual(["typed hello"]);
        expect(drafts()).toEqual([]);
        expect(toBox).toEqual(["Actually which of them replied"]);
        watching.unsubscribe();
    });

    it("offers back words that did not come through: Edit, Send or Discard, and nothing is sent by itself", () => {
        emit(hears("live", "one two"));
        emit(hears("lost", "one two three"));
        expect(drafts()).toEqual([
            { botId: BOT_ID, botName: "Nora", turnId: "1-1", state: "lost", text: "one two three" },
        ]);
        expect(sent()).toEqual([]);
        expect(lines()).toEqual([]);
        // Late words of that stretch change nothing
        emit(hears("final", "one two three four"));
        expect(sent()).toEqual([]);
        expect(drafts()[0].text).toBe("one two three");

        room.sendVoiceDraft("1-1");
        expect(sent()).toHaveLength(1);
        expect(sent()[0]).toMatchObject({ message: "one two three", spoken: { botId: BOT_ID, turnId: "1-1" } });
        expect(drafts()).toEqual([]);
    });

    it("lets them discard lost words, or edit them in the message box", () => {
        emit(hears("lost", "one two", "1-1"));
        emit(hears("lost", "three four", "1-2"));
        room.discardVoiceDraft("1-1");
        expect(drafts().map((draft) => draft.turnId)).toEqual(["1-2"]);
        expect(room.editVoiceDraft("1-2")).toBe("three four");
        expect(drafts()).toEqual([]);
        expect(sent()).toEqual([]);
    });

    it("clears a draft the bot says there is nothing to keep of", () => {
        emit(hears("live", "um"));
        emit(hears("cleared", ""));
        expect(drafts()).toEqual([]);
    });

    it("shows nothing from a person, from a bot about another bot, or from a bot this person blocked", () => {
        emit(hears("live", "fake", "1-1", sara, "someone"));
        emit(hears("live", "fake", "1-2", nora, "another-bot"));
        blackListManager.blackList(nora.uuid);
        try {
            emit(hears("live", "blocked", "1-3"));
        } finally {
            blackListManager.cancelBlackList(nora.uuid);
        }
        expect(drafts()).toEqual([]);
    });

    it("ignores an event with parts missing", () => {
        fake.emit("botVoiceDraft", {
            sender: nora,
            botVoiceDraft: { botId: BOT_ID, botName: "Nora", turnId: "", state: "live", text: "x" },
        } as unknown as PublicEvent);
        expect(drafts()).toEqual([]);
    });

    it("lets go of everything when they leave the bubble: no words are theirs to send there any more", async () => {
        emit(hears("lost", "one two"));
        await room.leaveSpace("bubble");
        expect(drafts()).toEqual([]);
    });

    it("shows another person's spoken line with the mic mark, and a typed one without", () => {
        const message = (text: string, spoken?: { botId: string; turnId: string }) => ({
            sender: "room_3",
            spaceMessage: {
                message: text,
                characterTextures: [],
                name: "Sara",
                galleryUrls: [],
                fileNames: [],
                spoken,
            },
        });
        fake.emit("spaceMessage", message("said out loud", { botId: BOT_ID, turnId: "9-1" }) as unknown as PublicEvent);
        fake.emit("spaceMessage", message("typed") as unknown as PublicEvent);
        expect(lines().map((line) => [get(line.content).body, line.spoken === true])).toEqual([
            ["said out loud", true],
            ["typed", false],
        ]);
    });
});
