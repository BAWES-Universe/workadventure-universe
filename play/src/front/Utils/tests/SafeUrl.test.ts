import { describe, expect, it } from "vitest";
import { isHttpUrl, isNavigableUrl } from "../SafeUrl";

const base = "https://play.example.com/_/global/maps.example.com/map.json";

describe("isNavigableUrl", () => {
    it("accepts pages, absolute or relative", () => {
        expect(isNavigableUrl("https://play.example.com/@/world/room#moveToUser=abc", base)).toBe(true);
        expect(isNavigableUrl("/login", base)).toBe(true);
        expect(isNavigableUrl("mailto:someone@example.com", base)).toBe(true);
    });

    it("refuses links that run code in the page", () => {
        expect(isNavigableUrl("javascript:alert(1)//#moveToUser=abc", base)).toBe(false);
        expect(isNavigableUrl(" JaVaScRiPt:alert(1)", base)).toBe(false);
        expect(isNavigableUrl("java\tscript:alert(1)", base)).toBe(false);
        expect(isNavigableUrl("data:text/html,<script>alert(1)</script>", base)).toBe(false);
        expect(isNavigableUrl("vbscript:msgbox(1)", base)).toBe(false);
    });
});

describe("isHttpUrl", () => {
    it("accepts only absolute http(s) links", () => {
        expect(isHttpUrl("https://orbit.example.com/api/profile/abc?embed=true")).toBe(true);
        expect(isHttpUrl("http://localhost:3000/api/profile/abc?embed=true")).toBe(true);
        expect(isHttpUrl("javascript:alert(1)//")).toBe(false);
        expect(isHttpUrl("data:text/html,hi")).toBe(false);
        expect(isHttpUrl("/api/profile/abc")).toBe(false);
        expect(isHttpUrl("")).toBe(false);
    });
});
