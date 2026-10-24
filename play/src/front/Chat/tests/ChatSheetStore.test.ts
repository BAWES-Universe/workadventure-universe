import { afterEach, describe, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";

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
import { openHereFloatsStore } from "../../Stores/CoWebsiteStore";
import {
    chatOwnSheetHeightStore,
    chatSheetHeightStore,
    chatSheetLayoutStore,
    chatSheetOpenStore,
    chatSheetSnapStore,
    lowerChatSheet,
    openHereSheetHeightStore,
    restoreChatAfterFile,
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
        // Settle what a test left pending.
        restoreChatAfterFile();
        chatVisibilityStore.set(false);
        chatSheetSnapStore.set("half");
        (mobileLayoutStore as Writable<boolean>).set(true);
    });

    it("drops the chat sheet to its lowest height, so a file shows above it", () => {
        expect(get(chatSheetLayoutStore)).toBe(true);
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe("peek");
    });

    it("puts the chat back where it was when the file goes", () => {
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");

        lowerChatSheet();
        expect(get(chatSheetSnapStore)).toBe("peek");

        restoreChatAfterFile();
        expect(get(chatSheetSnapStore)).toBe("full");
    });

    it("leaves a chat a person moved since where they put it", () => {
        chatVisibilityStore.set(true);
        lowerChatSheet();

        chatSheetSnapStore.set(0.7);
        restoreChatAfterFile();

        expect(get(chatSheetSnapStore)).toBe(0.7);
    });

    it("keeps the height from before the first file when a second one is tapped", () => {
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");

        lowerChatSheet();
        lowerChatSheet();
        restoreChatAfterFile();

        expect(get(chatSheetSnapStore)).toBe("full");
    });

    it("leaves the height of a chat that is closed alone", () => {
        chatSheetSnapStore.set(0.8);

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe(0.8);
    });

    it("leaves the chat beside the game alone", () => {
        chatVisibilityStore.set(true);
        chatSheetSnapStore.set("full");
        (mobileLayoutStore as Writable<boolean>).set(false);

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe("full");
    });
});

describe("an exactly square window", () => {
    function resizeTo(width: number, height: number) {
        window.innerWidth = width;
        window.innerHeight = height;
        window.dispatchEvent(new Event("resize"));
    }

    afterEach(() => resizeTo(390, 844));

    it("gets the sheet for the chat and the window alike, never one of each", () => {
        const unsubscribe = [chatSheetLayoutStore.subscribe(() => {}), openHereFloatsStore.subscribe(() => {})];
        resizeTo(600, 600);

        expect(get(chatSheetLayoutStore)).toBe(true);
        expect(get(openHereFloatsStore)).toBe(false);

        unsubscribe.forEach((stop) => stop());
    });
});
