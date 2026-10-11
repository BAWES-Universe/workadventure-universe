/**
 * Epic #1, slice #3 — the BAWES Universe PWA manifest must be a fullscreen,
 * landscape game manifest branded as Universe, and must not advertise the
 * upstream WorkAdventure apps as related applications.
 *
 * The pusher serves this manifest dynamically at
 * GET /static/images/favicons/manifest.json (FrontController.displayManifestJson),
 * so these tests exercise the real generated object — not any static manifest file.
 */
import { describe, expect, it } from "vitest";
import { MetaTagsBuilder } from "../../services/MetaTagsBuilder";
import { buildManifest } from "../../services/ManifestBuilder";

const PAGE_URL = "https://play.example.test/@/org/world/room";

async function servedManifest() {
    const builder = new MetaTagsBuilder(PAGE_URL);
    // getMeta only hits the admin/map for bot user agents; a normal UA returns
    // the bundled defaults, which is exactly what the manifest should brand.
    const metaTagsData = await builder.getMeta("Mozilla/5.0 (X11; Linux x86_64) Vitest");
    return buildManifest(metaTagsData, PAGE_URL.replace("https://play.example.test", ""));
}

describe("dynamic PWA manifest served by the pusher (GET /static/images/favicons/manifest.json)", () => {
    it("is fullscreen: the Universe app is a game, not a website", async () => {
        const manifest = await servedManifest();
        expect(manifest.display).toBe("fullscreen");
    });

    it("is landscape-oriented", async () => {
        const manifest = await servedManifest();
        expect(manifest.orientation).toMatch(/^landscape/);
    });

    it("does not advertise upstream workadventu.re apps as related applications", async () => {
        const manifest = await servedManifest();
        const apps = manifest.related_applications ?? [];
        expect(apps.some((app) => String(app.url).includes("workadventu.re"))).toBe(false);
    });

    it("ships Universe icons at 192 and 512", async () => {
        const manifest = await servedManifest();
        const sizes = manifest.icons.map((icon) => icon.sizes);
        expect(sizes).toContain("192x192");
        expect(sizes).toContain("512x512");
        for (const icon of manifest.icons) {
            expect(icon.src).toContain("/static/images/favicons/");
        }
    });

    it("keeps the app shortcut branded with the same Universe icons", async () => {
        const manifest = await servedManifest();
        const shortcutIconSources = manifest.shortcuts[0].icons.map((icon) => icon.src);
        expect(shortcutIconSources).toContain("/static/images/favicons/icon-192x192.png");
        expect(shortcutIconSources).not.toContain("/static/images/favicons/android-icon-192x192.png");
    });
});
