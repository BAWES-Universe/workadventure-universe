import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
import { tick } from "svelte";
import { get, writable } from "svelte/store";

// The tests run Svelte's server build, where onMount does nothing; the button needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

const { scene, openChat } = vi.hoisted(() => ({
    scene: {
        current: {
            room: { isChatEnabled: true },
            proximityChatRoom: {
                hasUnreadMessages: { set: vi.fn() },
                unreadNotificationCount: { set: vi.fn() },
            },
        },
    },
    openChat: vi.fn(),
}));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: { getCurrentGameScene: () => scene.current } }));
vi.mock("../../Chat/openChat", () => ({ openChat }));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../Stores/CardOverWindowStore", () => ({ cardOverWindowStore: writable(false) }));
vi.mock("../../../i18n/i18n-svelte", async () => (await import("../Woka/tests/i18nStub")).i18nStub);

import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { modalVisibilityStore } from "../../Stores/ModalStore";
import { openHereTuckedStore, sideWindowInFrontStore } from "../../Stores/SideWindowInFrontStore";
import OpenHereChatButton from "./OpenHereChatButton.svelte";

// The sheet is up while the sheet store says so.
const { sheetUp, listOpen } = vi.hoisted(() => ({
    sheetUp: { store: undefined as undefined | { set: (value: boolean) => void } },
    listOpen: { store: undefined as undefined | { set: (value: boolean) => void } },
}));
vi.mock("../../Stores/OpenHereSheetStore", async () => {
    const { writable } = await import("svelte/store");
    const store = writable(true);
    sheetUp.store = store;
    const list = writable(false);
    listOpen.store = list;
    return { openHereSheetUpStore: store, openHereListOpenStore: list };
});

describe("the chat button that floats over a phone's sheet", () => {
    let component: OpenHereChatButton | undefined;
    let target: HTMLDivElement;

    const button = () => target.querySelector<HTMLButtonElement>('[data-testid="openHereChatButton"]');

    beforeEach(async () => {
        target = document.createElement("div");
        document.body.append(target);
        openChat.mockClear();
        sheetUp.store?.set(true);
        listOpen.store?.set(false);
        component = new OpenHereChatButton({ target });
        await tick();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
        chatVisibilityStore.set(false);
        modalVisibilityStore.set(false);
        openHereTuckedStore.set(false);
        selectedRoomStore.set(undefined);
    });

    it("shows while the sheet is up, and opens the chat as the bar's button does", () => {
        expect(button()).not.toBeNull();

        button()?.click();

        expect(openChat).toHaveBeenCalledWith("button");
    });

    it("opens the proximity chat when the room's chat is off, and clears what was unread there", () => {
        scene.current.room.isChatEnabled = false;

        button()?.click();

        expect(get(selectedRoomStore)).toBe(scene.current.proximityChatRoom);
        expect(scene.current.proximityChatRoom.unreadNotificationCount.set).toHaveBeenCalledWith(0);
        scene.current.room.isChatEnabled = true;
    });

    it("is not there once the chat is open, or when the sheet is not up", async () => {
        chatVisibilityStore.set(true);
        await tick();
        expect(button()).toBeNull();

        chatVisibilityStore.set(false);
        sheetUp.store?.set(false);
        await tick();
        expect(button()).toBeNull();
    });

    it("waits while the list of open items is up, where it would cover Close all", async () => {
        listOpen.store?.set(true);
        await tick();
        expect(button()).toBeNull();

        listOpen.store?.set(false);
        await tick();
        expect(button()).not.toBeNull();
    });

    it("stays under Orbit when it is in front of the sheet", async () => {
        sideWindowInFrontStore.set("orbit");
        modalVisibilityStore.set(true);
        await tick();

        expect(button()).toBeNull();
    });
});
