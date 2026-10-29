import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

// A reconnect is swapping the map: there is no game scene to read.
const sceneHolder = vi.hoisted(() => ({ scene: undefined as unknown }));
vi.mock("../../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => {
            if (!sceneHolder.scene) throw new Error("Not the Game Scene");
            return sceneHolder.scene;
        },
        tryGetCurrentGameScene: () => sceneHolder.scene,
    },
}));
vi.mock("../../../../Stores/ChatStore", () => ({
    chatSearchBarValue: writable(""),
    navChat: { switchToUserList: vi.fn() },
}));
vi.mock("../../../../Stores/SelectRoomStore", () => ({ selectedRoomStore: writable(undefined) }));
vi.mock("../../../UserList/PersonNavigation", () => ({ goToPersonRoom: vi.fn(), walkToPerson: vi.fn() }));
vi.mock("../../../../../Administration/AnalyticsClient", () => ({
    analyticsClient: new Proxy({}, { get: () => () => {} }),
}));
vi.mock("../../../../../Connection/LocalUserStore", () => ({
    localUserStore: { getLocalUser: () => ({ uuid: "uuid-me" }) },
}));
const friendsHolder = vi.hoisted(() => ({ runFriendAction: vi.fn(() => Promise.resolve(true)) }));
vi.mock("../../../../Stores/FriendsStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { friendsEnabledStore: store(true), relationshipsStore: store(new Map([["uuid-sara", "friends"]])) };
});
vi.mock("../../../UserList/FriendActions", () => ({ runFriendAction: friendsHolder.runFriendAction }));
// Whether you may message a bot: the owner's rule, as Orbit answers it.
const botsHolder = vi.hoisted(() => ({
    allowed: new Set<string>(),
    asked: 0,
    openDirectChatRoom: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../../Bots/BotStatusStore", async () => {
    const { readable: store } = await import("svelte/store");
    return {
        botDmAccessCache: {
            store: (botId: string) => {
                botsHolder.asked++;
                return store(botsHolder.allowed.has(botId));
            },
        },
    };
});
// Sending what was left unsent to a direct chat: the room it would go to is handed to the send.
const directHolder = vi.hoisted(() => ({
    sendToDirectChat: vi.fn((chatID: string, send: (room: unknown) => Promise<void>) => {
        void chatID;
        return Promise.resolve(true);
    }),
}));
vi.mock("../../../../Utils", () => ({
    openDirectChatRoom: botsHolder.openDirectChatRoom,
    sendToDirectChat: directHolder.sendToDirectChat,
}));
vi.mock("../../../../../Stores/MenuStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { userIsConnected: store(true) };
});
vi.mock("../../../../Connection/Matrix/MatrixChatRoom", () => ({
    MatrixChatRoom: class {
        sendVoiceNote = vi.fn(() => Promise.resolve());
    },
}));
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import type { ProximitySession } from "../../../../Connection/Proximity/ProximitySessions";
import type { ChatMessage } from "../../../../Connection/ChatConnection";
import ProximityEndedFooter from "../ProximityEndedFooter.svelte";
import { MatrixChatRoom } from "../../../../Connection/Matrix/MatrixChatRoom";
import type { ProximityChatRoom } from "../../../../Connection/Proximity/ProximityChatRoom";
import { gameSceneIsLoadedStore } from "../../../../../Stores/GameSceneStore";

const endedWithBot: ProximitySession<ChatMessage> = {
    id: "stay-1",
    stayIds: ["stay-1"],
    index: 1,
    label: "Bot",
    participants: ["Bot"],
    participantIds: ["space-bot"],
    isArea: false,
    startedAt: 1,
    endedAt: 2,
    entries: [],
    messages: [],
    lastMessage: undefined,
    unsentDraft: undefined,
    isLive: false,
};

describe("ProximityEndedFooter", () => {
    let component: ProximityEndedFooter | undefined;

    afterEach(() => {
        component?.$destroy();
        document.body.innerHTML = "";
        sceneHolder.scene = undefined;
        gameSceneIsLoadedStore.set(false);
        botsHolder.allowed.clear();
        botsHolder.asked = 0;
        botsHolder.openDirectChatRoom.mockClear();
        directHolder.sendToDirectChat.mockClear();
    });

    it("offers the way back once the new map has loaded, when it first showed during the swap", async () => {
        const target = document.createElement("div");
        document.body.append(target);
        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();
        expect(target.querySelector('[data-kind="find"]')).toBeNull();

        sceneHolder.scene = {
            allUsersInWorldStore: readable(new Map()),
            roomUrl: "https://play.example.test/room",
            room: { isChatOnlineListEnabled: true, isChatDisconnectedListEnabled: false },
            userProviderMerger: Promise.resolve({ usersByRoomStore: readable(new Map()) }),
        };
        gameSceneIsLoadedStore.set(true);
        await tick();

        expect(target.querySelector('[data-kind="find"]')).not.toBeNull();
    });

    it("lists who you were with, with Add friend for signed-in people who aren't friends yet", async () => {
        sceneHolder.scene = {
            allUsersInWorldStore: readable(
                new Map([
                    ["space-noura", { uuid: "uuid-noura", name: "Noura", chatID: "@noura:chat", playUri: "x" }],
                    ["space-sara", { uuid: "uuid-sara", name: "Sara", chatID: "@sara:chat", playUri: "x" }],
                    ["space-guest", { uuid: "uuid-guest", name: "Guest", playUri: "x" }],
                    ["space-me", { uuid: "uuid-me", name: "Me", chatID: "@me:chat", playUri: "x" }],
                ])
            ),
            roomUrl: "https://play.example.test/room",
            room: { isChatOnlineListEnabled: true, isChatDisconnectedListEnabled: false },
            userProviderMerger: Promise.resolve({ usersByRoomStore: readable(new Map()) }),
        };
        const target = document.createElement("div");
        document.body.append(target);
        component = new ProximityEndedFooter({
            target,
            props: {
                session: {
                    ...endedWithBot,
                    participants: ["Noura", "Sara", "Guest", "Me"],
                    participantIds: ["space-noura", "space-sara", "space-guest", "space-me"],
                },
            },
        });
        await tick();

        const met = target.querySelector('[data-testid="proximityMetPeople"]');
        expect(met?.textContent).toContain("Noura");
        expect(met?.textContent).toContain("Sara");
        expect(met?.textContent).not.toContain("Guest");
        expect(met?.textContent).not.toContain("Me");
        const add = target.querySelectorAll<HTMLButtonElement>('[data-testid="proximityAddFriend"]');
        expect(add).toHaveLength(1);
        add[0].click();
        expect(friendsHolder.runFriendAction).toHaveBeenCalledWith("uuid-noura", "Noura", "request");
    });

    it("leaves bots out of who you were with, but still offers to walk to them", async () => {
        sceneHolder.scene = {
            allUsersInWorldStore: readable(
                new Map([
                    [
                        "space-bot",
                        {
                            uuid: "bot-7",
                            name: "Bot",
                            chatID: "@bot_7:chat.example.test",
                            tags: ["bot"],
                            playUri: "https://play.example.test/room",
                        },
                    ],
                    ["space-noura", { uuid: "uuid-noura", name: "Noura", chatID: "@noura:chat", playUri: "x" }],
                ])
            ),
            roomUrl: "https://play.example.test/room",
            room: { isChatOnlineListEnabled: true, isChatDisconnectedListEnabled: false },
            userProviderMerger: Promise.resolve({ usersByRoomStore: readable(new Map()) }),
        };
        const target = document.createElement("div");
        document.body.append(target);
        component = new ProximityEndedFooter({
            target,
            props: {
                session: {
                    ...endedWithBot,
                    participants: ["Bot", "Noura"],
                    participantIds: ["space-bot", "space-noura"],
                },
            },
        });
        await tick();

        const met = target.querySelector('[data-testid="proximityMetPeople"]');
        expect(met?.textContent).toContain("Noura");
        expect(met?.textContent).not.toContain("Bot");
        expect(target.querySelectorAll('[data-testid="proximityAddFriend"]')).toHaveLength(1);
        expect(target.querySelector('[data-kind="walk"]')).not.toBeNull();
    });

    function botScene() {
        sceneHolder.scene = {
            allUsersInWorldStore: readable(
                new Map([
                    [
                        "space-bot",
                        {
                            uuid: "bot-7",
                            name: "Bot",
                            chatID: "@bot_7:chat.example.test",
                            tags: ["bot"],
                            playUri: "https://play.example.test/room",
                        },
                    ],
                ])
            ),
            roomUrl: "https://play.example.test/room",
            room: { isChatOnlineListEnabled: true, isChatDisconnectedListEnabled: false },
            userProviderMerger: Promise.resolve({ usersByRoomStore: readable(new Map()) }),
        };
    }

    it("offers Message for a bot you may message, which opens your direct messages with it", async () => {
        botsHolder.allowed.add("7");
        botScene();
        const target = document.createElement("div");
        document.body.append(target);
        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();

        const met = target.querySelector('[data-testid="proximityMetPeople"]');
        expect(met?.textContent).toContain("Bot");
        expect(target.querySelector('[data-testid="proximityAddFriend"]')).toBeNull();
        expect(target.querySelector('[data-testid="proximityInvite"]')).toBeNull();
        const message = target.querySelector<HTMLButtonElement>('[data-testid="proximityMessageBot"]');
        expect(message).not.toBeNull();
        message?.click();
        expect(botsHolder.openDirectChatRoom).toHaveBeenCalledWith("@bot_7:chat.example.test");
    });

    it("keeps the bot's Message as people around it change, without asking again", async () => {
        botsHolder.allowed.add("7");
        const bot = {
            uuid: "bot-7",
            name: "Bot",
            chatID: "@bot_7:chat.example.test",
            tags: ["bot"],
            playUri: "https://play.example.test/room",
        };
        const users = writable(new Map<string, unknown>([["space-bot", bot]]));
        sceneHolder.scene = {
            allUsersInWorldStore: users,
            roomUrl: "https://play.example.test/room",
            room: { isChatOnlineListEnabled: true, isChatDisconnectedListEnabled: false },
            userProviderMerger: Promise.resolve({ usersByRoomStore: readable(new Map()) }),
        };
        const target = document.createElement("div");
        document.body.append(target);
        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();
        expect(botsHolder.asked).toBe(1);

        users.set(
            new Map<string, unknown>([
                ["space-bot", { ...bot }],
                ["space-noura", { uuid: "uuid-noura", name: "Noura", playUri: "x" }],
            ])
        );
        await tick();

        expect(botsHolder.asked).toBe(1);
        expect(target.querySelector('[data-testid="proximityMessageBot"]')).not.toBeNull();
    });

    it("lists no bot you may not message", async () => {
        botScene();
        const target = document.createElement("div");
        document.body.append(target);
        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();

        expect(target.querySelector('[data-testid="proximityMetPeople"]')).toBeNull();
        expect(target.querySelector('[data-testid="proximityMessageBot"]')).toBeNull();
        expect(target.querySelector('[data-kind="walk"]')).not.toBeNull();
    });

    it("shows while the map is being swapped, instead of breaking the chat", async () => {
        const target = document.createElement("div");
        document.body.append(target);

        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();

        expect(target.innerHTML).not.toBe("");
    });

    describe("what was left unsent", () => {
        const note = { file: new File(["x"], "voice.weba"), details: { duration: 5, waveform: [1] } };
        const withNoura = {
            ...endedWithBot,
            label: "Noura",
            participants: ["Noura"],
            participantIds: ["space-noura"],
            unsentVoiceNote: note,
        };
        const proximityRoom = () =>
            ({ takeUnsentVoiceNote: vi.fn(), takeUnsentDraft: vi.fn() } as unknown as ProximityChatRoom & {
                takeUnsentVoiceNote: ReturnType<typeof vi.fn>;
                takeUnsentDraft: ReturnType<typeof vi.fn>;
            });
        const show = async (session: ProximitySession<ChatMessage>, room: ProximityChatRoom, noura: object) => {
            URL.createObjectURL = vi.fn(() => "blob:note");
            URL.revokeObjectURL = vi.fn();
            // jsdom does not play media.
            HTMLMediaElement.prototype.pause = vi.fn();
            sceneHolder.scene = {
                allUsersInWorldStore: readable(new Map([["space-noura", noura]])),
                roomUrl: "https://play.example.test/room",
                room: { isChatOnlineListEnabled: true, isChatDisconnectedListEnabled: false },
                userProviderMerger: Promise.resolve({ usersByRoomStore: readable(new Map()) }),
            };
            const target = document.createElement("div");
            document.body.append(target);
            component = new ProximityEndedFooter({ target, props: { session, room } });
            await tick();
            return target;
        };
        const signedIn = { uuid: "uuid-noura", name: "Noura", chatID: "@noura:chat", playUri: "x" };

        it("sends the voice note to Noura as a direct message, and takes it out of the ended chat", async () => {
            const room = proximityRoom();
            const target = await show(withNoura, room, signedIn);
            expect(target.querySelector('[data-testid="proximityUnsentVoiceNote"]')).not.toBeNull();

            target.querySelector<HTMLButtonElement>('[data-testid="proximityVoiceToDirect"]')?.click();
            await vi.waitFor(() => expect(room.takeUnsentVoiceNote).toHaveBeenCalledWith(withNoura));
            const [chatID, send] = directHolder.sendToDirectChat.mock.calls[0];
            expect(chatID).toBe("@noura:chat");
            const MockedRoom = MatrixChatRoom as unknown as new () => { sendVoiceNote: ReturnType<typeof vi.fn> };
            const direct = new MockedRoom();
            await send(direct);
            expect(direct.sendVoiceNote).toHaveBeenCalledWith(note.file, note.details);
        });

        it("keeps the voice note there, with no direct message, when Noura is a guest", async () => {
            const target = await show(withNoura, proximityRoom(), { uuid: "uuid-noura", name: "Noura", playUri: "x" });
            expect(target.querySelector('[data-testid="proximityUnsentVoiceNote"]')).not.toBeNull();
            expect(target.querySelector('[data-testid="proximityUnsentVoicePlay"]')).not.toBeNull();
            expect(target.querySelector('[data-testid="proximityVoiceToDirect"]')).toBeNull();
        });

        it("has no direct message for a group", async () => {
            const target = await show(
                { ...withNoura, participants: ["Noura", "Sara"], participantIds: ["space-noura", "space-sara"] },
                proximityRoom(),
                signedIn
            );
            expect(target.querySelector('[data-testid="proximityVoiceToDirect"]')).toBeNull();
        });

        it("sends typed text left unsent the same way, with its line breaks", async () => {
            const room = proximityRoom();
            const session = { ...withNoura, unsentVoiceNote: undefined, unsentDraft: "Can you send<br>the deck?<br>" };
            const target = await show(session, room, signedIn);
            target.querySelector<HTMLButtonElement>('[data-testid="proximityDraftToDirect"]')?.click();
            await vi.waitFor(() => expect(room.takeUnsentDraft).toHaveBeenCalledWith(session));
            const [, send] = directHolder.sendToDirectChat.mock.calls[0];
            const direct = { sendMessage: vi.fn() };
            await send(direct);
            expect(direct.sendMessage).toHaveBeenCalledWith("Can you send\nthe deck?");
        });
    });
});
