import { describe, expect, it } from "vitest";
import { firstShowingIndex, keyboardClosed, listGrewTaller, placeAfterMove, stillPinnedToBottom } from "../TimelinePin";

const view = { scrollHeight: 2000, clientHeight: 500 }; // the bottom is at scrollTop 1500

describe("stillPinnedToBottom", () => {
    it("pins at the bottom, and a few pixels above it", () => {
        expect(stillPinnedToBottom(false, 1000, { ...view, scrollTop: 1500 })).toBe(true);
        expect(stillPinnedToBottom(false, 1000, { ...view, scrollTop: 1480 })).toBe(true);
    });

    it("unpins when the reader scrolls up", () => {
        expect(stillPinnedToBottom(true, 1500, { ...view, scrollTop: 1200 })).toBe(false);
    });

    it("unpins on a very slow scroll up, less than a pixel at a time", () => {
        expect(stillPinnedToBottom(true, 1200, { ...view, scrollTop: 1199.5 })).toBe(false);
    });

    it("stays pinned while the chat scrolls down on its own and has not reached the bottom yet", () => {
        expect(stillPinnedToBottom(true, 900, { ...view, scrollTop: 1100 })).toBe(true);
    });

    it("stays pinned when a picture grows under the reader without a scroll up", () => {
        // A GIF loaded: the list got taller, the place did not move.
        expect(stillPinnedToBottom(true, 1500, { scrollHeight: 2300, clientHeight: 500, scrollTop: 1500 })).toBe(true);
    });

    it("does not pin again while the reader scrolls back down but is still reading", () => {
        expect(stillPinnedToBottom(false, 900, { ...view, scrollTop: 1100 })).toBe(false);
    });
});

describe("listGrewTaller", () => {
    it("sees the list getting taller when the keyboard closes", () => {
        expect(listGrewTaller(180, 420)).toBe(true);
    });

    it("ignores the list getting shorter, rounding, and the first size", () => {
        expect(listGrewTaller(420, 180)).toBe(false);
        expect(listGrewTaller(420, 420.5)).toBe(false);
        expect(listGrewTaller(0, 420)).toBe(false);
    });
});

describe("keyboardClosed", () => {
    it("sees the keyboard closing on an iPhone (466 to 879)", () => {
        expect(keyboardClosed(466, 879)).toBe(true);
    });

    it("ignores the keyboard opening and small changes", () => {
        expect(keyboardClosed(879, 466)).toBe(false);
        expect(keyboardClosed(879, 926)).toBe(false);
    });
});

describe("firstShowingIndex", () => {
    // Four messages 100px tall, the list's top at 250: the third one (200 to 300) is cut by the top.
    const bottoms = [100, 200, 300, 400];
    const bottomAt = (index: number) => bottoms[index];

    it("finds the message cut by the top of the list", () => {
        expect(firstShowingIndex(bottoms.length, bottomAt, 250)).toBe(2);
    });

    it("skips a message that ends exactly at the top", () => {
        expect(firstShowingIndex(bottoms.length, bottomAt, 200)).toBe(2);
    });

    it("finds the first message when the list is scrolled to the top", () => {
        expect(firstShowingIndex(bottoms.length, bottomAt, 0)).toBe(0);
    });

    it("finds none when every message is above the top, or there are none", () => {
        expect(firstShowingIndex(bottoms.length, bottomAt, 400)).toBeUndefined();
        expect(firstShowingIndex(0, bottomAt, 0)).toBeUndefined();
    });
});

describe("placeAfterMove", () => {
    it("moves down by as much as older messages added above", () => {
        expect(placeAfterMove(300, 300, 2000, 480)).toBe(780);
    });

    it("counts from where the reader is now when they scrolled since", () => {
        expect(placeAfterMove(250, 300, 2000, 480)).toBe(730);
    });

    it("counts from where the reader was when the list got shorter and the browser pulled them to its end", () => {
        // 30px from the end of a 1000px scroll: 100px above went away, the browser pulled the place to the new end, 900.
        expect(placeAfterMove(900, 970, 900, -100)).toBe(870);
    });

    it("counts from now when the reader is at the end without being pulled there", () => {
        expect(placeAfterMove(900, 880, 900, -100)).toBe(800);
    });
});
