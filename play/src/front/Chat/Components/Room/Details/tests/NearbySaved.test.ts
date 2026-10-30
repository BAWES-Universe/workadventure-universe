import { describe, expect, it } from "vitest";
import { get, readable } from "svelte/store";
import type { ChatMessage, ChatMessageType } from "../../../../Connection/ChatConnection";
import {
    chatFileRef,
    keptChatId,
    keptKey,
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

    it("knows an uploader file with a long extension", () => {
        const id = "0b5c1a6e-3f2d-4c8b-9a71-2e4f6d8c0a1b.webmanifest";
        expect(chatFileRef(`https://r2.example.com/user-refs/${id}?X-Amz-Signature=abc`)).toBe(`user-refs/${id}`);
        expect(
            chatFileRef(`https://r2.example.com/user-refs/${ID}x${"a".repeat(17)}?X-Amz-Signature=abc`)
        ).toBeUndefined();
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

    it("never cuts an emoji in half at the limit", () => {
        const name = "x".repeat(299) + "🚪 door";
        const rows = savedRowsOf(
            { media: [], files: [], links: [item(name, message("t", "proximity"), { url: "https://bawes.net" })] },
            () => undefined,
            "You"
        );
        expect(rows[0].itemKey).toMatch(/^x{290} #[0-9a-f]{8}$/);
        expect(rows[0].name).toBe("x".repeat(299));
    });

    it("gives two long links in one message that start the same keys of their own", () => {
        const start = `t1 https://bawes.net/${"x".repeat(300)}`;
        const message1 = message("t1", "proximity");
        const rows = savedRowsOf(
            {
                media: [],
                files: [],
                links: [
                    item(`${start}/a`, message1, { url: `${start.slice(3)}/a` }),
                    item(`${start}/b`, message1, { url: `${start.slice(3)}/b` }),
                ],
            },
            () => undefined,
            "You"
        );
        expect(rows[0].itemKey).not.toBe(rows[1].itemKey);
        expect(rows.map((row) => row.itemKey.length)).toEqual([300, 300]);
        expect(keptKey("short key")).toBe("short key");
    });
});

describe("who an item was shared with (#1615)", () => {
    it("keeps the sender's chat account and the others there, never the sender twice or one Orbit would refuse", () => {
        const from = {
            ...message("t2", "proximity"),
            sender: { username: "Sara", chatId: "@sara:chat.bawes.net" },
        } as unknown as ChatMessage;
        const shared: SharedItems = {
            media: [],
            files: [],
            links: [item("t2 https://bawes.net", from, { url: "https://bawes.net" })],
        };
        const [row] = savedRowsOf(shared, () => undefined, "You", new Date(), [
            "@sara:chat.bawes.net",
            "@bot_12:chat.bawes.net",
            "@bot_12:chat.bawes.net",
            "",
            "not a chat account",
        ]);
        expect(row.senderChatId).toBe("@sara:chat.bawes.net");
        expect(row.withChatIds).toEqual(["@bot_12:chat.bawes.net"]);
    });

    it("names no sender for your own items", () => {
        const shared: SharedItems = {
            media: [],
            files: [],
            links: [
                item("t3 https://bawes.net", message("t3", "proximity", { mine: true }), { url: "https://bawes.net" }),
            ],
        };
        const [row] = savedRowsOf(shared, () => undefined, "You", new Date(), ["@bot_12:chat.bawes.net"]);
        expect(row).toEqual(
            expect.objectContaining({ mine: true, senderChatId: null, withChatIds: ["@bot_12:chat.bawes.net"] })
        );
    });

    it("takes only a chat account Orbit takes", () => {
        expect(keptChatId("@bot_12:chat.bawes.net")).toBe("@bot_12:chat.bawes.net");
        expect(keptChatId("0")).toBeNull();
        expect(keptChatId(undefined)).toBeNull();
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

    it("turns down a page for one person from an Orbit that can't list by person (#1615)", () => {
        // An older Orbit ignores the person and answers with every item, whose rows don't name a sender account.
        expect(savedNearbyPage({ items: [row], next: null }, true)).toBeNull();
        const named = { ...row, senderChatId: null };
        expect(savedNearbyPage({ items: [named], next: null }, true)).toEqual({ items: [named], next: null });
        expect(savedNearbyPage({ items: [], next: null }, true)).toEqual({ items: [], next: null });
    });

    it("marks kept items as shared in a proximity chat", () => {
        const shared = savedItemsOf(
            [row, { ...row, itemKey: "l2", kind: "link", fileId: null, link: "https://bawes.net" }],
            "https://uploader.example.com"
        );
        expect(shared.media[0].nearby).toBe(true);
        expect(shared.links[0].nearby).toBe(true);
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

    it("knows a kept link with a long key is the one the open chat still shows", () => {
        const long = `t1 https://bawes.net/${"x".repeat(400)}`;
        const live: SharedItems = {
            media: [],
            files: [],
            links: [item(long, message("t1", "proximity"), { url: long.slice(3) })],
        };
        const saved = savedItemsOf(
            [{ ...row, itemKey: keptKey(long), kind: "link", fileId: null, link: "https://bawes.net/x" }],
            "https://uploader.example.com"
        );
        expect(mergeShared(live, saved).links).toEqual(live.links);
    });
});
