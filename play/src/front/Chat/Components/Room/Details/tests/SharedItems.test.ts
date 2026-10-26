import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import type { ChatMessage, ChatMessageType, SharedFileInfo } from "../../../../Connection/ChatConnection";
import { firstFilledTab, sentLabel, sharedItemsOf, sharedSectionOf, sharedSections } from "../SharedItems";

function message(
    id: string,
    type: ChatMessageType,
    options: { body?: string; file?: SharedFileInfo; date?: Date | null; deleted?: boolean } = {}
): ChatMessage {
    return {
        id,
        type,
        date: options.date === undefined ? new Date(2026, 9, 26, 10) : options.date,
        isMyMessage: false,
        sharedFile: options.file,
        content: readable({
            body: options.body ?? "",
            url: undefined,
            urls: undefined,
            filename: undefined,
            fileNames: undefined,
        }),
        isDeleted: readable(options.deleted ?? false),
        __body: options.body,
        __deleted: options.deleted ?? false,
    } as unknown as ChatMessage;
}

const bodyOf = (m: ChatMessage) => (m as unknown as { __body?: string }).__body;
const isDeleted = (m: ChatMessage) => (m as unknown as { __deleted: boolean }).__deleted;
const file = (name: string, size?: number, voice = false): SharedFileInfo => ({ name, size, voice });

describe("what a chat shared", () => {
    it("lists each image of a nearby gallery on its own, with its own link", () => {
        const shared = sharedItemsOf(
            [message("g1", "gallery"), message("v1", "video", { file: file("clip.mp4") })],
            bodyOf,
            isDeleted,
            (m) =>
                m.id === "g1"
                    ? [
                          { url: "https://cdn.test/a.png", name: "a.png" },
                          { url: "https://cdn.test/b.webm", name: "b.webm" },
                      ]
                    : []
        );

        expect(shared.media).toEqual([
            expect.objectContaining({ key: "v1", isVideo: true }),
            expect.objectContaining({ key: "g1 0", src: "https://cdn.test/a.png", name: "a.png", isVideo: false }),
            expect.objectContaining({ key: "g1 1", src: "https://cdn.test/b.webm", isVideo: true }),
        ]);
    });

    it("puts a file sent in a gallery with images under Files, with its own link", () => {
        const shared = sharedItemsOf([message("g2", "gallery")], bodyOf, isDeleted, () => [
            { url: "https://cdn.test/door.jpg", name: "door.jpg" },
            { url: "https://cdn.test/0b5c.pdf", name: "Lobby floor plan.pdf" },
            { url: "https://cdn.test/notes", name: "notes" },
        ]);

        expect(shared.media.map((item) => item.key)).toEqual(["g2 0"]);
        expect(shared.files).toEqual([
            expect.objectContaining({ key: "g2 1", name: "Lobby floor plan.pdf", src: "https://cdn.test/0b5c.pdf" }),
            expect.objectContaining({ key: "g2 2", name: "notes", src: "https://cdn.test/notes" }),
        ]);
    });

    it("sorts images and videos, links and files, newest first", () => {
        const shared = sharedItemsOf(
            [
                message("$1", "image", { file: file("door.jpg", 1200) }),
                message("$2", "text", { body: "Look at https://bawes.net/universe and orbit.bawes.net" }),
                message("$3", "file", { file: file("Lobby floor plan.pdf", 19_000) }),
                message("$4", "video", { file: file("clip.mp4") }),
            ],
            bodyOf,
            isDeleted
        );

        expect(shared.media.map((item) => item.message.id)).toEqual(["$4", "$1"]);
        expect(shared.links.map((item) => item.url)).toEqual(["https://bawes.net/universe", "https://orbit.bawes.net"]);
        expect(shared.files).toEqual([
            expect.objectContaining({ key: "$3", name: "Lobby floor plan.pdf", size: 19_000 }),
        ]);
    });

    it("keeps voice messages and deleted messages out", () => {
        const shared = sharedItemsOf(
            [
                message("$1", "audio", { file: file("voice.ogg", 900, true) }),
                message("$2", "audio", { file: file("theme.mp3", 4_000) }),
                message("$3", "image", { file: file("gone.png"), deleted: true }),
                message("$4", "text", { body: "https://gone.example", deleted: true }),
            ],
            bodyOf,
            isDeleted
        );

        expect(shared.media).toEqual([]);
        expect(shared.links).toEqual([]);
        expect(shared.files.map((item) => item.name)).toEqual(["theme.mp3"]);
    });

    it("lists a link once per message, also one sent without a preview, and leaves code alone", () => {
        const shared = sharedItemsOf(
            [message("$1", "text", { body: "<https://a.example> https://a.example `https://code.example`" })],
            bodyOf,
            isDeleted
        );

        expect(shared.links.map((item) => item.url)).toEqual(["https://a.example"]);
    });

    it("opens on the first tab that has something", () => {
        const empty = { media: [], links: [], files: [] };
        const item = { key: "k", message: message("$1", "file"), name: "a.pdf" };
        expect(firstFilledTab(empty)).toBe("media");
        expect(firstFilledTab({ ...empty, files: [item] })).toBe("files");
        expect(firstFilledTab({ ...empty, links: [item], files: [item] })).toBe("links");
    });
});

describe("the headings shared items go under", () => {
    const now = new Date(2026, 9, 26, 12);

    it("are this week, last week, earlier this month, then the month", () => {
        expect(sharedSectionOf(new Date(2026, 9, 21, 9), now)).toEqual({ kind: "thisWeek" });
        expect(sharedSectionOf(new Date(2026, 9, 14, 9), now)).toEqual({ kind: "lastWeek" });
        expect(sharedSectionOf(new Date(2026, 9, 3, 9), now)).toEqual({ kind: "thisMonth" });
        expect(sharedSectionOf(new Date(2026, 8, 30, 9), now)).toEqual({ kind: "month", month: 8, year: 2026 });
        expect(sharedSectionOf(null, now)).toEqual({ kind: "undated" });
    });

    it("group items in the order they come", () => {
        const items = [
            { key: "a", message: message("$a", "image", { date: new Date(2026, 9, 25) }), name: "a" },
            { key: "b", message: message("$b", "image", { date: new Date(2026, 9, 22) }), name: "b" },
            { key: "c", message: message("$c", "image", { date: new Date(2026, 9, 15) }), name: "c" },
        ];
        expect(sharedSections(items, now).map(({ section, items }) => [section.kind, items.length])).toEqual([
            ["thisWeek", 2],
            ["lastWeek", 1],
        ]);
    });

    it("say when an item was sent, short", () => {
        expect(sentLabel(new Date(2026, 9, 26, 9, 12), "en-US", now)).toBe("9:12 AM");
        expect(sentLabel(new Date(2026, 9, 25, 9), "en-US", now)).toBe("Yesterday");
        expect(sentLabel(new Date(2026, 9, 23, 9), "en-US", now)).toBe("Fri");
        expect(sentLabel(new Date(2026, 9, 2, 9), "en-US", now)).toBe("Oct 2");
        expect(sentLabel(new Date(2025, 11, 2, 9), "en-US", now)).toBe("Dec 2, 2025");
    });
});
