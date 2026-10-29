import { describe, expect, it } from "vitest";
import {
    badgeOfKind,
    bytesMatchKind,
    chatFileOpensInViewer,
    extensionOf,
    extensionOfLink,
    fileKindOf,
    formatFileSize,
    imageMimeTypeOf,
    MAP_VIEWER_KINDS as mapFileKinds,
} from "../fileKinds";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("picking how a file is shown", () => {
    it("reads the extension of a name, keeping a # or ? that is part of it", () => {
        expect(extensionOf("Q3 roadmap.PDF")).toBe("pdf");
        expect(extensionOf("Invoice #12.pdf")).toBe("pdf");
        expect(extensionOf("Is this final?.docx")).toBe("docx");
        expect(extensionOf("notes")).toBe("");
        expect(extensionOf(undefined)).toBe("");
        expect(chatFileOpensInViewer("Invoice #12.pdf")).toBe(true);
    });

    it("reads the extension of a link, without its query or fragment", () => {
        expect(extensionOfLink("https://maps.example.com/files/plan.pdf?token=a.b.c#page=2")).toBe("pdf");
        expect(extensionOfLink("https://example.com/v1.2/readme")).toBe("");
        expect(extensionOfLink("https://example.md")).toBe("");
        expect(extensionOfLink("https://example.com/notes.md")).toBe("md");
        expect(extensionOfLink(undefined)).toBe("");
    });

    it("shows PDFs, pictures and Word files, and nothing else yet", () => {
        expect(fileKindOf("plan.pdf")).toBe("pdf");
        for (const name of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.bmp", "a.svg"]) {
            expect(fileKindOf(name)).toBe("image");
        }
        expect(fileKindOf("a.docx")).toBe("word");
        expect(fileKindOf("a.doc")).toBe("oldword");
        for (const name of ["a.zip", "a.pptx", "a.exe", "a.rs", "a"]) {
            expect(fileKindOf(name)).toBeUndefined();
        }
        for (const name of ["a.js", "a.ts", "a.html", "a.css", "a.py", "a.yml", "a.sh", "a.sql"]) {
            expect(fileKindOf(name)).toBe("code");
        }
        // Markdown, JSON and SVG keep their own readers.
        expect(fileKindOf("a.md")).toBe("markdown");
        expect(fileKindOf("a.json")).toBe("json");
        expect(fileKindOf("a.svg")).toBe("image");
    });

    it("opens only PDFs from a chat card: pictures keep the picture viewer, other files stay downloads", () => {
        expect(chatFileOpensInViewer("plan.pdf")).toBe(true);
        expect(chatFileOpensInViewer("photo.png")).toBe(false);
        expect(chatFileOpensInViewer("archive.zip")).toBe(false);
        expect(chatFileOpensInViewer("slides.pptx")).toBe(false);
        expect(chatFileOpensInViewer("page.html")).toBe(true);
        expect(chatFileOpensInViewer("welcome.ts")).toBe(true);
        expect(chatFileOpensInViewer("program.exe")).toBe(false);
        expect(chatFileOpensInViewer(undefined)).toBe(false);
    });

    it("plays audio in the window, while an audio card in the chat keeps playing there", () => {
        for (const name of ["a.mp3", "a.M4A", "a.wav", "a.ogg", "a.oga", "a.opus", "a.aac", "a.flac", "a.weba"]) {
            expect(fileKindOf(name)).toBe("audio");
        }
        expect(chatFileOpensInViewer("song.mp3")).toBe(false);
        // A map's "Open file" is unchanged.
        expect(mapFileKinds.has("audio")).toBe(false);
    });

    it("badges audio with its own ending, in words too, as its name is often just Audio", () => {
        expect(badgeOfKind("audio", "447c3eec.mp3")).toEqual({ label: "MP3", color: "#c2571a", kindName: "MP3" });
        expect(badgeOfKind("audio", "take.m4a")).toMatchObject({ label: "M4A", kindName: "M4A" });
        expect(badgeOfKind("audio", undefined)).toMatchObject({ label: "MP3", kindName: "Audio" });
    });

    it("gives pictures their own type, and anything else a download type", () => {
        expect(imageMimeTypeOf("a.svg")).toBe("image/svg+xml");
        expect(imageMimeTypeOf("a.JPG")).toBe("image/jpeg");
        expect(imageMimeTypeOf("a.pdf")).toBe("application/octet-stream");
    });
});

describe("checking a file is what its name says", () => {
    it("accepts a PDF with its header, even after a few bytes of junk", () => {
        expect(bytesMatchKind("pdf", "a.pdf", text("%PDF-1.7\n1 0 obj"))).toBe(true);
        expect(bytesMatchKind("pdf", "a.pdf", text("\u0000\u0000junk%PDF-1.4"))).toBe(true);
    });

    it("refuses a web page, an empty file or a cut-off file named .pdf", () => {
        expect(bytesMatchKind("pdf", "a.pdf", text("<!doctype html><script>alert(1)</script>"))).toBe(false);
        expect(bytesMatchKind("pdf", "a.pdf", new Uint8Array())).toBe(false);
        expect(bytesMatchKind("pdf", "a.pdf", text("PK\u0003\u0004 a zip"))).toBe(false);
    });

    it("accepts each picture type by its signature and refuses a mismatch", () => {
        expect(bytesMatchKind("image", "a.png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe(true);
        expect(bytesMatchKind("image", "a.jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
        expect(bytesMatchKind("image", "a.gif", text("GIF89a"))).toBe(true);
        expect(bytesMatchKind("image", "a.bmp", text("BM6"))).toBe(true);
        expect(bytesMatchKind("image", "a.webp", text("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe(true);
        expect(
            bytesMatchKind("image", "a.svg", text('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))
        ).toBe(true);
        expect(bytesMatchKind("image", "a.png", text("%PDF-1.7"))).toBe(false);
        expect(bytesMatchKind("image", "a.svg", text("<html><body>not a picture</body></html>"))).toBe(false);
    });
});

describe("the size on a chat card", () => {
    it("rounds to a short readable size", () => {
        expect(formatFileSize(512)).toBe("512 B");
        expect(formatFileSize(310 * 1024)).toBe("310 KB");
        expect(formatFileSize(1)).toBe("1 B");
        expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
        expect(formatFileSize(48 * 1024 * 1024)).toBe("48 MB");
    });
});
