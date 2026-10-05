import { describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { chatVisibilityStore } from "./ChatStore";
import { modalVisibilityStore } from "./ModalStore";
import { windowInFrontStore } from "./WindowInFrontStore";

describe("windowInFrontStore", () => {
    it("puts whichever of the chat and the window opened last in front", () => {
        expect(get(windowInFrontStore)).toBe("chat");

        chatVisibilityStore.set(true);
        modalVisibilityStore.set(true);
        expect(get(windowInFrontStore)).toBe("window");

        chatVisibilityStore.set(false);
        chatVisibilityStore.set(true);
        expect(get(windowInFrontStore)).toBe("chat");

        modalVisibilityStore.set(false);
        modalVisibilityStore.set(true);
        expect(get(windowInFrontStore)).toBe("window");
    });

    it("leaves the order alone when one of them closes", () => {
        chatVisibilityStore.set(false);
        chatVisibilityStore.set(true);
        expect(get(windowInFrontStore)).toBe("chat");
        modalVisibilityStore.set(false);
        expect(get(windowInFrontStore)).toBe("chat");
    });
});
