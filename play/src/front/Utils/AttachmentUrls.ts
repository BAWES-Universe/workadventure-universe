import { sanitizeInlineMimeType } from "./InlineMimeType";

const SVG_DATA_PREFIX = "data:image/svg+xml;base64,";
const svgViewers = new Map<string, { url: string; references: number }>();

export function isSvgAttachmentUrl(url: string): boolean {
    return url.startsWith(SVG_DATA_PREFIX);
}

/** SVG stays a vector image, but its bytes never get a navigable blob at the application's origin. */
export function createAttachmentUrl(buffer: ArrayBuffer, mimeType: string | undefined): string {
    if (mimeType?.split(";")[0].trim().toLowerCase() !== "image/svg+xml") {
        return URL.createObjectURL(new Blob([buffer], { type: sanitizeInlineMimeType(mimeType) }));
    }
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let start = 0; start < bytes.length; start += 8192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    }
    // data: documents have opaque origins. In an <img>, SVG scripting is disabled as usual.
    const imageUrl = SVG_DATA_PREFIX + btoa(binary);
    const existing = svgViewers.get(imageUrl);
    if (existing) {
        existing.references++;
    } else {
        // Only base64 data enters this fixed markup: never interpolate the sender's SVG as HTML.
        // A separate tab is an image viewer too, rather than an active SVG document.
        const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0;background:#0e0e0e;display:flex;min-height:100vh;align-items:center;justify-content:center}img{max-width:100%;height:auto}</style><img src="${imageUrl}" alt="">`;
        svgViewers.set(imageUrl, { url: URL.createObjectURL(new Blob([html], { type: "text/html" })), references: 1 });
    }
    return imageUrl;
}

/** Native new-tab/middle-click navigation must use the passive viewer, while previews and saving use the image. */
export function getAttachmentOpenUrl(url: string | undefined): string | undefined {
    return url === undefined ? undefined : svgViewers.get(url)?.url ?? url;
}

export function revokeAttachmentUrl(url: string): void {
    const viewer = svgViewers.get(url);
    if (viewer && --viewer.references === 0) {
        URL.revokeObjectURL(viewer.url);
        svgViewers.delete(url);
    }
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}
