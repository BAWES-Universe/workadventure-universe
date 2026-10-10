import { describe, expect, it } from "vitest";
import { DOWNLOAD_MIME_TYPE, canRenderAttachmentInline, sanitizeInlineMimeType } from "./InlineMimeType";

describe("sanitizeInlineMimeType", () => {
    it.each([
        "image/jpeg",
        "image/gif",
        "image/png",
        "image/apng",
        "image/webp",
        "image/avif",
        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime",
        "audio/mp4",
        "audio/webm",
        "audio/aac",
        "audio/mpeg",
        "audio/ogg",
        "audio/wave",
        "audio/wav",
        "audio/x-wav",
        "audio/x-pn-wav",
        "audio/flac",
        "audio/x-flac",
        // Passive types phones and other chat apps send.
        "image/jpg",
        "image/bmp",
        "image/heic",
        "audio/x-m4a",
        "audio/mp3",
        "audio/opus",
        "video/x-m4v",
        "video/3gpp",
    ])("keeps supported media type %s", (type) => {
        expect(sanitizeInlineMimeType(type)).toBe(type);
    });

    it("normalizes case, whitespace and parameters", () => {
        expect(sanitizeInlineMimeType(" Image/PNG ; charset=binary")).toBe("image/png");
        expect(sanitizeInlineMimeType("AUDIO/MPEG; codecs=mp3")).toBe("audio/mpeg");
    });

    it.each([
        "image/svg+xml",
        "IMAGE/SVG+XML; charset=utf-8",
        "text/html",
        "text/html; charset=utf-8",
        "application/xhtml+xml",
        "application/xml",
        "text/xml",
        "application/javascript",
        "text/javascript",
        "application/pdf",
        "image/unknown",
        "video/unknown",
        "audio/unknown",
        "",
        undefined,
    ])("forces unsupported type %s to download", (type) => {
        expect(sanitizeInlineMimeType(type)).toBe(DOWNLOAD_MIME_TYPE);
    });
});

describe("canRenderAttachmentInline", () => {
    it.each(["image/png", "audio/mpeg", "video/mp4", "image/bmp", "image/heic", "audio/x-m4a", "video/3gpp"])(
        "keeps %s media cards",
        (type) => {
            expect(canRenderAttachmentInline(type, "attachment")).toBe(true);
        }
    );

    it("keeps vector SVG previews, including older senders", () => {
        expect(canRenderAttachmentInline("image/svg+xml", "logo.svg")).toBe(true);
        expect(canRenderAttachmentInline(undefined, "logo.SVG")).toBe(true);
    });

    it("keeps media cards when older senders omit the MIME type", () => {
        expect(canRenderAttachmentInline(undefined, "photo.png")).toBe(true);
        expect(canRenderAttachmentInline(undefined, "recording.wav")).toBe(true);
        expect(canRenderAttachmentInline(undefined, "clip.mp4")).toBe(true);
    });

    it.each(["text/html", "application/xhtml+xml", "audio/unknown"])(
        "shows a download card for %s even with a misleading filename",
        (type) => expect(canRenderAttachmentInline(type, "photo.png")).toBe(false)
    );

    it.each(["page.html", "page.htm", "page.xhtml", "document.xml"])(
        "shows a download card for %s even without a MIME type",
        (filename) => expect(canRenderAttachmentInline(undefined, filename)).toBe(false)
    );
});
