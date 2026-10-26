import { describe, expect, it } from "vitest";
import { get, readable } from "svelte/store";
import type { ChatMessage, ChatMessageType } from "../../../../Connection/ChatConnection";
import {
    chatFileRef,
    mergeShared,
    savedItemsOf,
    savedNearbyPage,
    savedRowsOf,
    type SavedNearbyItem,
} from "../NearbySaved";
import type { SharedItem, SharedItems } from "../SharedItems";

const ID = "0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.png";
const SIGNED = `https://r2.example.com/user-refs/${ID}?X-Amz-Algorithm=AWS4&X-Amz-Signature=abc`;

function message(id: string, type: ChatMessageType, options: { mine?: boolean; url?: string; date?: Date } = {}) {
    return {
        id,
        type,
        isMyMessage: options.mine ?? false,
        sender: { username: options.mine ? "Khalid" : "Sara" },
        date: options.date ?? new Date("2026-10-26T09:49:00.000Z"),
        content: readable({ body: "", url: options.url, urls: undefined, filename: undefined, fileNames: undefined }),
    } as unknown as ChatMessage;
}

const item = (key: string, msg: ChatMessage, extra: Partial<SharedItem> = {}): SharedItem => ({
    key,
    message: msg,
    name: key,
    ...extra,
});

describe("a chat file's lasting reference", () => {
    it("is the bucket and id behind a signed link", () => {
        expect(chatFileRef(SIGNED)).toBe(`user-refs/${ID}`);
    });

    it("is nothing for a public link, an uploader link or anything that isn't an uploader file", () => {
        expect(chatFileRef(`https://cdn.example.com/${ID}`)).toBeUndefined();
        expect(chatFileRef(`https://uploader.example.com/upload-file/${ID}`)).toBeUndefined();
        expect(chatFileRef("https://r2.example.com/user-refs/secret.txt?X-Amz-Signature=abc")).toBeUndefined();
        expect(chatFileRef(`https://r2.example.com/${ID}?X-Amz-Signature=abc`)).toBeUndefined();
        expect(chatFileRef("not a link")).toBeUndefined();
    });
});

describe("the rows kept for a nearby chat", () => {
    it("keeps a signed file by its reference, a public one by its link, and links as they are", () => {
        const shared: SharedItems = {
            media: [
                item("m1", message("m1", "image", { url: SIGNED }), { isVideo: false }),
                item("g1 0", message("g1", "gallery"), { src: "https://cdn.example.com/a.webm", isVideo: true }),
            ],
            files: [item("f1", message("f1", "file", { url: "data:text/plain,hello" }))],
            links: [
                item("t1 https://bawes.net", message("t1", "proximity", { mine: true }), { url: "https://bawes.net" }),
            ],
        };
        const rows = savedRowsOf(shared, (one) => get(one.message.content).url, "You");

        expect(rows).toEqual([
            expect.objectContaining({ itemKey: "m1", kind: "media", fileId: `user-refs/${ID}`, link: null }),
            expect.objectContaining({
                itemKey: "g1 0",
                kind: "media",
                link: "https://cdn.example.com/a.webm",
                isVideo: true,
            }),
            expect.objectContaining({
                itemKey: "t1 https://bawes.net",
                kind: "link",
                link: "https://bawes.net",
                mine: true,
                senderName: "Khalid",
            }),
        ]);
        expect(rows[0]).toEqual(expect.objectContaining({ senderName: "Sara", sentAt: "2026-10-26T09:49:00.000Z" }));
    });

    it("keeps keys, names and senders within what Orbit takes", () => {
        const long = "x".repeat(400);
        const rows = savedRowsOf(
            { media: [], files: [], links: [item(long, message("t", "proximity"), { url: "https://bawes.net" })] },
            () => undefined,
            "You"
        );
        expect(rows[0].itemKey).toHaveLength(300);
        expect(rows[0].name).toHaveLength(300);
    });
});

describe("Orbit's page of kept items", () => {
    const row: SavedNearbyItem = {
        itemKey: "m1",
        kind: "media",
        name: "door.png",
        link: null,
        fileId: `user-refs/${ID}`,
        mimeType: null,
        size: 1200,
        isVideo: false,
        senderName: "Sara",
        mine: false,
        sentAt: "2026-10-20T09:00:00.000Z",
    };

    it("reads a page and leaves out what isn't a row", () => {
        expect(savedNearbyPage({ items: [row, { itemKey: 1 }], next: "c1" })).toEqual({ items: [row], next: "c1" });
        expect(savedNearbyPage({ items: [] })).toEqual({ items: [], next: null });
        expect(savedNearbyPage({ error: "Unauthorized" })).toBeNull();
    });

    it("opens a kept uploader file through the uploader's lasting link", () => {
        const shared = savedItemsOf(
            [row, { ...row, itemKey: "l1", kind: "link", fileId: null, link: "https://bawes.net" }],
            "https://uploader.example.com/"
        );
        expect(shared.media[0]).toEqual(
            expect.objectContaining({ key: "m1", src: `https://uploader.example.com/chat-file/user-refs/${ID}` })
        );
        expect(get(shared.media[0].message.content).url).toBe(`https://uploader.example.com/chat-file/user-refs/${ID}`);
        expect(shared.media[0].message.sender?.username).toBe("Sara");
        expect(shared.links[0]).toEqual(expect.objectContaining({ key: "l1", url: "https://bawes.net" }));
    });

    it("leaves out a kept file when there is no uploader to open it", () => {
        expect(savedItemsOf([row], undefined).media).toEqual([]);
    });

    it("joins the open chat's items with the kept ones, once each, newest first", () => {
        const live: SharedItems = {
            media: [item("m1", message("m1", "image", { date: new Date("2026-10-26T09:00:00.000Z") }))],
            links: [],
            files: [],
        };
        const saved = savedItemsOf(
            [row, { ...row, itemKey: "m0", sentAt: "2026-10-27T09:00:00.000Z" }],
            "https://uploader.example.com"
        );
        expect(mergeShared(live, saved).media.map((one) => one.key)).toEqual(["m0", "m1"]);
        expect(mergeShared(live, saved).media[1]).toBe(live.media[0]);
    });
});
