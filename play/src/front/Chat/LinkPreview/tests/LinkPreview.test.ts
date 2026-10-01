import { describe, expect, it } from "vitest";
import { extractChatLinks } from "../ChatLinks";
import type { LinkApps } from "../LinkKind";
import { classifyLink, youtubeVideoOf } from "../LinkKind";

const allApps: LinkApps = {
    youtube: true,
    googleDocs: true,
    googleSheets: true,
    googleSlides: true,
    googleDrive: true,
    klaxoon: true,
    eraser: true,
    excalidraw: true,
    excalidrawDomains: ["excalidraw.com"],
    cards: true,
    tldraw: true,
    custom: [],
};

describe("extractChatLinks", () => {
    it("finds full links and bare site names, in order", () => {
        expect(extractChatLinks("check out bawes.net and https://example.com/a?b=1.", 5)).toEqual([
            "https://bawes.net",
            "https://example.com/a?b=1",
        ]);
    });

    it("leaves file names, code and e-mails alone", () => {
        expect(extractChatLinks("edit index.ts, run `curl https://x.com` or mail me@bawes.net", 5)).toEqual([]);
    });

    it("keeps the message's first link only when asked for one", () => {
        expect(extractChatLinks("www.a.com then www.b.com", 1)).toEqual(["https://www.a.com"]);
    });
});

describe("youtubeVideoOf", () => {
    it.each([
        ["https://www.youtube.com/watch?v=kkJ7wWidnp8", "kkJ7wWidnp8"],
        ["https://youtu.be/kkJ7wWidnp8?si=abc", "kkJ7wWidnp8"],
        ["https://www.youtube.com/embed/kkJ7wWidnp8?feature=oembed", "kkJ7wWidnp8"],
        ["https://www.youtube.com/shorts/kkJ7wWidnp8", "kkJ7wWidnp8"],
        ["https://m.youtube.com/watch?v=kkJ7wWidnp8", "kkJ7wWidnp8"],
    ])("reads the video of %s", (url, videoId) => {
        expect(youtubeVideoOf(new URL(url))?.videoId).toBe(videoId);
    });

    it("reads the start time", () => {
        expect(youtubeVideoOf(new URL("https://youtu.be/kkJ7wWidnp8?t=1m30s"))?.start).toBe(90);
        expect(youtubeVideoOf(new URL("https://www.youtube.com/watch?v=kkJ7wWidnp8&t=42"))?.start).toBe(42);
    });

    it("ignores YouTube pages that aren't a video", () => {
        expect(youtubeVideoOf(new URL("https://www.youtube.com/@bawes"))).toBeUndefined();
        expect(youtubeVideoOf(new URL("https://notyoutube.com/watch?v=kkJ7wWidnp8"))).toBeUndefined();
    });
});

describe("classifyLink", () => {
    it("plays YouTube links in place when YouTube is allowed", () => {
        expect(classifyLink("https://youtu.be/kkJ7wWidnp8", allApps)).toMatchObject({
            kind: "youtube",
            videoId: "kkJ7wWidnp8",
        });
        expect(classifyLink("https://youtu.be/kkJ7wWidnp8", { ...allApps, youtube: false }).kind).toBe("web");
    });

    it("opens Google files here with their embed URL", () => {
        expect(classifyLink("https://docs.google.com/document/d/abc/edit", allApps)).toMatchObject({
            kind: "app",
            app: "googleDocs",
            name: "Google Docs",
            embedUrl: "https://docs.google.com/document/d/abc/edit?embedded=true",
        });
        expect(classifyLink("https://drive.google.com/file/d/abc/view?usp=sharing", allApps)).toMatchObject({
            kind: "app",
            app: "googleDrive",
            embedUrl: "https://drive.google.com/file/d/abc/preview?usp=sharing",
        });
    });

    it("treats an app the room turned off as a plain web link", () => {
        expect(classifyLink("https://docs.google.com/document/d/abc/edit", { ...allApps, googleDocs: false }).kind).toBe(
            "web"
        );
    });

    it("recognises whiteboards", () => {
        expect(classifyLink("https://excalidraw.com/#room=1,2", allApps)).toMatchObject({ app: "excalidraw" });
        expect(classifyLink("https://www.tldraw.com/r/abc", allApps)).toMatchObject({ app: "tldraw" });
        expect(classifyLink("https://app.eraser.io/workspace/abc", allApps)).toMatchObject({ app: "eraser" });
    });

    it("opens a room's own app with its target URL", () => {
        const apps: LinkApps = {
            ...allApps,
            custom: [
                {
                    name: "Miro",
                    image: "https://example.com/miro.png",
                    regexUrl: "https://miro.com/app/board/(.*)",
                    targetUrl: "https://miro.com/app/live-embed/$1",
                },
            ] as LinkApps["custom"],
        };
        expect(classifyLink("https://miro.com/app/board/xyz=/", apps)).toMatchObject({
            kind: "app",
            app: "custom",
            name: "Miro",
            embedUrl: "https://miro.com/app/live-embed/xyz=/",
            icon: "https://example.com/miro.png",
        });
    });

    it("shows image links as images, and anything else as a web card", () => {
        expect(classifyLink("https://example.com/cat.PNG", allApps).kind).toBe("image");
        expect(classifyLink("https://bawes.net", allApps).kind).toBe("web");
    });
});
