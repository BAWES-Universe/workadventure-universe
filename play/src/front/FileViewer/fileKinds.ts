/** The ways the file viewer can show a file. Each reader is loaded only when a file of its kind opens. */
export type FileViewerKind = "pdf" | "image";

const KIND_BY_EXTENSION: Record<string, FileViewerKind> = {
    pdf: "pdf",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    bmp: "image",
    svg: "image",
};

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
};

/**
 * The kinds a chat file card opens in the viewer. Pictures in chat keep the picture viewer, and videos and audio keep
 * playing in the chat, so they are not listed. Zip, PowerPoint and old Word files stay downloads.
 */
export const CHAT_VIEWER_KINDS: ReadonlySet<FileViewerKind> = new Set<FileViewerKind>(["pdf"]);

/** The lower-case extension of a file name. A "#" or "?" in a name ("Invoice #12.pdf") is part of the name. */
export function extensionOf(name: string | undefined): string {
    if (!name) return "";
    const lastDot = name.lastIndexOf(".");
    const lastSlash = name.lastIndexOf("/");
    return lastDot > lastSlash ? name.slice(lastDot + 1).toLowerCase() : "";
}

/** The lower-case extension a link ends with, without its query or fragment. */
export function extensionOfLink(link: string | undefined): string {
    return extensionOf(link?.split(/[?#]/)[0]);
}

/** The kind of reader a file name asks for, or undefined when the viewer has none for it. */
export function fileKindOf(name: string | undefined): FileViewerKind | undefined {
    return KIND_BY_EXTENSION[extensionOf(name)];
}

/** The kind of reader a link asks for, or undefined when the viewer has none for it. */
export function fileKindOfLink(link: string | undefined): FileViewerKind | undefined {
    return KIND_BY_EXTENSION[extensionOfLink(link)];
}

/** Whether a tap on a chat card for this file opens the viewer (otherwise the card stays a download). */
export function chatFileOpensInViewer(name: string | undefined): boolean {
    const kind = fileKindOf(name);
    return kind !== undefined && CHAT_VIEWER_KINDS.has(kind);
}

export function imageMimeTypeOf(name: string | undefined): string {
    return IMAGE_MIME_BY_EXTENSION[extensionOf(name)] ?? "application/octet-stream";
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
    return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Whether the bytes are what the name says. A file that is not (a renamed web page, a cut-off download, a locked
 * file) is shown as "Can't preview this file" instead of being handed to a reader.
 */
export function bytesMatchKind(kind: FileViewerKind, name: string, bytes: Uint8Array): boolean {
    if (bytes.length === 0) return false;
    if (kind === "pdf") {
        // The header may follow a few bytes of junk, within the first kilobyte (what PDF readers accept).
        const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
        return head.includes("%PDF-");
    }
    switch (extensionOf(name)) {
        case "png":
            return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
        case "jpg":
        case "jpeg":
            return startsWith(bytes, [0xff, 0xd8, 0xff]);
        case "gif":
            return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
        case "webp":
            return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
        case "bmp":
            return startsWith(bytes, [0x42, 0x4d]);
        case "svg": {
            const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
            return /<svg[\s>]/i.test(head);
        }
        default:
            return false;
    }
}

/** "2.4 MB", "310 KB": the size shown on a chat card. */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const megabytes = bytes / (1024 * 1024);
    return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}
