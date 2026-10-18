import { describe, expect, it } from "vitest";
import type { RequiredMetaTagsData } from "@workadventure/messages";
import {
    buildWebManifest,
    installRoomUrlOfPage,
    isInstalledAppStart,
    manifestUrlOfPage,
    roomPathOfPage,
} from "../WebManifest";

const meta: RequiredMetaTagsData = {
    title: "Universe | Bawes > Lobby > Main",
    description: "Join the Main room.",
    author: "Bawes",
    provider: "Universe",
    favIcons: [],
    manifestIcons: [{ src: "https://orbit.test/assets/icon-512x512.png", sizes: "512x512", type: "image/png" }],
    appName: "Universe",
    shortAppName: "Universe",
    themeColor: "#14121E",
    cardImage: "/card.png",
};

describe("installRoomUrlOfPage", () => {
    it("is the room the installed app came from, so its start page gets that room's colours", () => {
        expect(installRoomUrlOfPage("https://play.test/?installRoom=%2F%40%2Fbawes%2Flobby%2Fmain")).toBe(
            "https://play.test/@/bawes/lobby/main"
        );
    });

    it("is nothing for any other page", () => {
        expect(installRoomUrlOfPage("https://play.test/")).toBeUndefined();
        expect(installRoomUrlOfPage("https://play.test/@/bawes/lobby/main")).toBeUndefined();
        expect(installRoomUrlOfPage("https://play.test/?installRoom=%2F%2Fevil.test%2Fx")).toBeUndefined();
        expect(installRoomUrlOfPage("not a url")).toBeUndefined();
    });
});

describe("isInstalledAppStart", () => {
    it("is the installed app's own start page", () => {
        expect(isInstalledAppStart("https://play.test/?installRoom=%2F%40%2Fbawes%2Flobby%2Fmain")).toBe(true);
    });

    it("is not a bare visit of the site, which still goes to the start room", () => {
        expect(isInstalledAppStart("https://play.test/")).toBe(false);
        expect(isInstalledAppStart("https://play.test/?token=abc")).toBe(false);
    });

    it("is not a room page, even with the parameter", () => {
        expect(isInstalledAppStart("https://play.test/@/bawes/lobby/main?installRoom=%2F%40%2Fx%2Fy%2Fz")).toBe(false);
    });

    it("is not a start page with a room that would leave the site", () => {
        expect(isInstalledAppStart("https://play.test/?installRoom=%2F%2Fevil.test%2Fx")).toBe(false);
        expect(isInstalledAppStart("https://play.test/?installRoom=")).toBe(false);
    });

    it("is not an address that is not one", () => {
        expect(isInstalledAppStart("not a url")).toBe(false);
    });
});

describe("roomPathOfPage", () => {
    it("keeps the path of a room and nothing after it", () => {
        expect(roomPathOfPage("https://play.test/@/bawes/lobby/main?token=secret#spawn")).toBe("/@/bawes/lobby/main");
    });

    it("has no room for the start page", () => {
        expect(roomPathOfPage("https://play.test/")).toBeUndefined();
    });

    it("hands on the room of the installed app's own start page", () => {
        expect(roomPathOfPage("https://play.test/?installRoom=%2F%40%2Fbawes%2Flobby%2Fmain")).toBe(
            "/@/bawes/lobby/main"
        );
    });

    it("refuses a room that would leave the site", () => {
        expect(roomPathOfPage("https://play.test/?installRoom=%2F%2Fevil.test%2Fx")).toBeUndefined();
        expect(roomPathOfPage("https://play.test/?installRoom=https%3A%2F%2Fevil.test")).toBeUndefined();
    });

    it("has no room for an address that is not one", () => {
        expect(roomPathOfPage("not a url")).toBeUndefined();
    });
});

describe("buildWebManifest", () => {
    const manifest = buildWebManifest(meta, "https://play.test/@/bawes/lobby/main?token=secret");

    it("is one app named Universe, whichever room it was installed from", () => {
        expect(manifest.id).toBe("/");
        expect(manifest.name).toBe("Universe");
        expect(manifest.short_name).toBe("Universe");
        expect(buildWebManifest(meta, "https://play.test/@/other/world/room").id).toBe("/");
    });

    it("starts at the start page, with the room it was installed from riding along", () => {
        expect(manifest.start_url).toBe("/?installRoom=%2F%40%2Fbawes%2Flobby%2Fmain");
        expect(manifest.start_url).not.toContain("secret");
        expect(buildWebManifest(meta, "https://play.test/").start_url).toBe("/");
    });

    it("is a standalone window in any orientation that may draw its own title bar, with the broken values gone", () => {
        expect(manifest.display).toBe("standalone");
        expect(manifest).not.toHaveProperty("orientation");
        // The computer app may draw its own title bar (the Universe strip); every other browser stays standalone.
        expect(manifest.display_override).toEqual(["window-controls-overlay"]);
        expect(manifest.scope).toBe("/");
    });

    it("gives the shortcut the same Universe icons as the app, never the old WorkAdventure picture", () => {
        const [shortcut] = manifest.shortcuts;
        expect(shortcut.icons).toEqual(meta.manifestIcons);
        expect(JSON.stringify(manifest)).not.toContain("android-icon-192x192");
    });

    it("lists only its own manifest as a related app, never workadventu.re's", () => {
        expect(buildWebManifest(meta, "https://play.test/@/bawes/lobby/main").related_applications).toEqual([
            {
                platform: "webapp",
                url: "https://play.test/static/images/favicons/manifest.json?url=https%3A%2F%2Fplay.test%2F%40%2Fbawes%2Flobby%2Fmain",
                id: "https://play.test/",
            },
        ]);
        expect(buildWebManifest(meta, "not a url").related_applications).toEqual([]);
    });

    it("links the manifest by room path only, never the page's query or hash (they can hold a login token)", () => {
        const linked = (page: string) => new URL(manifestUrlOfPage(page) ?? "").searchParams.get("url");
        expect(linked("https://play.test/@/bawes/lobby/main?token=secret#spawn")).toBe(
            "https://play.test/@/bawes/lobby/main"
        );
        expect(linked("https://play.test/")).toBe("https://play.test/");
        expect(linked("https://play.test/?installRoom=%2F%40%2Fbawes%2Flobby%2Fmain")).toBe(
            "https://play.test/@/bawes/lobby/main"
        );
        expect(manifestUrlOfPage("not a url")).toBeUndefined();
    });

    it("brings the open window forward when a Universe link is opened", () => {
        expect(manifest.launch_handler).toEqual({ client_mode: ["navigate-existing", "auto"] });
    });

    it("uses the icons and colours Orbit sent", () => {
        expect(manifest.icons).toEqual(meta.manifestIcons);
        expect(manifest.theme_color).toBe("#14121E");
        expect(manifest.background_color).toBe("#14121E");
    });
});
