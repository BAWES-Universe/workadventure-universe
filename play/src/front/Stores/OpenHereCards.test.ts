import { describe, expect, it } from "vitest";
import { cardOverWindow } from "./OpenHereCards";

describe("Open here window and the cards over the game", () => {
    it("stays in front when nothing else is open", () => {
        expect(cardOverWindow({ barMenu: false, panel: false, card: false })).toBe(false);
    });

    it("goes under a bar menu, a panel or a card opened over it", () => {
        expect(cardOverWindow({ barMenu: true, panel: false, card: false })).toBe(true);
        expect(cardOverWindow({ barMenu: false, panel: true, card: false })).toBe(true);
        expect(cardOverWindow({ barMenu: false, panel: false, card: true })).toBe(true);
    });
});
