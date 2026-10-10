import { describe, expect, it } from "@jest/globals";
import { DEFAULT_MIME_TYPE, mimeTypeManager } from "../src/Service/MimeType";

describe("uploaded filename policy", () => {
    it("keeps short extensions and normalizes case", () => {
        expect(mimeTypeManager.getExtensionByFileName("photo.PNG")).toBe("png");
        expect(mimeTypeManager.getExtensionByFileName("archive.tar.gz")).toBe("gz");
    });

    it.each(["README", "file.", "poc.html/../../evil", "poc.ht ml", "poc.html\r\n", "poc.abcdefghijklmnopq"])(
        "does not put unsafe extension syntax from %j into a key or header",
        (name) => {
            expect(mimeTypeManager.getExtensionByFileName(name)).toBeUndefined();
            expect(mimeTypeManager.getSafeMimeTypeByFileName(name)).toBe(DEFAULT_MIME_TYPE);
        }
    );

    it.each(["html", "htm", "xhtml", "xml", "js", "pdf", "txt", "unknown"])(
        "serves .%s as a download",
        (extension) => {
            expect(mimeTypeManager.getSafeMimeTypeByFileName(`file.${extension}`)).toBe(DEFAULT_MIME_TYPE);
            expect(mimeTypeManager.getContentDispositionByFileName(`file.${extension}`)).toBe("attachment");
        }
    );

    it.each(["svg", "SVG", "svgz"])("keeps .%s image previews but forces standalone downloads", (extension) => {
        expect(mimeTypeManager.getSafeMimeTypeByFileName(`file.${extension}`)).toBe("image/svg+xml");
        expect(mimeTypeManager.getContentDispositionByFileName(`file.${extension}`)).toBe("attachment");
    });
});
