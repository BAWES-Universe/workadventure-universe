import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAttachmentUrl, getAttachmentOpenUrl, revokeAttachmentUrl } from "./AttachmentUrls";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
});

describe("SVG attachment URLs", () => {
    it("preserves the original SVG bytes in an image URL and opens only fixed image-viewer markup", async () => {
        const original =
            '<svg xmlns="http://www.w3.org/2000/svg"><script>window.bad=true</script><text>عالم 🌍</text></svg>';
        const urls: string[] = [];
        const created: Blob[] = [];
        URL.createObjectURL = vi.fn((blob: Blob) => {
            created.push(blob);
            const url = `blob:viewer-${created.length}`;
            urls.push(url);
            return url;
        });
        const image = createAttachmentUrl(new TextEncoder().encode(original).buffer, "Image/SVG+XML; charset=utf-8");
        expect(image).toMatch(/^data:image\/svg\+xml;base64,/);
        const bytes = Uint8Array.from(atob(image.split(",")[1]), (c) => c.charCodeAt(0));
        expect(new TextDecoder().decode(bytes)).toBe(original);
        expect(created).toHaveLength(1);
        expect(created[0].type).toBe("text/html");
        expect(getAttachmentOpenUrl(image)).toBe(urls[0]);
        const markup = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
            reader.readAsText(created[0]);
        });
        expect(markup).toContain(`<img src="${image}"`);
        expect(markup).toContain("Content-Security-Policy");
        expect(markup).not.toContain("<script>");
        revokeAttachmentUrl(image);
    });

    it("keeps a shared viewer until every cached copy is released", () => {
        const create = vi.fn(() => "blob:shared-svg-viewer");
        URL.createObjectURL = create;
        const revoke = vi.fn();
        URL.revokeObjectURL = revoke;
        const data = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>').buffer;
        const first = createAttachmentUrl(data, "image/svg+xml");
        const second = createAttachmentUrl(data, "image/svg+xml");
        expect(first).toBe(second);
        expect(create).toHaveBeenCalledTimes(1);
        revokeAttachmentUrl(first);
        expect(revoke).not.toHaveBeenCalled();
        expect(getAttachmentOpenUrl(second)).toBe("blob:shared-svg-viewer");
        revokeAttachmentUrl(second);
        expect(revoke).toHaveBeenCalledWith("blob:shared-svg-viewer");
    });

    it("leaves ordinary image and media links unchanged", () => {
        expect(getAttachmentOpenUrl("blob:photo")).toBe("blob:photo");
        expect(getAttachmentOpenUrl("https://cdn.test/photo.png")).toBe("https://cdn.test/photo.png");
        expect(getAttachmentOpenUrl(undefined)).toBeUndefined();
    });
});
