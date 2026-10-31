import type { ChatMessage } from "../../../Connection/ChatConnection";
import { chatLinksIn } from "../../../LinkPreview/ChatLinks";
import type { SharedTab } from "../../../Stores/ChatDetailsStore";
import { chatTime } from "../MessageTime";

export interface SharedItem {
    /** Unique in its list: a message can carry several links. */
    key: string;
    message: ChatMessage;
    /** A file's name, or the link itself. */
    name: string;
    /** For a link: where it goes. */
    url?: string;
    /** For a file, in bytes, when the message says. */
    size?: number;
    /** For an image or video: whether it is a video. */
    isVideo?: boolean;
    /** For one image or file of a gallery, which holds several in one message: its own link. */
    src?: string;
    /** Shared in a proximity chat, listed in a direct chat beside its own items (#1615). */
    nearby?: boolean;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "heic", "heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov", "avi", "mkv"]);

function extensionOf(nameOrUrl: string): string | undefined {
    const name = nameOrUrl.split("?")[0].split("#")[0].split("/").pop() ?? "";
    return name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
}

/** What one file of a gallery is, by its name or else its link: an image, a video, or any other file. */
function galleryFileKind(url: string, name: string): "image" | "video" | "file" {
    const extension = extensionOf(name) ?? extensionOf(url) ?? "";
    if (IMAGE_EXTENSIONS.has(extension)) return "image";
    if (VIDEO_EXTENSIONS.has(extension)) return "video";
    return "file";
}

export type SharedItems = Record<SharedTab, SharedItem[]>;

/** The key of one file in a gallery message, by its place among the message's files. */
export function galleryFileKey(messageId: string, position: number): string {
    return `${messageId} ${position}`;
}

/**
 * What a chat shared, newest first: images and videos, links, and files. Voice messages stay in the conversation, and
 * deleted messages are left out. `bodyOf` gives a text message's current text (its edits included), and `filesOf` a
 * gallery's images (nearby chat sends several in one message).
 */
export function sharedItemsOf(
    messages: readonly ChatMessage[],
    bodyOf: (message: ChatMessage) => string | undefined,
    isDeleted: (message: ChatMessage) => boolean,
    filesOf: (message: ChatMessage) => { url: string; name: string }[] = () => []
): SharedItems {
    const shared: SharedItems = { media: [], links: [], files: [] };
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (isDeleted(message)) continue;
        const file = message.sharedFile;
        if ((message.type === "image" || message.type === "video") && file) {
            shared.media.push({
                key: message.id,
                message,
                name: file.name,
                size: file.size,
                isVideo: message.type === "video",
            });
        } else if (message.type === "gallery") {
            // A gallery can mix images with other files: each goes to its own tab.
            filesOf(message).forEach(({ url, name }, position) => {
                const kind = galleryFileKind(url, name);
                const key = galleryFileKey(message.id, position);
                if (kind === "file") {
                    shared.files.push({ key, message, name, src: url });
                } else {
                    shared.media.push({ key, message, name, src: url, isVideo: kind === "video" });
                }
            });
        } else if ((message.type === "file" || message.type === "audio") && file && !file.voice) {
            shared.files.push({ key: message.id, message, name: file.name, size: file.size });
        } else if (message.type === "text" || message.type === "proximity") {
            for (const url of chatLinksIn(bodyOf(message))) {
                shared.links.push({ key: `${message.id} ${url}`, message, name: url, url });
            }
        }
    }
    return shared;
}

/** The first tab with something in it, so the page never opens on an empty tab when another has items. */
export function firstFilledTab(shared: SharedItems): SharedTab {
    if (shared.media.length > 0) return "media";
    if (shared.links.length > 0) return "links";
    if (shared.files.length > 0) return "files";
    return "media";
}

export type SharedSection =
    | { kind: "thisWeek" }
    | { kind: "lastWeek" }
    | { kind: "thisMonth" }
    | { kind: "month"; month: number; year: number }
    | { kind: "undated" };

function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Which heading a shared item goes under, from when it was sent: this week, last week, earlier this month, its month. */
export function sharedSectionOf(date: Date | null, now: Date): SharedSection {
    if (!date) return { kind: "undated" };
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (days < 7) return { kind: "thisWeek" };
    if (days < 14) return { kind: "lastWeek" };
    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return { kind: "thisMonth" };
    return { kind: "month", month: date.getMonth(), year: date.getFullYear() };
}

function sameSection(a: SharedSection, b: SharedSection): boolean {
    if (a.kind !== b.kind) return false;
    return a.kind !== "month" || (b.kind === "month" && a.month === b.month && a.year === b.year);
}

/**
 * The items under their headings, in the order they come (newest first). Each heading shows once: an item out of date
 * order (a late or backfilled message) joins its heading where it first appeared.
 */
export function sharedSections(
    items: readonly SharedItem[],
    now: Date
): { section: SharedSection; items: SharedItem[] }[] {
    const sections: { section: SharedSection; items: SharedItem[] }[] = [];
    for (const item of items) {
        const section = sharedSectionOf(item.message.date, now);
        const same = sections.find((one) => sameSection(one.section, section));
        if (same) same.items.push(item);
        else sections.push({ section, items: [item] });
    }
    return sections;
}

/** When a shared item was sent, short: the time today, then "Yesterday", the weekday this week, else the date. */
export function sentLabel(date: Date | null, locale: string, now: Date = new Date()): string {
    if (!date) return "";
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (days === 0) return chatTime(date, locale);
    if (days === 1) {
        const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
        return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
    }
    if (days > 1 && days < 7) return date.toLocaleDateString(locale, { weekday: "short" });
    return date.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    });
}
