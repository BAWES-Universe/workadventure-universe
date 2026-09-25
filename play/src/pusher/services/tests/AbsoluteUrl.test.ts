import { describe, expect, it } from "vitest";
import { absoluteUrl } from "../AbsoluteUrl";

describe("absoluteUrl", () => {
    it("puts a bundled image on the page's own domain", () => {
        expect(absoluteUrl("/static/images/universe-card.png", "https://play.example.test/@/org/world/room")).toBe(
            "https://play.example.test/static/images/universe-card.png"
        );
    });

    it("keeps a room's own full image URL as it is", () => {
        expect(absoluteUrl("https://cdn.example.test/card.png", "https://play.example.test/@/org/world/room")).toBe(
            "https://cdn.example.test/card.png"
        );
    });

    it("leaves the value alone when there is nothing to resolve it against", () => {
        expect(absoluteUrl("/static/images/universe-card.png", "not a url")).toBe("/static/images/universe-card.png");
    });
});
