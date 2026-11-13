import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

const stores = vi.hoisted(() => ({
    connected: { value: false },
    openModal: (() => undefined) as (...args: unknown[]) => void,
}));

vi.mock("../../../src/front/Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => ({
            CurrentPlayer: { x: 1, y: 1 },
            getStartPositionNames: () => ["start"],
            room: { roomName: "Welcome room", isChatOnlineListEnabled: false },
        }),
        chatConnection: { connectionStatus: readable("ONLINE"), isGuest: readable(true) },
    },
}));
vi.mock("../../../src/front/Stores/MenuStore", async () => {
    const { writable: w } = await import("svelte/store");
    return { inviteUserActivated: w(true), userIsConnected: w(stores.connected.value) };
});
const bricksPageOpen = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("../../../src/front/Chat/Stores/ChatStore", () => ({
    bricksPageOpenStore: bricksPageOpen,
    chatInviteSheetHeightStore: writable(0),
    chatSearchBarValue: writable(""),
    chatSearchOpenStore: writable(false),
    inviteCardRequestStore: writable(false),
    navChat: writable({ key: "chat" }),
}));
vi.mock("../../../src/front/Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../src/front/Chat/Components/Header/ChatHeaderNewMenu", () => ({
    focusChatSearchRequest: writable(false),
    getNewChatOptions: () => [],
}));
vi.mock("../../../src/front/Chat/Components/Header/ChatHeaderNewMenu.svelte", async () => ({
    default: (await import("./stubs/Empty.svelte")).default,
}));
vi.mock("../../../src/front/Chat/Components/ChatHeader.svelte", async () => ({
    default: (await import("./stubs/Empty.svelte")).default,
}));
vi.mock("../../../src/front/Chat/Bricks/GuestBrickSignIn.svelte", async () => ({
    default: (await import("./stubs/Empty.svelte")).default,
}));
const guestEntries = vi.hoisted(() => ({ store: undefined as undefined | { set(v: unknown[]): void } }));
vi.mock("../../../src/front/Chat/Bricks/GuestBrickStore", async () => {
    const { writable: w } = await import("svelte/store");
    const store = w<unknown[]>([]);
    guestEntries.store = store;
    return { guestBrickEntries: store };
});
const openModal = vi.hoisted(() => vi.fn());
vi.mock("svelte-modals", () => ({ openModal }));
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { default: readable(deep()) };
});

import InviteFooter from "../../../src/front/Chat/Components/InviteFooter.svelte";

const bricksButton = () => document.querySelector<HTMLElement>('[data-testid="chatBricksButton"]');

describe("InviteFooter Bricks button for a guest (#1997)", () => {
    let component: InviteFooter | undefined;
    afterEach(() => {
        component?.$destroy();
        document.body.innerHTML = "";
        guestEntries.store?.set([]);
        openModal.mockReset();
        bricksPageOpen.set.mockReset();
    });

    it("has no Bricks button for a guest without the Brick for guests", async () => {
        component = new InviteFooter({ target: document.body });
        await tick();
        expect(bricksButton()).toBeNull();
    });

    it("shows the Bricks button for a guest who has the Brick for guests, and it opens the sign-in card", async () => {
        guestEntries.store?.set([{}]);
        component = new InviteFooter({ target: document.body });
        await tick();
        const button = bricksButton();
        expect(button).not.toBeNull();
        button?.click();
        await tick();
        expect(openModal).toHaveBeenCalledTimes(1);
        expect(bricksPageOpen.set).not.toHaveBeenCalled();
    });
});
