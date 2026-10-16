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

    it("does nothing when the page has no manifest link", () => {
        document.head.innerHTML = "";
        expect(() => pointManifestAtRoom("/@/a/b/c")).not.toThrow();
    });
});
