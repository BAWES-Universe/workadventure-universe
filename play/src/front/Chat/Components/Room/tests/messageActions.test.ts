import { describe, expect, it } from "vitest";
import type { ChatMessageContent } from "../../../Connection/ChatConnection";
import {
    areAllPhotos,
    getCopyableText,
    getMediaCaption,
    getSaveableFiles,
    previewLine,
    summarizeForReply,
} from "../MessageActions/messageActions";

function content(partial: Partial<ChatMessageContent>): ChatMessageContent {
    return { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined, ...partial };
}

describe("message actions", () => {
    it("keeps an SVG data image as a photo for replies, saving and mobile preparation", () => {
        const svg = "data:image/svg+xml;base64,PHN2Zy8+";
        const image = content({ body: "Our logo", url: svg, filename: "logo.svg" });
        expect(getSaveableFiles("image", image)).toEqual([{ url: svg, name: "logo.svg" }]);
        expect(areAllPhotos(getSaveableFiles("image", image))).toBe(true);
        expect(summarizeForReply("image", image)).toEqual({
            kind: "photos",
            count: 1,
            thumbnail: svg,
            caption: "Our logo",
        });
    });

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

    it("saves a file listed twice once, and keeps every other name with its own file", () => {
        const gallery = content({
            url: "https://cdn.example/a1b2.png",
            urls: ["https://cdn.example/a1b2.png", "https://cdn.example/c3d4.jpg"],
            fileNames: ["IMG_2511.png", "IMG_2511 copy.png", "IMG_2512.jpg"],
        });
        expect(getSaveableFiles("gallery", gallery)).toEqual([
            { url: "https://cdn.example/a1b2.png", name: "IMG_2511.png" },
            { url: "https://cdn.example/c3d4.jpg", name: "IMG_2512.jpg" },
        ]);
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

    it("names an SVG picture with no known name image.svg, not part of its data", () => {
        const svg = "data:image/svg+xml;base64,PHN2Zy8+";
        expect(getSaveableFiles("image", content({ url: svg }))).toEqual([{ url: svg, name: "image.svg" }]);
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

    describe("the caption under a picture or video", () => {
        it("is not the file name a Matrix picture carries as its body", () => {
            expect(getMediaCaption(content({ body: "image.png", filename: "image.png" }))).toBeUndefined();
            expect(getMediaCaption(content({ body: " image.png ", filename: "image.png" }))).toBeUndefined();
        });

        it("is the text a sender typed, with or without a file name beside it", () => {
            expect(getMediaCaption(content({ body: "Our logo", filename: "logo.svg" }))).toBe("Our logo");
            // Nearby chat and bots: the file name is separate, the body is the caption.
            expect(getMediaCaption(content({ body: "Look at this" }))).toBe("Look at this");
        });

        it("is empty without text", () => {
            expect(getMediaCaption(content({ body: "", filename: "photo.png" }))).toBeUndefined();
            expect(getMediaCaption(content({ body: "   " }))).toBeUndefined();
        });
    });
});

describe("the line a chat list row and a notification show", () => {
    const labels = {
        photo: "Photo",
        photos: (count: number) => `${count} photos`,
        video: "Video",
        voice: "Voice",
        audio: "Audio",
    };

    it("says Photo for an image whose body is its file name", () => {
        const image = content({ body: "IMG_4821.jpg", filename: "IMG_4821.jpg", url: "blob:chat/a1" });
        expect(previewLine("image", image, labels)).toBe("Photo");
    });

    it("says Photo for a Matrix image that has no filename field, only the name as body", () => {
        const image = content({ body: "image.png", url: "blob:chat/a2" });
        expect(previewLine("image", image, labels)).toBe("Photo");
    });

    it("shows the caption of an image sent with one", () => {
        const image = content({ body: "Look at the new map!", filename: "IMG_5530.jpg", url: "blob:chat/a3" });
        expect(previewLine("image", image, labels)).toBe("Look at the new map!");
    });

    it("says Video for a video and keeps its caption", () => {
        const video = content({ body: "VID_1930.mp4", filename: "VID_1930.mp4", url: "blob:chat/b1" });
        expect(previewLine("video", video, labels)).toBe("Video");
        expect(previewLine("video", { ...video, body: "Mariam at the HQ" }, labels)).toBe("Mariam at the HQ");
    });

    it("tells a voice message from an audio file", () => {
        const voice = content({
            body: "voice-message.ogg",
            filename: "voice-message.ogg",
            url: "blob:chat/c1",
            isVoice: true,
        });
        const song = content({ body: "Interview-final.mp3", filename: "Interview-final.mp3", url: "blob:chat/c2" });
        expect(previewLine("audio", voice, labels)).toBe("Voice");
        expect(previewLine("audio", song, labels)).toBe("Audio");
    });

    it("keeps the file name of a document", () => {
        const pdf = content({ body: "Budget-Q4.pdf", filename: "Budget-Q4.pdf", url: "blob:chat/d1" });
        expect(previewLine("file", pdf, labels)).toBe("Budget-Q4.pdf");
    });

    it("keeps the text of a text message, as plain text", () => {
        expect(previewLine("text", content({ body: "See you at the HQ in five" }), labels)).toBe(
            "See you at the HQ in five"
        );
        expect(previewLine("text", content({ body: "<b>bold</b> news" }), labels)).toBe("bold news");
    });

    it("counts the photos of a gallery", () => {
        const gallery = content({
            body: "a.jpg",
            url: "blob:chat/e1.jpg",
            urls: ["blob:chat/e2.jpg"],
            fileNames: ["a.jpg", "b.jpg"],
        });
        expect(previewLine("gallery", gallery, labels)).toBe("2 photos");
    });
});
