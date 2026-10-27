import { describe, expect, it } from "vitest";
import { presetToApplyAgain } from "../pdfScale";

describe("the zoom preset applied again when the panel changes size", () => {
    it("applies a preset that follows the width", () => {
        expect(presetToApplyAgain("page-width", 640)).toBe("page-width");
        expect(presetToApplyAgain("auto", 320)).toBe("auto");
    });

    it("leaves a zoom the reader chose by hand alone", () => {
        expect(presetToApplyAgain("1.5", 640)).toBeUndefined();
        expect(presetToApplyAgain(1.5, 640)).toBeUndefined();
        expect(presetToApplyAgain(undefined, 640)).toBeUndefined();
    });

    it("waits while the panel is hidden and has no width", () => {
        expect(presetToApplyAgain("page-width", 0)).toBeUndefined();
        expect(presetToApplyAgain("auto", 0)).toBeUndefined();
    });
});
