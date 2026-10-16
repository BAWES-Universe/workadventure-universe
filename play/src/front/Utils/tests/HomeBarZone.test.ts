import { afterEach, describe, expect, it } from "vitest";
import { bottomSafeAreaInset, isInHomeBarZone, startsInHomeBarZone } from "../HomeBarZone";

describe("isInHomeBarZone", () => {
    it("owns the bottom strip of the screen, as tall as the inset", () => {
        // An iPhone held upright: 926px tall, 34px home bar.
        expect(isInHomeBarZone(925, 34, 926)).toBe(true);
        expect(isInHomeBarZone(892, 34, 926)).toBe(true);
    });

    it("leaves the map above the strip to the map", () => {
        expect(isInHomeBarZone(891, 34, 926)).toBe(false);
        expect(isInHomeBarZone(400, 34, 926)).toBe(false);
    });

    it("owns nothing where the phone reports no inset (browsers, desktop, upright only)", () => {
        expect(isInHomeBarZone(925, 0, 926)).toBe(false);
    });
});

describe("startsInHomeBarZone on the page", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    // jsdom has no env(): the probe reads back whatever padding the stub says.
    const windowWith = (paddingBottom: string, innerHeight = 926) =>
        ({
            innerHeight,
            getComputedStyle: () => ({ paddingBottom }),
        } as unknown as Window);

    it("measures the bottom inset and removes its probe", () => {
        expect(bottomSafeAreaInset(document, windowWith("34px"))).toBe(34);
        expect(document.body.children.length).toBe(0);
    });

    it("treats an unreadable or empty inset as none", () => {
        expect(bottomSafeAreaInset(document, windowWith(""))).toBe(0);
        expect(bottomSafeAreaInset(document, windowWith("0px"))).toBe(0);
    });

    it("tells a touch on the home bar from a touch on the map", () => {
        expect(startsInHomeBarZone(920, document, windowWith("34px"))).toBe(true);
        expect(startsInHomeBarZone(600, document, windowWith("34px"))).toBe(false);
        expect(startsInHomeBarZone(920, document, windowWith("0px"))).toBe(false);
    });
});
