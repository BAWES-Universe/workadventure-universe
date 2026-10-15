import { afterEach, describe, expect, it, vi } from "vitest";
import { canHover } from "../FocusAfterSend";

function stubMatchMedia(matches: boolean) {
    const matchMedia = vi.fn().mockReturnValue({ matches });
    vi.stubGlobal("matchMedia", matchMedia);
    return matchMedia;
}

describe("canHover", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("is true with a mouse, so the box is focused again after a GIF", () => {
        const matchMedia = stubMatchMedia(true);
        expect(canHover()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith("(hover: hover)");
    });

    it("is false on a phone or tablet, so the keyboard stays closed after a GIF", () => {
        stubMatchMedia(false);
        expect(canHover()).toBe(false);
    });

    it("is false where the browser cannot tell", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(canHover()).toBe(false);
    });
});
