import { describe, expect, it } from "vitest";
import { versionMenuRoom, VERSION_MENU_MARGIN } from "./versionMenuRoom";

describe("versionMenuRoom", () => {
    it("reaches down to the window's end when nothing covers it", () => {
        expect(versionMenuRoom({ menuTop: 140, windowBottom: 900, viewportHeight: 926, chatHeight: 0 })).toBe(
            900 - 140 - VERSION_MENU_MARGIN
        );
    });

    it("ends above the chat when the chat covers the bottom of the window", () => {
        // The window rose to the top behind the chat, which takes the lower 421px of a 926px screen.
        expect(versionMenuRoom({ menuTop: 144, windowBottom: 926, viewportHeight: 926, chatHeight: 421 })).toBe(
            505 - 144 - VERSION_MENU_MARGIN
        );
    });

    it("has no room at all when the window shows only its row above the chat", () => {
        expect(versionMenuRoom({ menuTop: 500, windowBottom: 926, viewportHeight: 926, chatHeight: 430 })).toBe(0);
    });
});
