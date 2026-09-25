import { describe, expect, it } from "vitest";
import { absoluteUrl, requestProtocol } from "../AbsoluteUrl";

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

describe("requestProtocol", () => {
    it("takes the visitor's protocol when several proxies each added theirs", () => {
        expect(requestProtocol("https, http", "http")).toBe("https");
    });

    it("uses the one value a single proxy sent", () => {
        expect(requestProtocol("https", "http")).toBe("https");
    });

    it("falls back to the connection's protocol without the header", () => {
        expect(requestProtocol(undefined, "http")).toBe("http");
        expect(requestProtocol("", "http")).toBe("http");
    });

    it("builds a page URL the preview image can be resolved against", () => {
        const page = `${requestProtocol("https, http", "http")}://play.example.test/@/org/world/room`;
        expect(absoluteUrl("/static/images/universe-card.png", page)).toBe(
            "https://play.example.test/static/images/universe-card.png"
        );
    });
});
