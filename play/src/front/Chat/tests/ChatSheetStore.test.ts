import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { coWebsites, openHereFloatsStore } from "../../Stores/CoWebsiteStore";
import { bringOpenHereInFront, openHereTuckedStore } from "../../Stores/SideWindowInFrontStore";
import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
import { getSnapHeights, sheetFrameStyle } from "../../Components/Sheet/BottomSheet";
import { CHAT_SHEET_CLOSE_DISTANCE, CHAT_SHEET_SIZES } from "../ChatSheetSizes";
import {
    chatOwnSheetHeightStore,
    chatSheetHeightStore,
    chatSheetLayoutStore,
    chatSheetOpenStore,
    chatSheetSnapStore,
    lowerChatSheet,
    openHereSheetHeightStore,
} from "../ChatSheetStore";
import {
    OPEN_HERE_TUCKED_HEIGHT,
    openHereSheetHeight,
    openHereSheetRelease,
    openHereSheetStore,
    openHereSheetUpStore,
} from "../../Stores/OpenHereSheetStore";

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
        (mobileLayoutStore as Writable<boolean>).set(true);
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
        (mobileLayoutStore as Writable<boolean>).set(false);

        lowerChatSheet();

        expect(get(chatSheetSnapStore)).toBe("full");
    });
});

describe("sheetFrameStyle", () => {
    it("sets the height, with no padding while the sheet is clear of the status bar", () => {
        expect(sheetFrameStyle(500, 844)).toBe(
            "height: 500px; padding-top: max(0px, calc(env(safe-area-inset-top, 0px) - 344px));"
        );
    });

    it("keeps the content below the status bar once the sheet covers the whole screen", () => {
        expect(sheetFrameStyle(844, 844)).toBe(
            "height: 844px; padding-top: max(0px, calc(env(safe-area-inset-top, 0px) - 0px));"
        );
        // Taller than the screen (a keyboard resizing it): never a negative offset.
        expect(sheetFrameStyle(900, 844)).toContain("- 0px));");
    });
});

const VIEWPORT = 844;
const heights = getSnapHeights(VIEWPORT, CHAT_SHEET_SIZES);

describe("openHereSheetHeight", () => {
    it("opens at chat's height and rests where it was left", () => {
        const base = { tucked: false, chatOver: false, viewportHeight: VIEWPORT };
        expect(openHereSheetHeight({ ...base, rest: "half" })).toBe(heights.half);
        expect(openHereSheetHeight({ ...base, rest: "peek" })).toBe(heights.peek);
        expect(openHereSheetHeight({ ...base, rest: 0.7 })).toBe(Math.round(0.7 * VIEWPORT));
    });

    it("rises to the top behind the chat, and tucks into one row", () => {
        const base = { rest: "half" as const, viewportHeight: VIEWPORT };
        expect(openHereSheetHeight({ ...base, tucked: false, chatOver: true })).toBe(heights.full);
        expect(openHereSheetHeight({ ...base, tucked: true, chatOver: false })).toBe(OPEN_HERE_TUCKED_HEIGHT);
        // The chat in front of a tucked sheet still raises it: it is the file behind the chat.
        expect(openHereSheetHeight({ ...base, tucked: true, chatOver: true })).toBe(heights.full);
    });
});

describe("openHereSheetRelease", () => {
    it("tucks the sheet when it is let go well below its lowest height, and never closes it", () => {
        expect(openHereSheetRelease(heights.peek - CHAT_SHEET_CLOSE_DISTANCE - 1, VIEWPORT)).toBe("tuck");
        expect(openHereSheetRelease(0, VIEWPORT)).toBe("tuck");
    });

    it("rests where it is let go, as a share of the screen between its lowest height and full", () => {
        expect(openHereSheetRelease(600, VIEWPORT)).toBeCloseTo(600 / VIEWPORT);
        // A little under the lowest height springs back to it.
        expect(openHereSheetRelease(heights.peek - 10, VIEWPORT)).toBeCloseTo(heights.peek / VIEWPORT);
        expect(openHereSheetRelease(5000, VIEWPORT)).toBe(1);
    });
});

describe("the sheet stores", () => {
    beforeEach(() => {
        coWebsites.removeAll();
        openHereTuckedStore.set(false);
        (mobileLayoutStore as Writable<boolean>).set(true);
    });

    it("is a sheet only with something open on an upright phone, and up until it is tucked", () => {
        expect(get(openHereSheetStore)).toBe(false);

        coWebsites.add(new SimpleCoWebsite(new URL("https://example.com"), false));
        expect(get(openHereSheetStore)).toBe(true);
        expect(get(openHereSheetUpStore)).toBe(true);

        openHereTuckedStore.set(true);
        expect(get(openHereSheetStore)).toBe(true);
        expect(get(openHereSheetUpStore)).toBe(false);

        (mobileLayoutStore as Writable<boolean>).set(false);
        expect(get(openHereSheetStore)).toBe(false);
    });

    it("comes back up when something is opened or tapped", () => {
        coWebsites.add(new SimpleCoWebsite(new URL("https://example.com"), false));
        openHereTuckedStore.set(true);

        bringOpenHereInFront();

        expect(get(openHereTuckedStore)).toBe(false);
        expect(get(openHereSheetUpStore)).toBe(true);
    });

    it("comes up for a new item too", () => {
        coWebsites.add(new SimpleCoWebsite(new URL("https://example.com"), false));
        openHereTuckedStore.set(true);

        coWebsites.add(new SimpleCoWebsite(new URL("https://example.org"), false));

        expect(get(openHereTuckedStore)).toBe(false);
    });
});

describe("an exactly square window", () => {
    function resizeTo(width: number, height: number) {
        window.innerWidth = width;
        window.innerHeight = height;
        window.dispatchEvent(new Event("resize"));
    }

    it("gets the sheet for the chat and the window alike, never one of each", () => {
        // The window size only follows the screen while something listens to it.
        const unsubscribe = [chatSheetLayoutStore.subscribe(() => {}), openHereFloatsStore.subscribe(() => {})];
        try {
            resizeTo(600, 600);

            expect(get(chatSheetLayoutStore)).toBe(true);
            expect(get(openHereFloatsStore)).toBe(false);
        } finally {
            resizeTo(390, 844);
            unsubscribe.forEach((stop) => stop());
        }
    });
});
