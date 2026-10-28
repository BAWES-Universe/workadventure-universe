import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../Connection/Matrix/MatrixSecurity", () => ({ matrixSecurity: {} }));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../Enum/EnvironmentVariable", () => ({ ENABLE_CHAT: true }));

import { chatVisibilityStore } from "../../Stores/ChatStore";
import { selectedRoomStore } from "../Stores/SelectRoomStore";
import { selectedChatMessageToReply, shouldRestoreChatStateStore } from "../Stores/ChatStore";
import { openProfileRoomIdStore } from "../Stores/PartnerProfileStore";
import { openRoomDetailsIdStore, openSharedItemsStore } from "../Stores/ChatDetailsStore";
import type { ChatRoom } from "../Connection/ChatConnection";
import { chatDepth, chatDepthStore, closeChatLevel, leaveChat } from "../ChatBack";

const room = { id: "!room", isEncrypted: { subscribe: (run: (value: boolean) => void) => (run(false), () => {}) } };

function openRoom() {
    selectedRoomStore.set(room as unknown as ChatRoom);
}

describe("chatDepth", () => {
    it("counts the open levels of the chat on screen", () => {
        expect(chatDepth(true, undefined, undefined, undefined, undefined)).toBe(0);
        expect(chatDepth(false, "!room", "!room", undefined, "!room")).toBe(0);
        expect(chatDepth(true, "!room", undefined, undefined, undefined)).toBe(1);
        expect(chatDepth(true, "!room", "!room", undefined, undefined)).toBe(2);
        expect(chatDepth(true, "!room", undefined, "!room", undefined)).toBe(2);
        expect(chatDepth(true, "!room", undefined, "!room", "!room")).toBe(3);
        // Opened straight over the conversation.
        expect(chatDepth(true, "!room", undefined, undefined, "!room")).toBe(2);
    });

    it("ignores what was left open for another chat", () => {
        expect(chatDepth(true, "!room", "!other", "!other", "!other")).toBe(1);
    });
});

describe("closeChatLevel", () => {
    beforeEach(() => {
        leaveChat();
        chatVisibilityStore.set(true);
    });

    it("goes back one level at a time, down to all chats", () => {
        openRoom();
        openRoomDetailsIdStore.set("!room");
        openSharedItemsStore.set({ roomId: "!room", tab: "media" });
        expect(get(chatDepthStore)).toBe(3);

        closeChatLevel();
        expect(get(openSharedItemsStore)).toBeUndefined();
        expect(get(openRoomDetailsIdStore)).toBe("!room");
        expect(get(chatDepthStore)).toBe(2);

        closeChatLevel();
        expect(get(openRoomDetailsIdStore)).toBeUndefined();
        expect(get(selectedRoomStore)).toBe(room);
        expect(get(chatDepthStore)).toBe(1);

        closeChatLevel();
        expect(get(selectedRoomStore)).toBeUndefined();
        expect(get(chatDepthStore)).toBe(0);

        // On all chats: nothing more to close.
        closeChatLevel();
        expect(get(chatDepthStore)).toBe(0);
    });

    it("closes a direct chat's profile like a group's details", () => {
        openRoom();
        openProfileRoomIdStore.set("!room");
        closeChatLevel();
        expect(get(openProfileRoomIdStore)).toBeUndefined();
        expect(get(selectedRoomStore)).toBe(room);
    });

    it("leaving the conversation drops the reply and the restore", () => {
        openRoom();
        selectedChatMessageToReply.set({ id: "m" } as never);
        shouldRestoreChatStateStore.set(true);
        closeChatLevel();
        expect(get(selectedChatMessageToReply)).toBeNull();
        expect(get(shouldRestoreChatStateStore)).toBe(false);
    });
});
