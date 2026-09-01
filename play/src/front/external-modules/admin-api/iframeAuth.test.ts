import { describe, expect, it } from "vitest";
import { buildAdminLoginUrl, isOrbitAuthReadyMessage } from "./iframeAuth";

describe("Orbit iframe authentication", () => {
    it("builds a credential-free login URL", () => {
        const url = new URL(buildAdminLoginUrl("https://admin.example.com/base", "https://play.example.com/@/room"));
        expect(url.origin).toBe("https://admin.example.com");
        expect(url.pathname).toBe("/admin/login");
        expect(url.searchParams.get("playUri")).toBe("https://play.example.com/@/room");
        expect(url.searchParams.has("accessToken")).toBe(false);
        expect(url.searchParams.has("_token")).toBe(false);
    });

    it("accepts only a versioned ready message with a bounded nonce", () => {
        expect(isOrbitAuthReadyMessage({ type: "orbit-auth-ready-v2", version: 2, nonce: "1234567890abcdef" })).toBe(true);
        expect(isOrbitAuthReadyMessage({ type: "orbit-auth-ready-v2", version: 1, nonce: "1234567890abcdef" })).toBe(false);
        expect(isOrbitAuthReadyMessage({ type: "orbit-auth-ready-v2", version: 2, nonce: "short" })).toBe(false);
    });
});
