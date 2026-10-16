import { describe, expect, it } from "vitest";
import { refusedOnLoad } from "./WokaRefusedStore";

describe("refusedOnLoad", () => {
    it("asks with the popup when the world refuses the WOKA the device holds", () => {
        expect(refusedOnLoad({ isCharacterTexturesValid: false }, ["cost-1"])).toBe("woka");
    });

    it("leaves the first pick to the picker when there is no WOKA yet", () => {
        expect(refusedOnLoad({ isCharacterTexturesValid: false }, null)).toBeUndefined();
        expect(refusedOnLoad({ isCharacterTexturesValid: false }, [])).toBeUndefined();
    });

    it("asks about the companion when only that is refused", () => {
        expect(refusedOnLoad({ isCharacterTexturesValid: true, isCompanionTextureValid: false }, ["woka"])).toBe(
            "companion"
        );
    });

    it("asks nothing when the world shows both", () => {
        expect(
            refusedOnLoad({ isCharacterTexturesValid: true, isCompanionTextureValid: true }, ["woka"])
        ).toBeUndefined();
        expect(refusedOnLoad({}, null)).toBeUndefined();
    });
});
