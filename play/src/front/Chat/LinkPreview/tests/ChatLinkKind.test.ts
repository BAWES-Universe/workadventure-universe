import { describe, expect, it, vi } from "vitest";

vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: {
        youtubeToolActivated: true,
        googleDocsToolActivated: false,
        googleSheetsToolActivated: false,
        googleSlidesToolActivated: false,
        googleDriveToolActivated: false,
        klaxoonToolActivated: false,
        klaxoonToolClientId: undefined,
        eraserToolActivated: false,
        excalidrawToolActivated: false,
        excalidrawToolDomains: [],
        cardsToolActivated: false,
        tldrawToolActivated: false,
        applications: [],
    },
}));

import { bodyShownWithCard, previewedLinkOf } from "../ChatLinkKind";
import { extractChatLinks, withoutPreview, withoutTrailingLink } from "../ChatLinks";

describe("a message without a text body", () => {
    // Images, files, deleted messages and some bots' messages reach the chat with no body.
    it("has no link and is shown as it is", () => {
        expect(previewedLinkOf(undefined)).toBeUndefined();
        expect(bodyShownWithCard(undefined)).toBeUndefined();
        expect(extractChatLinks(undefined as unknown as string, 3)).toEqual([]);
        expect(withoutTrailingLink(undefined as unknown as string, "https://x.com")).toBeUndefined();
        expect(withoutPreview(undefined as unknown as string, ["https://x.com"])).toBeUndefined();
    });
});

describe("bodyShownWithCard", () => {
    const video = "https://www.youtube.com/watch?v=kkJ7wWidnp8";

    it("hides a video link that ends the message, and keeps other text", () => {
        expect(bodyShownWithCard(`watch this ${video}`)).toBe("watch this");
        expect(bodyShownWithCard("no link here")).toBe("no link here");
        expect(bodyShownWithCard("see https://example.com")).toBe("see https://example.com");
    });
});

describe("a GIF sent from the GIF picker", () => {
    const gif = "https://static.klipy.com/ii/abc/def/md.gif";

    it("is shown by its picture alone, without its address", () => {
        expect(bodyShownWithCard(gif)).toBe("");
        expect(bodyShownWithCard("https://media4.giphy.com/media/abc/giphy.gif")).toBe("");
        expect(bodyShownWithCard("https://media.tenor.com/abc/tenor.gif")).toBe("");
    });

    it("keeps the text that comes before it", () => {
        expect(bodyShownWithCard(`this one ${gif}`)).toBe("this one");
    });

    it("keeps the address of any other picture, and of a GIF site page that is not a picture", () => {
        expect(bodyShownWithCard("https://example.com/cat.gif")).toBe("https://example.com/cat.gif");
        expect(bodyShownWithCard("https://giphy.com/gifs/hello-abc")).toBe("https://giphy.com/gifs/hello-abc");
        expect(bodyShownWithCard("http://static.klipy.com/a.gif")).toBe("http://static.klipy.com/a.gif");
        expect(bodyShownWithCard("https://notklipy.com/a.gif")).toBe("https://notklipy.com/a.gif");
    });
});
