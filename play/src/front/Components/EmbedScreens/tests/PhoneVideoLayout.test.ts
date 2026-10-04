import { describe, expect, it } from "vitest";
import { phoneVideoLayout, PHONE_FACE_MAX_SIZE, PHONE_FACE_SIZE } from "../PhoneVideoLayout";

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

    it("turns to faces when big videos would show fewer people than a row of faces", () => {
        // Twelve people at the default height: one row of two videos would hide ten; faces show everyone.
        const layout = phoneVideoLayout(12, W, 154);
        expect(layout).toMatchObject({ kind: "faces", width: PHONE_FACE_SIZE, shown: 12, more: 0 });
    });

    it("keeps videos when everyone fits, however many", () => {
        expect(phoneVideoLayout(4, W, 400)).toMatchObject({ kind: "videos", shown: 4, more: 0 });
    });

    it("uses one row of faces under one row's height, as big as the row allows", () => {
        expect(phoneVideoLayout(2, W, 70)).toMatchObject({ kind: "faces", width: 62, shown: 2, more: 0 });
    });

    it("grows the faces with the space", () => {
        // Seven people with the white bar at its default: two rows of four, bigger than the smallest faces.
        expect(phoneVideoLayout(7, W, 154)).toMatchObject({ kind: "faces", width: 72, shown: 7, more: 0 });
        // Never bigger than the biggest face.
        expect(phoneVideoLayout(6, W, 220)).toMatchObject({ kind: "faces", width: PHONE_FACE_MAX_SIZE, shown: 6 });
    });

    it("gives a desktop a row of faces when the white bar is small, instead of cut videos", () => {
        expect(phoneVideoLayout(7, 1430, 80)).toMatchObject({ kind: "faces", width: 72, shown: 7, more: 0 });
        // With room for a row of videos, whole videos, at least as big as a desktop shows them today.
        const videos = phoneVideoLayout(7, 1430, 212);
        expect(videos.kind).toBe("videos");
        expect(videos.width).toBeGreaterThanOrEqual(160);
        expect(videos.shown).toBe(7);
    });

    it("never shows a screen share as a face", () => {
        expect(phoneVideoLayout(7, W, 154, false, Infinity, false).kind).toBe("videos");
        expect(phoneVideoLayout(3, 1430, 80, false, Infinity, false)).toMatchObject({
            kind: "videos",
            height: 80,
            shown: 3,
        });
    });

    it("uses one row of faces under one row's height when not everyone fits", () => {
        const layout = phoneVideoLayout(12, W, 70);
        expect(layout).toMatchObject({ kind: "faces", width: PHONE_FACE_SIZE });
        expect(layout.shown + layout.more).toBe(12);
        expect(layout.shown + 1).toBe(Math.floor((W + 8) / (PHONE_FACE_SIZE + 8)));
    });

    it("never makes a face smaller than 36px", () => {
        expect(phoneVideoLayout(12, W, 10).width).toBe(36);
    });

    it("lists everyone in a list that scrolls when asked", () => {
        expect(phoneVideoLayout(12, W, 300, true)).toMatchObject({ kind: "videos", shown: 12, more: 0, scrolls: true });
    });

    it("prefers a row of faces to a few big videos", () => {
        // Six people, room for two rows of two videos: all six as faces rather than three and +3.
        expect(phoneVideoLayout(6, W, 220)).toMatchObject({ kind: "faces", shown: 6, more: 0 });
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
