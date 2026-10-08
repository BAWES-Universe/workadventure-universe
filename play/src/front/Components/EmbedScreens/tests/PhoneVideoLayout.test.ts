import { describe, expect, it } from "vitest";
import { phoneVideoLayout, PHONE_SMALL_HEIGHT, PHONE_SMALL_MAX_HEIGHT } from "../PhoneVideoLayout";

// A 390px phone: the videos get 382px across.
const W = 382;

describe("phoneVideoLayout", () => {
    it("shows two people side by side, as big as the space allows", () => {
        const layout = phoneVideoLayout(2, W, 154);
        expect(layout).toMatchObject({ kind: "videos", shown: 2, more: 0 });
        expect(layout.width).toBeGreaterThanOrEqual(160);
        expect(layout.width * 2 + 8).toBeLessThanOrEqual(W);
    });

    it("shows whole rows only, with a +N tile for the rest", () => {
        // Nine people in three and a half rows of two: five people and +4, not a fourth row cut in half.
        const layout = phoneVideoLayout(9, W, 330);
        expect(layout).toMatchObject({ kind: "videos", shown: 5, more: 4 });
        const rows = Math.ceil((layout.shown + 1) / 2);
        expect(rows * layout.height + (rows - 1) * 8).toBeLessThanOrEqual(330);
    });

    it("turns to small videos when big videos would show fewer people than a row of small ones", () => {
        // Twelve people at the default height: one row of two videos would show one and +11; small videos show
        // two rows of three, five and +7.
        const layout = phoneVideoLayout(12, W, 154);
        expect(layout).toMatchObject({ kind: "small", width: 100, height: PHONE_SMALL_HEIGHT, shown: 5, more: 7 });
    });

    it("keeps every video a 16:9 rectangle, never a circle or a square", () => {
        for (const [count, height] of [
            [2, 70],
            [7, 154],
            [12, 40],
            [5, 150],
        ]) {
            const layout = phoneVideoLayout(count, W, height);
            expect(Math.abs(layout.width / layout.height - 16 / 9)).toBeLessThan(0.05);
        }
    });

    it("grows the videos with the space, never jumping back to a smaller kind", () => {
        // A sheet dragged up a pixel at a time: the videos only shrink, and stay rectangles.
        let previous = Infinity;
        for (let height = 400; height >= 40; height--) {
            const layout = phoneVideoLayout(2, 420, height);
            expect(layout.height).toBeLessThanOrEqual(previous);
            expect(layout.shown).toBe(2);
            previous = layout.height;
        }
    });

    it("keeps videos when everyone fits, however many", () => {
        expect(phoneVideoLayout(4, W, 400)).toMatchObject({ kind: "videos", shown: 4, more: 0 });
    });

    it("uses one row of small videos under one row's height, as big as the row allows", () => {
        expect(phoneVideoLayout(2, W, 70)).toMatchObject({ kind: "small", width: 110, height: 62, shown: 2, more: 0 });
    });

    it("grows the small videos with the space", () => {
        expect(phoneVideoLayout(5, 420, 150)).toMatchObject({ kind: "small", height: 70, shown: 5, more: 0 });
        // Never higher than the highest small video.
        expect(phoneVideoLayout(30, 1430, 300).height).toBeLessThanOrEqual(PHONE_SMALL_MAX_HEIGHT);
    });

    it("gives a desktop a row of small videos when the white bar is small, instead of cut videos", () => {
        expect(phoneVideoLayout(7, 1430, 80)).toMatchObject({ kind: "small", height: 72, shown: 7, more: 0 });
        // With room for a row of videos, whole videos, at least as big as a desktop shows them today.
        const videos = phoneVideoLayout(7, 1430, 212);
        expect(videos.kind).toBe("videos");
        expect(videos.width).toBeGreaterThanOrEqual(160);
        expect(videos.shown).toBe(7);
    });

    it("never shows a screen share as a small video", () => {
        expect(phoneVideoLayout(7, W, 154, false, Infinity, false).kind).toBe("videos");
        expect(phoneVideoLayout(3, 1430, 80, false, Infinity, false)).toMatchObject({
            kind: "videos",
            height: 80,
            shown: 3,
        });
    });

    it("uses one row of small videos under one row's height when not everyone fits", () => {
        const layout = phoneVideoLayout(12, W, 70);
        expect(layout).toMatchObject({ kind: "small", height: PHONE_SMALL_HEIGHT });
        expect(layout.shown + layout.more).toBe(12);
        expect(layout.shown + 1).toBe(Math.floor((W + 8) / (layout.width + 8)));
    });

    it("never makes a small video lower than 36px when the row has room, nor taller than the row", () => {
        expect(phoneVideoLayout(12, W, 40).height).toBe(36);
        expect(phoneVideoLayout(12, W, 30).height).toBe(30);
        expect(phoneVideoLayout(3, 1430, 30, false, Infinity, false).height).toBe(30);
    });

    it("lists everyone in a list that scrolls when asked", () => {
        expect(phoneVideoLayout(12, W, 300, true)).toMatchObject({ kind: "videos", shown: 12, more: 0, scrolls: true });
    });

    it("prefers big videos while they show at least a row of small ones", () => {
        // Six people, room for two rows of two videos: three and +3, as many as a row of small videos.
        expect(phoneVideoLayout(6, W, 220)).toMatchObject({ kind: "videos", shown: 3, more: 3 });
    });

    it("never shows more people than the limit, the rest behind +N", () => {
        expect(phoneVideoLayout(7, W, 600)).toMatchObject({ shown: 7, more: 0 });
        const capped = phoneVideoLayout(7, W, 600, false, 6);
        expect(capped.shown).toBeLessThanOrEqual(6);
        expect(capped.shown + capped.more).toBe(7);
        expect(phoneVideoLayout(7, W, 600, true, 6)).toMatchObject({ shown: 7, scrolls: true });
    });

    it("lays out nobody until the space is measured", () => {
        expect(phoneVideoLayout(3, NaN, 300)).toMatchObject({ shown: 0, more: 0 });
        expect(phoneVideoLayout(3, W, NaN)).toMatchObject({ shown: 0, more: 0 });
    });

    it("is the same for the same space, whichever sets it", () => {
        expect(phoneVideoLayout(9, W, 330)).toEqual(phoneVideoLayout(9, W, 330));
    });
});
