import { describe, expect, it } from "vitest";
import { drawnSizeOf } from "../pictureSize";

describe("the size a picture is drawn at", () => {
    it("keeps the size the picture has", () => {
        expect(drawnSizeOf({ width: 640, height: 480 }, { width: 400, height: 300 })).toEqual({
            width: 640,
            height: 480,
        });
    });

    it("fills the panel for a vector picture that reports no size", () => {
        expect(drawnSizeOf({ width: 0, height: 0 }, { width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
        expect(drawnSizeOf({ width: 0, height: 120 }, { width: 400, height: 300 })).toEqual({
            width: 400,
            height: 300,
        });
    });

    it("never draws at zero", () => {
        expect(drawnSizeOf({ width: 0, height: 0 }, { width: 0, height: 0 })).toEqual({ width: 1, height: 1 });
    });
});
