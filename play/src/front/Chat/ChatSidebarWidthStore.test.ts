import { describe, expect, it, vi } from "vitest";
import { readable, writable } from "svelte/store";

vi.mock("../Stores/ChatStore", () => ({ chatVisibilityStore: writable(false) }));
vi.mock("../Stores/CoWebsiteStore", () => ({ windowSize: readable({ width: 1440, height: 900 }) }));
vi.mock("../Connection/LocalUserStore", () => ({
    localUserStore: { getChatSideBarWidth: () => 335, setChatSideBarWidth: () => {} },
}));
vi.mock("../Stores/MapEditorStore", () => ({
    mapEditorModeStore: writable(false),
    mapEditorToolbarInUseStore: writable(false),
}));
vi.mock("../Stores/BarInViewStore", () => ({ DESKTOP_LAYOUT_MIN_WIDTH: 1024 }));

import { chatLeavesNoRoomForBar } from "./ChatSidebarWidthStore";

describe("chatLeavesNoRoomForBar", () => {
    it("keeps the bar on a desktop however wide the chat is", () => {
        expect(chatLeavesNoRoomForBar(1920, true, 1300, 16, false)).toBe(false);
        expect(chatLeavesNoRoomForBar(1920, true, 1920, 16, false)).toBe(false);
        expect(chatLeavesNoRoomForBar(1024, true, 1000, 16, false)).toBe(false);
    });

    it("hides the bar on a phone when the chat leaves no room beside it", () => {
        expect(chatLeavesNoRoomForBar(390, true, 390, 0, false)).toBe(true);
        expect(chatLeavesNoRoomForBar(800, true, 600, 0, false)).toBe(true);
        expect(chatLeavesNoRoomForBar(800, true, 335, 0, false)).toBe(false);
    });

    it("keeps the bar when the chat is closed", () => {
        expect(chatLeavesNoRoomForBar(390, false, 390, 0, false)).toBe(false);
    });

    it("hides the bar while editing a room on a phone or a small window, never on a desktop", () => {
        expect(chatLeavesNoRoomForBar(390, false, 335, 0, true)).toBe(true);
        expect(chatLeavesNoRoomForBar(800, false, 335, 0, true)).toBe(true);
        expect(chatLeavesNoRoomForBar(1100, false, 335, 16, true)).toBe(false);
        expect(chatLeavesNoRoomForBar(1440, true, 1200, 16, true)).toBe(false);
    });
});
