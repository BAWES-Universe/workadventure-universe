import { describe, expect, it } from "vitest";
import { stillPinnedToBottom } from "../TimelinePin";

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
