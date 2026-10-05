import type { ChatMessageContent, ChatMessageType } from "../../../Connection/ChatConnection";

/** The reactions offered in one tap, in the order they are shown (phones show all, the desktop bar the first three). */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"] as const;
export const DESKTOP_QUICK_REACTIONS = QUICK_REACTIONS.slice(0, 3);

const MEDIA_TYPES: ReadonlySet<ChatMessageType> = new Set(["image", "file", "audio", "video", "gallery"]);
const TEXT_TYPES: ReadonlySet<ChatMessageType> = new Set(["text", "proximity"]);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

export interface SaveableFile {
    url: string;
    name: string;
}

function extensionOf(url: string): string | undefined {
    const path = url.split("?")[0].split("#")[0];
    const lastSegment = path.split("/").pop() ?? "";
    if (!lastSegment.includes(".")) return undefined;
    return lastSegment.split(".").pop()?.toLowerCase();
}

function fileNameFromUrl(url: string): string {
    const path = url.split("?")[0].split("#")[0];
    const lastSegment = path.split("/").pop();
    if (!lastSegment) return "file";
    try {
        return decodeURIComponent(lastSegment);
    } catch {
        return lastSegment;
    }
}

export function isImageUrl(url: string): boolean {
    const extension = extensionOf(url);
    return extension !== undefined && IMAGE_EXTENSIONS.has(extension);
}

/**
 * Every file a message carries, with the name it was uploaded under where we know it.
 * A gallery keeps its first file in `url` and the others in `urls`; `fileNames` lists all names in that order.
 */
export function getSaveableFiles(type: ChatMessageType, content: ChatMessageContent): SaveableFile[] {
    if (!MEDIA_TYPES.has(type)) return [];
    const urls = [content.url, ...(content.urls ?? [])].filter(
        (url, index, all): url is string => !!url && all.indexOf(url) === index
    );
    return urls.map((url, index) => {
        let knownName = content.fileNames?.[index] ?? (index === 0 ? content.filename : undefined);
        // A Matrix file has no filename field: its body is the file name and its URL has no extension.
        if (!knownName && index === 0 && looksLikeFileName(content.body ?? "")) knownName = content.body.trim();
        return { url, name: knownName && knownName.trim() !== "" ? knownName : fileNameFromUrl(url) };
    });
}

function looksLikeFileName(text: string): boolean {
    return /^[^\n/\\]{1,200}\.[a-z0-9]{2,5}$/i.test(text.trim());
}

/** Plain text of a message body, which may hold HTML (Matrix). Parsing with DOMParser runs no script. */
export function bodyToPlainText(body: string): string {
    if (!/[<&]/.test(body)) return body.trim();
    const documentFromBody = new DOMParser().parseFromString(body, "text/html");
    return (documentFromBody.body.textContent ?? "").trim();
}

/** The text "Copy text" copies: the message, or the caption sent with a file. Undefined when there is none. */
export function getCopyableText(type: ChatMessageType, content: ChatMessageContent): string | undefined {
    if (!TEXT_TYPES.has(type) && !MEDIA_TYPES.has(type)) return undefined;
    const text = bodyToPlainText(content.body ?? "");
    if (text === "") return undefined;
    // A Matrix file's body is its file name, not a caption.
    if (MEDIA_TYPES.has(type) && getSaveableFiles(type, content).some((file) => file.name === text)) return undefined;
    return text;
}

export type ReplySummary =
    | { kind: "text"; text: string }
    | { kind: "photos"; count: number; thumbnail: string; caption: string | undefined }
    | { kind: "files"; count: number; name: string; caption: string | undefined }
    | { kind: "video" | "audio"; caption: string | undefined };

/** What a reply quotes, in a form the reply box and the quote can show: text, photos (with a thumbnail) or files. */
export function summarizeForReply(type: ChatMessageType, content: ChatMessageContent): ReplySummary {
    const caption = getCopyableText(type, content);
    if (!MEDIA_TYPES.has(type)) return { kind: "text", text: caption ?? "" };
    const files = getSaveableFiles(type, content);
    if (type === "video" || type === "audio") return { kind: type, caption };
    const images = files.filter((file) => isImageUrl(file.url));
    if (type === "image" || (images.length > 0 && images.length === files.length)) {
        return { kind: "photos", count: Math.max(files.length, 1), thumbnail: files[0]?.url ?? "", caption };
    }
    return { kind: "files", count: Math.max(files.length, 1), name: files[0]?.name ?? "", caption };
}

/** True when every saveable file is an image, so the menu can say "Save photo" instead of "Save file". */
export function areAllPhotos(files: SaveableFile[]): boolean {
    return files.length > 0 && files.every((file) => isImageUrl(file.url));
}
