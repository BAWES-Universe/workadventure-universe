import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    createDirectRoom: vi.fn(),
    shown: vi.fn(),
}));

vi.mock("@sentry/svelte", () => ({ captureException: vi.fn() }));
vi.mock("svelte-modals", () => ({ openModal: vi.fn() }));
vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { createMatrixRoom: vi.fn(), login: vi.fn() },
}));
vi.mock("../../Api/IframeListener", () => ({ iframeListener: {} }));
vi.mock("../../Connection/ConnectionManager", () => ({ connectionManager: {} }));
vi.mock("../../Connection/LocalUserStore", () => ({ localUserStore: { getChatId: () => "@me:chat.test" } }));
vi.mock("../../WebRtc/CoWebsite/SimpleCoWebsite", () => ({ SimpleCoWebsite: class {} }));
vi.mock("../../Stores/CoWebsiteStore", () => ({ coWebsites: {} }));
vi.mock("../../Api/ScriptUtils", () => ({ scriptUtils: {} }));
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { getChatConnection: () => Promise.resolve({ createDirectRoom: game.createDirectRoom }) },
}));
vi.mock("../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: vi.fn() } }));
vi.mock("../../../i18n/i18n-svelte", async () => {
    const store = await import("svelte/store");
    return { LL: store.readable({ chat: { chatsStillLoading: () => "", failedToOpenRoom: () => "" } }) };
});
vi.mock("../openChat", () => ({ openChat: vi.fn() }));
vi.mock("../Stores/ChatStore", async () => {
    const store = await import("svelte/store");
    return {
        navChat: { switchToChat: vi.fn() },
        selectedChatMessageToReply: store.writable(null),
    };
});
vi.mock("../Stores/SelectRoomStore", async () => {
    const store = await import("svelte/store");
    return { selectedRoomStore: store.writable(undefined) };
});
vi.mock("../Components/RequiresLoginForChatModal.svelte", () => ({ default: {} }));

import { openDirectChatRoom } from "../Utils";

/** A direct chat the person was only invited to: it is joined when the test lets the join through. */
function invitedRoom() {
    let join: () => void = () => undefined;
    const joining = new Promise<void>((resolve) => {
        join = resolve;
    });
    const room = {
        id: "!invited:chat.test",
        myMembership: writable("invite"),
        joinRoom: vi.fn(() => joining),
    };
    return { room, join };
}

describe("opening the direct chat with someone who invited the person", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("waits for the join before it shows the chat to a caller that has a screen of its own", async () => {
        const { room, join } = invitedRoom();
        game.createDirectRoom.mockResolvedValue(room);
        const opening = openDirectChatRoom("@bot_x:chat.test", { show: game.shown });
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
        expect(room.joinRoom).toHaveBeenCalledTimes(1);
        // The person is not yet in the room: nothing is sent into it, or shown, until the join is over
        expect(game.shown).not.toHaveBeenCalled();
        join();
        await expect(opening).resolves.toBe(room);
        expect(game.shown).toHaveBeenCalledWith(room);
    });

    it("does not wait for the join when nobody sends into the room at once", async () => {
        const { room } = invitedRoom();
        game.createDirectRoom.mockResolvedValue(room);
        // The join never ends here: the chat is still shown
        await expect(openDirectChatRoom("@bot_x:chat.test")).resolves.toBe(room);
        expect(room.joinRoom).toHaveBeenCalledTimes(1);
    });
});
