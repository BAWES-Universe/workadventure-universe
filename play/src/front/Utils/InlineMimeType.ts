// Ported from WorkAdventure 6a3595710; matches Element's ALLOWED_BLOB_MIMETYPES.
// Document types such as HTML and SVG must never become same-origin navigable blobs.
const INLINE_MIME_TYPES = new Set([
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
]);

export const DOWNLOAD_MIME_TYPE = "application/octet-stream";

/** The MIME type to give a blob URL built from a received attachment. */
export function sanitizeInlineMimeType(mimeType: string | undefined): string {
    const type = mimeType?.split(";")[0].trim().toLowerCase() ?? "";
    return INLINE_MIME_TYPES.has(type) ? type : DOWNLOAD_MIME_TYPE;
}

/** Keep media cards for older senders without a MIME type, but give active documents a usable download card. */
export function canRenderAttachmentInline(mimeType: unknown, filename: unknown): boolean {
    if (typeof mimeType === "string" && sanitizeInlineMimeType(mimeType) === DOWNLOAD_MIME_TYPE) return false;
    return typeof filename !== "string" || !/\.(svg|html?|xhtml|xml)$/i.test(filename);
}
