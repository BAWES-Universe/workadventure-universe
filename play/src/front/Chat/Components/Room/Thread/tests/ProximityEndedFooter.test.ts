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
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import type { ProximitySession } from "../../../../Connection/Proximity/ProximitySessions";
import type { ChatMessage } from "../../../../Connection/ChatConnection";
import ProximityEndedFooter from "../ProximityEndedFooter.svelte";
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

    it("shows while the map is being swapped, instead of breaking the chat", async () => {
        const target = document.createElement("div");
        document.body.append(target);

        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();

        expect(target.innerHTML).not.toBe("");
    });
});
