import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/i18n/i18n-svelte", () => ({
    default: {
        subscribe: (callback: (value: unknown) => void) => {
            callback({
                trigger: {
                    object: () => "Press [SPACE] to interact with it",
                    cowebsite: () => "Press [SPACE] to open the website",
                    jitsiRoom: () => "Press [SPACE] to enter Jitsi",
                    newTab: () => "Press [SPACE] to open a new tab",
                    mobile: {
                        object: () => "Tap to interact with it",
                        cowebsite: () => "Tap to open the website",
                        jitsiRoom: () => "Tap to enter Jitsi",
                        newTab: () => "Tap to open a new tab",
                    },
                },
            });
            return () => {};
        },
    },
}));

import { getTriggerHint } from "../../../src/front/Utils/TriggerHint";

afterEach(() => vi.unstubAllGlobals());

function stubDevice(touch: boolean, width: number) {
    vi.stubGlobal("window", {
        innerWidth: width,
        matchMedia: (query: string) => ({ matches: touch && query === "(hover: none) and (pointer: coarse)" }),
    });
}

describe("getTriggerHint", () => {
    it("says Tap on an iPad, however wide its window is", () => {
        stubDevice(true, 1180);
        expect(getTriggerHint("object")).toBe("Tap to interact with it");
        expect(getTriggerHint("cowebsite")).toBe("Tap to open the website");
        expect(getTriggerHint("jitsiRoom")).toBe("Tap to enter Jitsi");
        expect(getTriggerHint("newTab")).toBe("Tap to open a new tab");
    });

    it("says Press [SPACE] on a computer, even in a narrow window", () => {
        stubDevice(false, 400);
        expect(getTriggerHint("object")).toBe("Press [SPACE] to interact with it");
        expect(getTriggerHint("newTab")).toBe("Press [SPACE] to open a new tab");
    });
});
