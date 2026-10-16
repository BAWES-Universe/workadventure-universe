import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pointManifestAtRoom } from "../ManifestLink";

describe("pointManifestAtRoom", () => {
    beforeEach(() => {
        document.head.innerHTML =
            '<link rel="manifest" href="/static/images/favicons/manifest.json?url=https://example.com/">';
    });

    afterEach(() => {
        document.head.innerHTML = "";
    });

    it("points the manifest at the room the player moved to", () => {
        pointManifestAtRoom("/@/universe/world/room");
        const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? "";
        const url = new URL(href);
        expect(url.pathname).toBe("/static/images/favicons/manifest.json");
        expect(url.searchParams.get("url")).toBe(`${window.location.origin}/@/universe/world/room`);
    });

    it("takes the room id the game has, which has no leading slash", () => {
        pointManifestAtRoom("@/sandbox/butterfly-world/sky-village-airship-terminal");
        const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? "";
        const manifestUrl = new URL(href).searchParams.get("url") ?? "";
        expect(manifestUrl).toBe(`${window.location.origin}/@/sandbox/butterfly-world/sky-village-airship-terminal`);
        // The server reads it back as a room, so the app starts there and not at "/".
        expect(() => new URL(manifestUrl)).not.toThrow();
    });

    it("leaves the link alone for a path that would leave the site", () => {
        const before = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
        pointManifestAtRoom("//evil.test/x");
        expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href).toBe(before);
    });

    it("does nothing when the page has no manifest link", () => {
        document.head.innerHTML = "";
        expect(() => pointManifestAtRoom("/@/a/b/c")).not.toThrow();
    });
});
