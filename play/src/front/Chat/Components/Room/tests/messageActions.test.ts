import { describe, expect, it } from "vitest";
import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import { areAllPhotos, getCopyableText, getSaveableFiles, summarizeForReply } from "../MessageActions/messageActions";

function content(partial: Partial<ChatMessageContent>): ChatMessageContent {
    return { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined, ...partial };
}

describe("message actions", () => {
    it("saves every photo of a gallery under its uploaded name, not only the first", () => {
        const gallery = content({
            url: "https://cdn.example/a1b2.png",
            urls: ["https://cdn.example/c3d4.jpg"],
            fileNames: ["IMG_2511.png", "IMG_2512.jpg"],
        });
        expect(getSaveableFiles("gallery", gallery)).toEqual([
            { url: "https://cdn.example/a1b2.png", name: "IMG_2511.png" },
            { url: "https://cdn.example/c3d4.jpg", name: "IMG_2512.jpg" },
        ]);
        expect(areAllPhotos(getSaveableFiles("gallery", gallery))).toBe(true);
    });

    it("uses a Matrix file's body as its name, since its URL has no extension", () => {
        const matrixImage = content({
            body: "Holiday photo.png",
            url: "https://matrix.example/_matrix/media/v3/download/x/abc",
        });
        expect(getSaveableFiles("image", matrixImage)[0].name).toBe("Holiday photo.png");
        // ...and that name is not offered as text to copy.
        expect(getCopyableText("image", matrixImage)).toBeUndefined();
    });

    it("falls back to the URL's last segment when no name is known", () => {
        expect(getSaveableFiles("file", content({ url: "https://cdn.example/files/report%201.pdf?x=1" }))[0].name).toBe(
            "report 1.pdf"
        );
    });

    it("offers nothing to save on a text message", () => {
        expect(getSaveableFiles("proximity", content({ body: "hello" }))).toEqual([]);
    });

    it("copies the text of a message, or the caption sent with a photo", () => {
        expect(getCopyableText("proximity", content({ body: "  Meeting at 3  " }))).toBe("Meeting at 3");
        expect(
            getCopyableText(
                "image",
                content({ body: "Look at this", url: "https://cdn.example/a.png", filename: "a.png" })
            )
        ).toBe("Look at this");
        expect(getCopyableText("gallery", content({ url: "https://cdn.example/a.png" }))).toBeUndefined();
    });

    it("strips HTML from a formatted Matrix body before copying", () => {
        expect(getCopyableText("text", content({ body: "<p>Hello <b>there</b> &amp; welcome</p>" }))).toBe(
            "Hello there & welcome"
        );
    });

    it("describes a gallery reply as photos with a thumbnail instead of an empty box", () => {
        const summary = summarizeForReply(
            "gallery",
            content({ url: "https://cdn.example/a.png", urls: ["https://cdn.example/b.jpg"] })
        );
        expect(summary).toEqual({
            kind: "photos",
            count: 2,
            thumbnail: "https://cdn.example/a.png",
            caption: undefined,
        });
    });

    it("describes a file reply by its name", () => {
        const summary = summarizeForReply(
            "file",
            content({ url: "https://cdn.example/x.pdf", filename: "Quest plan.pdf" })
        );
        expect(summary).toEqual({ kind: "files", count: 1, name: "Quest plan.pdf", caption: undefined });
    });

    it("describes a text reply by its text", () => {
        expect(summarizeForReply("proximity", content({ body: "Hi" }))).toEqual({ kind: "text", text: "Hi" });
    });
});
