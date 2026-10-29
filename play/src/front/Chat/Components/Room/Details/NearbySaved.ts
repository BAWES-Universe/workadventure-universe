import { readable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import type { AnyKindOfUser, ChatMessage, ChatMessageReaction } from "../../../Connection/ChatConnection";
import type { SharedItem, SharedItems } from "./SharedItems";

/**
 * What a nearby chat shared, kept on the player's account in Orbit (#1424): the nearby chat itself forgets everything
 * when the tab closes. These turn what the chat shows into the rows Orbit keeps, and the rows back into items.
 */
export interface SavedNearbyItem {
    /** The item's key in the chat's "Media, links and files", so the same item is kept once. */
    itemKey: string;
    kind: "media" | "link" | "file";
    name: string;
    /** Where a link goes, or the link of an image, video or file that isn't an uploader file. */
    link: string | null;
    /** An uploader file in a chat bucket, as "bucket/id": its link expires, so it is opened through the uploader. */
    fileId: string | null;
    mimeType: string | null;
    size: number | null;
    isVideo: boolean;
    senderName: string;
    /** The sender's chat account, so the item shows in their profile (#1615). Absent from items kept before. */
    senderChatId?: string | null;
    mine: boolean;
    /** The chat accounts of the others in the chat when it was shared, so what you sent shows in their profiles. */
    withChatIds?: string[];
    /** ISO time. */
    sentAt: string;
}

// The uploader keeps an extension of up to 16 characters (its MimeType.ts), so "x.webmanifest" is one of its files too.
const UPLOADER_FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/i;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const MAX_KEY = 300;
const MAX_NAME = 300;
const MAX_SENDER = 100;
const MAX_LINK = 2000;
// As Orbit takes them: a Matrix chat account, and at most this many others in one chat.
const CHAT_ID = /^@[^\s:]{1,200}:[^\s]{1,200}$/;
const MAX_WITH = 50;

/** A chat account Orbit takes, or nothing: one it would turn down would cost the whole item. */
export function keptChatId(chatId: string | null | undefined): string | null {
    return chatId && chatId.length <= 255 && CHAT_ID.test(chatId) ? chatId : null;
}

/** Cuts text to Orbit's length, never through the middle of an emoji, so the kept key matches the one cut here. */
function clip(value: string, max: number): string {
    return value.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}

/**
 * An item's key as Orbit keeps it. A key over Orbit's length ends in a short hash of the whole key, so two long links
 * in one message that start the same still get keys of their own.
 */
export function keptKey(key: string): string {
    if (key.length <= MAX_KEY) return key;
    // FNV-1a: short and the same every time, which is all a key needs.
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const suffix = ` #${hash.toString(16).padStart(8, "0")}`;
    return clip(key, MAX_KEY - suffix.length) + suffix;
}

/**
 * The bucket and id of an uploader file behind a signed CDN link ("bucket/id"), which stops working after a while.
 * Nothing for any other link: a public link lasts and is kept as it is.
 */
export function chatFileRef(url: string): string | undefined {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return undefined;
    }
    if (!parsed.searchParams.has("X-Amz-Signature") && !parsed.searchParams.has("Signature")) return undefined;
    const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
    if (segments.length < 2) return undefined;
    const bucket = segments[segments.length - 2];
    let id: string;
    try {
        id = decodeURIComponent(segments[segments.length - 1]);
    } catch {
        return undefined;
    }
    return BUCKET.test(bucket) && UPLOADER_FILE_ID.test(id) ? `${bucket}/${id}` : undefined;
}

function isWebLink(url: string): boolean {
    return /^https?:\/\//i.test(url) && url.length <= MAX_LINK;
}

/**
 * The rows to keep for what a nearby chat shared. `urlOf` gives an image's, video's or file's link (in a nearby
 * message, reading it fetches nothing). An item whose link can't be kept (a data: link, too long) is left out.
 * `withChatIds` are the chat accounts of the others in the chat when the message came (#1615).
 */
export function savedRowsOf(
    shared: SharedItems,
    urlOf: (item: SharedItem) => string | undefined,
    you: string,
    now: Date = new Date(),
    withChatIds: readonly string[] = []
): SavedNearbyItem[] {
    const rows: SavedNearbyItem[] = [];
    const base = (item: SharedItem) => {
        const sender = item.message.isMyMessage ? item.message.sender?.username || you : item.message.sender?.username;
        const senderChatId = item.message.isMyMessage ? null : keptChatId(item.message.sender?.chatId);
        const others = [
            ...new Set(withChatIds.map(keptChatId).filter((id): id is string => id !== null && id !== senderChatId)),
        ].slice(0, MAX_WITH);
        return {
            itemKey: keptKey(item.key),
            name: clip(item.name, MAX_NAME),
            mimeType: null,
            size: item.size ?? null,
            senderName: clip(sender?.trim() || "?", MAX_SENDER),
            senderChatId,
            mine: item.message.isMyMessage,
            withChatIds: others,
            sentAt: (item.message.date ?? now).toISOString(),
        };
    };
    const fileRow = (item: SharedItem, kind: "media" | "file") => {
        const url = item.src ?? urlOf(item);
        if (!url) return;
        const fileId = chatFileRef(url) ?? null;
        if (!fileId && !isWebLink(url)) return;
        rows.push({
            ...base(item),
            kind,
            link: fileId ? null : url,
            fileId,
            isVideo: kind === "media" && !!item.isVideo,
        });
    };
    shared.media.forEach((item) => fileRow(item, "media"));
    shared.files.forEach((item) => fileRow(item, "file"));
    for (const item of shared.links) {
        if (!item.url || !isWebLink(item.url)) continue;
        rows.push({ ...base(item), kind: "link", link: item.url, fileId: null, isVideo: false });
    }
    return rows;
}

function isSavedNearbyItem(value: unknown): value is SavedNearbyItem {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
        typeof row.itemKey === "string" &&
        (row.kind === "media" || row.kind === "link" || row.kind === "file") &&
        typeof row.name === "string" &&
        (row.link === null || typeof row.link === "string") &&
        (row.fileId === null || typeof row.fileId === "string") &&
        (row.size === null || typeof row.size === "number") &&
        typeof row.isVideo === "boolean" &&
        typeof row.senderName === "string" &&
        typeof row.mine === "boolean" &&
        typeof row.sentAt === "string" &&
        !Number.isNaN(new Date(row.sentAt).getTime())
    );
}

/**
 * One page of Orbit's answer, or null when it isn't one. Rows that aren't rows are left out. With `byPerson`, a page
 * whose rows don't name their sender's chat account comes from an Orbit that can't list by person (it answered with
 * every item), so it isn't one either.
 */
export function savedNearbyPage(
    value: unknown,
    byPerson = false
): { items: SavedNearbyItem[]; next: string | null } | null {
    if (typeof value !== "object" || value === null) return null;
    const page = value as { items?: unknown; next?: unknown };
    if (!Array.isArray(page.items)) return null;
    if (
        byPerson &&
        page.items.some((row) => typeof row !== "object" || row === null || !("senderChatId" in (row as object)))
    ) {
        return null;
    }
    return {
        items: page.items.filter(isSavedNearbyItem),
        next: typeof page.next === "string" && page.next !== "" ? page.next : null,
    };
}

function savedMessage(row: SavedNearbyItem, url: string | undefined): ChatMessage {
    const sender = {
        chatId: row.senderChatId ?? "0",
        uuid: "0",
        username: row.senderName,
        availabilityStatus: readable(0),
        pictureStore: readable(undefined),
        roomName: undefined,
        playUri: undefined,
        color: undefined,
        spaceUserId: undefined,
    } as unknown as AnyKindOfUser;
    return {
        id: row.itemKey,
        sender,
        content: readable({
            body: row.kind === "link" ? row.link ?? "" : "",
            url,
            urls: undefined,
            filename: row.kind === "link" ? undefined : row.name,
            fileNames: undefined,
        }),
        isMyMessage: row.mine,
        isQuotedMessage: false,
        date: new Date(row.sentAt),
        quotedMessage: undefined,
        type: row.kind === "media" ? (row.isVideo ? "video" : "image") : row.kind === "file" ? "file" : "proximity",
        reactions: new MapStore<string, ChatMessageReaction>(),
        remove: () => undefined,
        edit: () => Promise.resolve(),
        isDeleted: readable(false),
        isModified: readable(false),
        addReaction: () => Promise.resolve(),
        canDelete: readable(false),
        canReact: readable(false),
        canReply: readable(false),
        sharedFile: row.kind === "link" ? undefined : { name: row.name, size: row.size ?? undefined, voice: false },
    };
}

/**
 * Kept rows as items of the chat's "Media, links and files", each marked as shared in a proximity chat. An uploader
 * file opens through the uploader's lasting link, which hands out a fresh one.
 */
export function savedItemsOf(rows: readonly SavedNearbyItem[], uploaderUrl: string | undefined): SharedItems {
    const shared: SharedItems = { media: [], links: [], files: [] };
    for (const row of rows) {
        const url = row.fileId
            ? uploaderUrl
                ? `${uploaderUrl.replace(/\/+$/, "")}/chat-file/${row.fileId
                      .split("/")
                      .map(encodeURIComponent)
                      .join("/")}`
                : undefined
            : row.link ?? undefined;
        if (!url) continue;
        const message = savedMessage(row, url);
        if (row.kind === "media") {
            shared.media.push({
                key: row.itemKey,
                message,
                name: row.name,
                src: url,
                isVideo: row.isVideo,
                nearby: true,
            });
        } else if (row.kind === "file") {
            shared.files.push({ key: row.itemKey, message, name: row.name, size: row.size ?? undefined, nearby: true });
        } else {
            shared.links.push({ key: row.itemKey, message, name: url, url, nearby: true });
        }
    }
    return shared;
}

/**
 * What the open chat shows, then what was kept that it doesn't show, newest first in each tab: a direct chat's own
 * items with what you and that person shared in proximity chats (#1615).
 */
export function mergeShared(live: SharedItems, saved: SharedItems): SharedItems {
    const merge = (liveItems: SharedItem[], savedItems: SharedItem[]) => {
        if (savedItems.length === 0) return liveItems;
        // A kept key was cut to what Orbit takes: the open chat's keys are cut the same way to match.
        const keys = new Set(liveItems.map((item) => keptKey(item.key)));
        return [...liveItems, ...savedItems.filter((item) => !keys.has(item.key))].sort(
            (a, b) => (b.message.date?.getTime() ?? 0) - (a.message.date?.getTime() ?? 0)
        );
    };
    return {
        media: merge(live.media, saved.media),
        links: merge(live.links, saved.links),
        files: merge(live.files, saved.files),
    };
}
