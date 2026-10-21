/** The ways the file viewer can show a file. Each reader is loaded only when a file of its kind opens. */
export type FileViewerKind = "pdf" | "image" | "markdown" | "text" | "json" | "csv" | "word" | "oldword";

const KIND_BY_EXTENSION: Record<string, FileViewerKind> = {
    pdf: "pdf",
    md: "markdown",
    txt: "text",
    json: "json",
    csv: "csv",
    docx: "word",
    // Word 97 to 2003: the viewer opens to say it cannot show these, and offers the download.
    doc: "oldword",
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
export const CHAT_VIEWER_KINDS: ReadonlySet<FileViewerKind> = new Set<FileViewerKind>([
    "pdf",
    "markdown",
    "text",
    "json",
    "csv",
    "word",
    "oldword",
]);

/** The kinds a map's "Open file" shows in the viewer: the formats the map editor lets a map maker upload. */
export const MAP_VIEWER_KINDS: ReadonlySet<FileViewerKind> = new Set<FileViewerKind>(["pdf", "image"]);

/** The kinds that are text the viewer decodes itself (no reader library). */
export const TEXT_KINDS: ReadonlySet<FileViewerKind> = new Set<FileViewerKind>(["markdown", "text", "json", "csv"]);

/** The kinds a browser has no viewer for, so "Open in new tab" has nothing to open (Ctrl or Cmd click saves them). */
export const NO_BROWSER_VIEWER_KINDS: ReadonlySet<FileViewerKind> = new Set<FileViewerKind>([
    ...TEXT_KINDS,
    "word",
    "oldword",
]);

/** The lower-case extension of a file name or link, without its query or fragment. */
export function extensionOf(nameOrLink: string | undefined): string {
    if (!nameOrLink) return "";
    const path = nameOrLink.split(/[?#]/)[0];
    const lastDot = path.lastIndexOf(".");
    const lastSlash = path.lastIndexOf("/");
    return lastDot > lastSlash ? path.slice(lastDot + 1).toLowerCase() : "";
}

/** The kind of reader a file name or link asks for, or undefined when the viewer has none for it. */
export function fileKindOf(nameOrLink: string | undefined): FileViewerKind | undefined {
    return KIND_BY_EXTENSION[extensionOf(nameOrLink)];
}

/** Whether a tap on a chat card for this file opens the viewer (otherwise the card stays a download). */
export function chatFileOpensInViewer(name: string | undefined): boolean {
    const kind = fileKindOf(name);
    return kind !== undefined && CHAT_VIEWER_KINDS.has(kind);
}

export function imageMimeTypeOf(nameOrLink: string | undefined): string {
    return IMAGE_MIME_BY_EXTENSION[extensionOf(nameOrLink)] ?? "application/octet-stream";
}

export interface FileBadge {
    /** The short text on the badge. */
    label: string;
    color: string;
    /** The file's kind in words, after the badge on a chat card ("Markdown · 3 KB"). */
    kindName: string;
}

const BADGE_BY_KIND: Record<FileViewerKind, FileBadge> = {
    pdf: { label: "PDF", color: "#E53935", kindName: "PDF" },
    image: { label: "IMG", color: "#5b6b82", kindName: "Picture" },
    markdown: { label: "MD", color: "#5b6b82", kindName: "Markdown" },
    text: { label: "TXT", color: "#5b6b82", kindName: "Text" },
    json: { label: "JSON", color: "#5b6b82", kindName: "JSON" },
    csv: { label: "CSV", color: "#1e7145", kindName: "CSV" },
    word: { label: "DOCX", color: "#2b579a", kindName: "Word" },
    oldword: { label: "DOC", color: "#2b579a", kindName: "Word" },
};

/** The badge of a file the viewer opens, from its kind. */
export function badgeOfKind(kind: FileViewerKind): FileBadge {
    return BADGE_BY_KIND[kind];
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
    return signature.every((value, index) => bytes[offset + index] === value);
}

/** Text in a Unicode form: UTF-8 (with or without a byte order mark) or UTF-16 with one. Other bytes are not text. */
export function textEncodingOf(bytes: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
    return "utf-8";
}

function looksLikeText(bytes: Uint8Array): boolean {
    // A zero byte in the first few kilobytes is a binary file (UTF-16 text has them by design, and says so up front).
    if (textEncodingOf(bytes) !== "utf-8") return true;
    return !bytes.subarray(0, 8192).includes(0);
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
    if (TEXT_KINDS.has(kind)) return looksLikeText(bytes);
    // A Word file is a zip: "PK" and a record number.
    if (kind === "word") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    if (kind === "oldword") return false;
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
