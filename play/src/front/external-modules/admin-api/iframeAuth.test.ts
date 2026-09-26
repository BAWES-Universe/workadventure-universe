import { describe, expect, it } from "vitest";
import { buildAdminLoginUrl, isOrbitAuthReadyMessage, resolveCredentialUrl } from "./iframeAuth";

describe("Orbit iframe authentication", () => {
    it("builds a credential-free login URL", () => {
        const url = new URL(buildAdminLoginUrl("https://admin.example.com/base", "https://play.example.com/@/room"));
        expect(url.origin).toBe("https://admin.example.com");
        expect(url.pathname).toBe("/admin/login");
        expect(url.searchParams.get("playUri")).toBe("https://play.example.com/@/room");
        expect(url.searchParams.has("accessToken")).toBe(false);
        expect(url.searchParams.has("_token")).toBe(false);
    });

    it("adds the Orbit page to land on when one is asked for", () => {
        const url = new URL(
            buildAdminLoginUrl(
                "https://admin.example.com",
                "https://play.example.com/@/room",
                undefined,
                "/admin/profile"
            )
        );
        expect(url.searchParams.get("redirect")).toBe("/admin/profile");
        expect(new URL(buildAdminLoginUrl("https://admin.example.com", "r")).searchParams.has("redirect")).toBe(false);
    });

    it("tells Orbit which visit this is, so it can reopen on the page it last showed", () => {
        const url = new URL(
            buildAdminLoginUrl("https://admin.example.com", "r", undefined, undefined, "rev-aaaaaaaaaaaaaaaa")
        );
        expect(url.searchParams.get("rev")).toBe("rev-aaaaaaaaaaaaaaaa");
        expect(new URL(buildAdminLoginUrl("https://admin.example.com", "r")).searchParams.has("rev")).toBe(false);
    });

    it("accepts only a versioned ready message with a bounded nonce", () => {
        expect(isOrbitAuthReadyMessage({ type: "orbit-auth-ready-v2", version: 2, nonce: "1234567890abcdef" })).toBe(
            true
        );
        expect(isOrbitAuthReadyMessage({ type: "orbit-auth-ready-v2", version: 1, nonce: "1234567890abcdef" })).toBe(
            false
        );
        expect(isOrbitAuthReadyMessage({ type: "orbit-auth-ready-v2", version: 2, nonce: "short" })).toBe(false);
    });

    it("requires HTTPS except for loopback development origins", () => {
        expect(resolveCredentialUrl("https://admin.example.com").origin).toBe("https://admin.example.com");
        expect(resolveCredentialUrl("http://admin.workadventure.localhost").origin).toBe(
            "http://admin.workadventure.localhost"
        );
        expect(() => resolveCredentialUrl("http://admin.example.com")).toThrow(/HTTPS/);
        expect(resolveCredentialUrl("/admin", "https://play.example.com").origin).toBe("https://play.example.com");
    });
});
