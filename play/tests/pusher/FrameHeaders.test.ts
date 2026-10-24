import { describe, expect, it } from "vitest";
import { isFrameable, originOf } from "../../src/pusher/services/FrameHeaders";

const GAME = "https://play.bawes.net";
const page = new URL("https://en.wikipedia.org/wiki/Kuwait");
const framed = (headers: Parameters<typeof isFrameable>[0], embedder: string | undefined = GAME, url = page) =>
    isFrameable(headers, url, embedder);

describe("isFrameable", () => {
    it("lets a page with neither header in", () => {
        expect(framed({})).toBe(true);
    });

    it("reads X-Frame-Options", () => {
        expect(framed({ "x-frame-options": "DENY" })).toBe(false);
        expect(framed({ "x-frame-options": "sameorigin" })).toBe(false);
        expect(framed({ "x-frame-options": "SAMEORIGIN, DENY" })).toBe(false);
        expect(framed({ "x-frame-options": ["ALLOWALL"] })).toBe(true);
    });

    it("reads CSP frame-ancestors (the 16 Sep upstream fix)", () => {
        expect(framed({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" })).toBe(false);
        expect(framed({ "content-security-policy": "frame-ancestors 'self'" })).toBe(false);
        expect(framed({ "content-security-policy": "frame-ancestors 'self' https://claude.ai" })).toBe(false);
        expect(framed({ "content-security-policy": "frame-ancestors *" })).toBe(true);
        expect(framed({ "content-security-policy": "frame-ancestors https:" })).toBe(true);
        expect(framed({ "content-security-policy": "default-src 'self'; script-src 'none'" })).toBe(true);
    });

    it("lets the game in when frame-ancestors names it", () => {
        expect(framed({ "content-security-policy": "frame-ancestors https://play.bawes.net" })).toBe(true);
        expect(framed({ "content-security-policy": "frame-ancestors https://*.bawes.net" })).toBe(true);
        expect(framed({ "content-security-policy": "frame-ancestors play.bawes.net" })).toBe(true);
        expect(framed({ "content-security-policy": "frame-ancestors https://bawes.net" })).toBe(false);
        expect(framed({ "content-security-policy": "frame-ancestors https://play.bawes.net:8443" })).toBe(false);
        expect(framed({ "content-security-policy": "frame-ancestors https://play.bawes.net:*" })).toBe(true);
        expect(framed({ "content-security-policy": "frame-ancestors https://*.bawes.net" }, "https://bawes.net")).toBe(
            false
        );
    });

    it("lets 'self' in only for the page's own origin", () => {
        const own = new URL("https://play.bawes.net/help");
        expect(framed({ "content-security-policy": "frame-ancestors 'self'" }, GAME, own)).toBe(true);
    });

    it("needs every policy that has frame-ancestors to allow the game", () => {
        expect(framed({ "content-security-policy": "frame-ancestors *, frame-ancestors 'none'" })).toBe(false);
        expect(framed({ "content-security-policy": ["frame-ancestors *", "default-src 'self'"] })).toBe(true);
    });

    it("ignores X-Frame-Options when frame-ancestors is there, as browsers do", () => {
        expect(framed({ "x-frame-options": "DENY", "content-security-policy": "frame-ancestors *" })).toBe(true);
        expect(framed({ "x-frame-options": "ALLOWALL", "content-security-policy": "frame-ancestors 'none'" })).toBe(
            false
        );
    });

    it("ignores 'none' next to other sources", () => {
        expect(framed({ "content-security-policy": "frame-ancestors 'none' *" })).toBe(true);
    });

    it("refuses a page that names its ancestors when the game's address is unknown", () => {
        expect(framed({ "content-security-policy": "frame-ancestors https://play.bawes.net" }, "")).toBe(false);
        expect(framed({}, "")).toBe(true);
    });
});

describe("originOf", () => {
    it("reads a full FRONT_URL as it is", () => {
        expect(originOf("https://play.bawes.net/", "https://other.example/")).toBe(GAME);
    });

    it("reads a path FRONT_URL against PUSHER_URL", () => {
        expect(originOf("/", "https://play.bawes.net/")).toBe(GAME);
        expect(originOf("", "https://play.bawes.net/")).toBe(GAME);
    });

    it("knows no origin when neither is a full address", () => {
        expect(originOf("/", "/")).toBeUndefined();
        expect(originOf("/", undefined)).toBeUndefined();
        expect(originOf("", "")).toBeUndefined();
    });
});
