import { describe, expect, it } from "vitest";
import { getHslColor, getPalette, getStringPalette } from "../../src/pusher/services/GenerateCustomColors";

const base = (hex: string, exactBase?: boolean) => getPalette(hex, exactBase).find((color) => color.code === "")?.color;

describe("getPalette", () => {
    it("keeps the base step a little toward white by default", () => {
        // #000000 has always given the game a #171717 panel colour.
        expect(base("#000000")).toBe(getHslColor("#171717"));
    });

    it("uses the colour itself as the base step with exactBase", () => {
        expect(base("#14121E", true)).toBe(getHslColor("#14121E"));
        expect(base("#000000", true)).toBe(getHslColor("#000000"));
    });

    it("still runs from light to dark with exactBase", () => {
        const lightness = getPalette("#14121E", true).map((color) =>
            Number(color.color.split(" ")[2].replace("%", ""))
        );
        expect(lightness).toEqual([...lightness].sort((a, b) => b - a));
    });

    it("writes the base step as the bare prefix variable", () => {
        expect(getStringPalette("#14121E", "contrast", true)).toContain(`--contrast: ${getHslColor("#14121E")};`);
        expect(getStringPalette(undefined, "contrast", true)).toBe("");
    });
});
