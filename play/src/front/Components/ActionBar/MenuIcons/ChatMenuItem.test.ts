import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable } from "svelte/store";

vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: new Proxy({}, { get: () => () => {} }) }));
vi.mock("../../../Phaser/Game/GameManager", () => {
    const room = () => ({
        unreadNotificationCount: writable(0),
        hasUnreadMessages: writable(false),
    });
    return {
        gameManager: {
            getCurrentGameScene: () => ({ proximityChatRoom: room() }),
            getChatConnection: () => Promise.resolve(),
            chatConnection: { rooms: readable([]), directRooms: readable([]), invitations: readable([]) },
        },
    };
});
const switchToChat = vi.hoisted(() => vi.fn());
vi.mock("../../../Chat/Stores/ChatStore", () => ({
    navChat: { switchToChat },
}));
vi.mock("../../../Chat/Stores/SelectRoomStore", () => ({ selectedRoomStore: writable(undefined) }));
vi.mock("../../../Stores/MenuStore", () => ({
    activeSubMenuStore: { activateByIndex: vi.fn() },
    menuVisiblilityStore: writable(false),
    helpTextDisabledStore: writable(false),
}));
vi.mock("../../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import { chatComposerFocusRequestStore, chatVisibilityStore } from "../../../Stores/ChatStore";
import ChatMenuItem from "./ChatMenuItem.svelte";

describe("ChatMenuItem", () => {
    let component: ChatMenuItem | undefined;
    let target: HTMLDivElement;

    function mount(props: { alwaysOpen?: boolean }) {
        component = new ChatMenuItem({ target, props });
    }

    async function clickChatButton() {
        // The button stays disabled until the chat connection promise has resolved.
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        await tick();
        const button = target.querySelector<HTMLElement>('[data-testid="chat-btn"]');
        expect(button).not.toBeNull();
        button?.click();
        await tick();
    }

    beforeEach(() => {
        target = document.createElement("div");
        document.body.append(target);
        chatVisibilityStore.set(false);
        chatComposerFocusRequestStore.set(0);
        switchToChat.mockClear();
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    it("opens the chat from the Picture in Picture button when it is closed, and asks for the cursor", async () => {
        mount({ alwaysOpen: true });
        await clickChatButton();
        expect(get(chatVisibilityStore)).toBe(true);
        expect(get(chatComposerFocusRequestStore)).toBeGreaterThan(0);
    });

    it("keeps the chat open from the Picture in Picture button when it is already open", async () => {
        chatVisibilityStore.set(true);
        mount({ alwaysOpen: true });
        await clickChatButton();
        expect(get(chatVisibilityStore)).toBe(true);
        expect(switchToChat).toHaveBeenCalled();
        expect(get(chatComposerFocusRequestStore)).toBeGreaterThan(0);
    });

    it("still closes an open chat from the normal chat button, without grabbing the cursor", async () => {
        chatVisibilityStore.set(true);
        mount({});
        await clickChatButton();
        expect(get(chatVisibilityStore)).toBe(false);
        expect(get(chatComposerFocusRequestStore)).toBe(0);
    });
});
