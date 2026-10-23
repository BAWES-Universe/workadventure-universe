import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

// An upright phone: the browser window is taller than it is wide, and it is a small touch screen.
vi.hoisted(() => {
    window.innerWidth = 390;
    window.innerHeight = 844;
});
vi.mock("../../Stores/MobileLayoutStore", async () => {
    const { writable } = await import("svelte/store");
    return { mobileLayoutStore: writable(true) };
});

import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import {
    chatOwnSheetHeightStore,
    chatSheetHeightStore,
    chatSheetLayoutStore,
    chatSheetOpenStore,
    chatSheetSnapStore,
    lowerChatSheet,
    openHereSheetHeightStore,
} from "../ChatSheetStore";

describe("the sheets' heights", () => {
    afterEach(() => {
        chatOwnSheetHeightStore.set(0);
        openHereSheetHeightStore.set(0);
    });

    it("is the taller of the chat's sheet and the window's, so the videos fit above both", () => {
        expect(get(chatSheetHeightStore)).toBe(0);
        expect(get(chatSheetOpenStore)).toBe(false);

        openHereSheetHeightStore.set(506);
        expect(get(chatSheetHeightStore)).toBe(506);
        expect(get(chatSheetOpenStore)).toBe(true);

        chatOwnSheetHeightStore.set(287);
        expect(get(chatSheetHeightStore)).toBe(506);

        openHereSheetHeightStore.set(0);
        expect(get(chatSheetHeightStore)).toBe(287);
    });
});

describe("lowerChatSheet", () => {
    afterEach(() => {
        chatVisibilityStore.set(false);
        chatSheetSnapStore.set("half");
        mobileLayoutStore.set(true);
    });

    it("drops the chat sheet to its lowest height, so a file shows above it", () => {
        expect(get(chatSheetLayoutStore)).toBe(true);
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe("peek");
    });

    it("leaves the height of a chat that is closed alone", () => {
        chatSheetSnapStore.set(0.8);

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe(0.8);
    });

    it("leaves the chat beside the game alone", () => {
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");
        (mobileLayoutStore as unknown as { set: (value: boolean) => void }).set(false);

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe("full");
    });
});
