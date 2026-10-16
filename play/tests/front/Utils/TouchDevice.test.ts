import { afterEach, describe, expect, it, vi } from "vitest";
import { isTouchDevice } from "../../../src/front/Utils/TouchDevice";
import { replaceSpaceToken } from "../../../src/front/Utils/HintKey";

afterEach(() => vi.unstubAllGlobals());

function stubMatchMedia(touch: boolean) {
    vi.stubGlobal("window", {
        matchMedia: (query: string) => ({ matches: touch && query === "(hover: none) and (pointer: coarse)" }),
    });
}

describe("isTouchDevice", () => {
    it("is true when the main input is a finger, whatever the window width", () => {
        stubMatchMedia(true);
        expect(isTouchDevice()).toBe(true);
    });

    it("is false for a mouse, even in a narrow window", () => {
        stubMatchMedia(false);
        vi.stubGlobal("innerWidth", 400);
        expect(isTouchDevice()).toBe(false);
    });

    it("is false when matchMedia is missing", () => {
        vi.stubGlobal("window", {});
        expect(isTouchDevice()).toBe(false);
    });
});

describe("replaceSpaceToken", () => {
    it("replaces every [SPACE] with the key chip", () => {
        expect(replaceSpaceToken("<p>[SPACE] to enter, [SPACE] again</p>", "[SPACE]", "Tap")).toBe(
            '<p><kbd class="u-hint-key">Tap</kbd> to enter, <kbd class="u-hint-key">Tap</kbd> again</p>'
        );
    });

    it("leaves a text without the token alone", () => {
        expect(replaceSpaceToken("<p>Hello</p>", "[SPACE]", "Space")).toBe("<p>Hello</p>");
        expect(replaceSpaceToken("<p>Hello</p>", "", "Space")).toBe("<p>Hello</p>");
    });
});
