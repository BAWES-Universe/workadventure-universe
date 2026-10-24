import { beforeEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

// An upright phone: the window is a sheet.
const { floats } = vi.hoisted(() => ({
    floats: { current: undefined as undefined | { set: (value: boolean) => void } },
}));
vi.mock("./CoWebsiteStore", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    const store = writable(false);
    floats.current = store;
    return { ...original, openHereFloatsStore: store };
});

import { getSnapHeights } from "../Components/Sheet/BottomSheet";
import { CHAT_SHEET_CLOSE_DISTANCE, CHAT_SHEET_SIZES } from "../Chat/ChatSheetSizes";
import { SimpleCoWebsite } from "../WebRtc/CoWebsite/SimpleCoWebsite";
import { coWebsites } from "./CoWebsiteStore";
import { bringOpenHereInFront, openHereTuckedStore } from "./SideWindowInFrontStore";
import {
    OPEN_HERE_TUCKED_HEIGHT,
    openHereSheetHeight,
    openHereSheetRelease,
    openHereSheetStore,
    openHereSheetUpStore,
} from "./OpenHereSheetStore";

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
        floats.current?.set(false);
    });

    it("is a sheet only with something open on an upright phone, and up until it is tucked", () => {
        expect(get(openHereSheetStore)).toBe(false);

        coWebsites.add(new SimpleCoWebsite(new URL("https://example.com"), false));
        expect(get(openHereSheetStore)).toBe(true);
        expect(get(openHereSheetUpStore)).toBe(true);

        openHereTuckedStore.set(true);
        expect(get(openHereSheetStore)).toBe(true);
        expect(get(openHereSheetUpStore)).toBe(false);

        floats.current?.set(true);
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
