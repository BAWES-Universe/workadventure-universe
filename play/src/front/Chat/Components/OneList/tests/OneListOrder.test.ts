import { describe, expect, it } from "vitest";
import type { FolderSnapshot, OneListCandidate, OneListKind } from "../OneListOrder";
import {
    InvitationClock,
    applyFrozenOrder,
    compareOneListCandidates,
    formatRowTime,
    formatUnreadCount,
    mergeOneList,
    normalizeTimestamp,
    summarizeFolder,
    toPlainText,
} from "../OneListOrder";

function candidate(
    id: string,
    kind: OneListKind,
    timestamp: number,
    name = id,
    unreadCount = 0
): OneListCandidate<string> {
    return { id, kind, name, timestamp, unreadCount, hasUnread: unreadCount > 0, item: id };
}

const ids = (list: { id: string }[]) => list.map((entry) => entry.id);

describe("normalizeTimestamp", () => {
    it("treats an empty Matrix timeline and junk as never", () => {
        expect(normalizeTimestamp(Number.MIN_SAFE_INTEGER)).toBe(0);
        expect(normalizeTimestamp(NaN)).toBe(0);
        expect(normalizeTimestamp(undefined)).toBe(0);
        expect(normalizeTimestamp(-5)).toBe(0);
        expect(normalizeTimestamp(1234)).toBe(1234);
    });
});

describe("mergeOneList", () => {
    it("puts DMs, rooms, invitations and folders in one list, newest first", () => {
        const list = mergeOneList(
            [
                candidate("dm-old", "direct", 100),
                candidate("room-new", "room", 500),
                candidate("invite", "invitation", 300),
                candidate("folder", "folder", 400),
                candidate("dm-new", "direct", 600),
            ],
            new Set()
        );
        expect(ids(list)).toEqual(["dm-new", "room-new", "folder", "invite", "dm-old"]);
    });

    it("breaks ties by name, case-insensitively, then by id", () => {
        const list = mergeOneList(
            [
                candidate("3", "room", 0, "bravo"),
                candidate("2", "room", 0, "Alpha"),
                candidate("1", "direct", 0, "alpha"),
            ],
            new Set()
        );
        expect(ids(list)).toEqual(["1", "2", "3"]);
    });

    it("never duplicates: the first candidate with an id wins", () => {
        const list = mergeOneList(
            [candidate("a", "direct", 100), candidate("a", "room", 900), candidate("b", "room", 200)],
            new Set()
        );
        expect(list.map((entry) => `${entry.id}:${entry.kind}`)).toEqual(["b:room", "a:direct"]);
    });

    it("never shows an area chat room", () => {
        const list = mergeOneList(
            [candidate("!area", "room", 999), candidate("!invite-area", "invitation", 998), candidate("b", "room", 1)],
            new Set(["!area", "!invite-area"])
        );
        expect(ids(list)).toEqual(["b"]);
    });

    it("filters rooms, DMs and invitations by the search, and keeps folders", () => {
        const list = mergeOneList(
            [
                candidate("1", "room", 5, "Design room"),
                candidate("2", "direct", 4, "Sara"),
                candidate("3", "invitation", 3, "Design review"),
                candidate("4", "folder", 2, "Team"),
            ],
            new Set(),
            "  design "
        );
        expect(ids(list)).toEqual(["1", "3", "4"]);
    });

    it("compares newest first", () => {
        expect(compareOneListCandidates(candidate("a", "room", 2), candidate("b", "room", 1))).toBeLessThan(0);
        expect(
            compareOneListCandidates(candidate("a", "room", Number.MIN_SAFE_INTEGER), candidate("b", "room", 1))
        ).toBeGreaterThan(0);
    });
});

describe("summarizeFolder", () => {
    const folder: FolderSnapshot = {
        id: "f",
        rooms: [
            { id: "r1", timestamp: 100, unreadCount: 2, hasUnread: true },
            { id: "r2", timestamp: Number.MIN_SAFE_INTEGER, unreadCount: 0, hasUnread: false },
        ],
        folders: [
            {
                id: "nested",
                rooms: [{ id: "r3", timestamp: 700, unreadCount: 3, hasUnread: true }],
                folders: [],
            },
        ],
    };

    it("sorts by the newest message inside, nested folders included", () => {
        expect(summarizeFolder(folder).timestamp).toBe(700);
    });

    it("sums the unread count of its rooms", () => {
        const summary = summarizeFolder(folder);
        expect(summary.unreadCount).toBe(5);
        expect(summary.hasUnread).toBe(true);
    });

    it("ignores area chat rooms inside it", () => {
        const summary = summarizeFolder(folder, new Set(["r3"]));
        expect(summary).toEqual({ timestamp: 100, unreadCount: 2, hasUnread: true });
    });

    it("is empty and never for a folder with no messages", () => {
        expect(summarizeFolder({ id: "e", rooms: [], folders: [] })).toEqual({
            timestamp: 0,
            unreadCount: 0,
            hasUnread: false,
        });
    });

    it("keeps the unread flag of a room without a count", () => {
        const summary = summarizeFolder({
            id: "f",
            rooms: [{ id: "r", timestamp: 1, unreadCount: 0, hasUnread: true }],
            folders: [],
        });
        expect(summary.hasUnread).toBe(true);
        expect(summary.unreadCount).toBe(0);
    });

    it("never loops on a folder that contains itself", () => {
        const loop: FolderSnapshot = {
            id: "loop",
            rooms: [{ id: "r", timestamp: 5, unreadCount: 1, hasUnread: true }],
            folders: [],
        };
        loop.folders.push(loop);
        expect(summarizeFolder(loop)).toEqual({ timestamp: 5, unreadCount: 1, hasUnread: true });
    });
});

describe("applyFrozenOrder", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("returns the live order when nothing is held", () => {
        expect(ids(applyFrozenOrder([{ id: "c" }, { id: "a" }], undefined))).toEqual(["c", "a"]);
    });

    it("keeps the frozen order while held, drops rows that left and adds new rows at the end", () => {
        const next = [{ id: "d" }, { id: "c" }, { id: "a" }];
        expect(ids(applyFrozenOrder(next, ids(list)))).toEqual(["a", "c", "d"]);
    });

    it("uses the fresh objects, not the frozen ones", () => {
        const fresh = { id: "a", unread: 3 };
        expect(applyFrozenOrder([fresh], ["a"])[0]).toBe(fresh);
    });
});

describe("InvitationClock", () => {
    it("uses the invite event's time when it has one", () => {
        const clock = new InvitationClock(() => 999);
        expect(clock.timestampFor("!a", 123)).toBe(123);
    });

    it("otherwise remembers when this tab first saw the invitation", () => {
        let now = 1000;
        const clock = new InvitationClock(() => now);
        expect(clock.timestampFor("!a", undefined)).toBe(1000);
        now = 5000;
        expect(clock.timestampFor("!a", undefined)).toBe(1000);
        expect(clock.timestampFor("!b", Number.MIN_SAFE_INTEGER)).toBe(5000);
    });

    it("forgets invitations that are gone", () => {
        let now = 1;
        const clock = new InvitationClock(() => now);
        clock.timestampFor("!a", undefined);
        clock.retain(new Set());
        now = 2;
        expect(clock.timestampFor("!a", undefined)).toBe(2);
    });
});

describe("formatRowTime", () => {
    const labels = {
        justNow: "now",
        minutes: (count: number) => `${count}m`,
        yesterday: "Yesterday",
    };
    const now = new Date(2026, 8, 24, 15, 30).getTime();

    it("is empty without a message", () => {
        expect(formatRowTime(0, now, "en-US", labels)).toBe("");
        expect(formatRowTime(Number.MIN_SAFE_INTEGER, now, "en-US", labels)).toBe("");
    });

    it("says now, then minutes", () => {
        expect(formatRowTime(now - 10_000, now, "en-US", labels)).toBe("now");
        expect(formatRowTime(now + 5_000, now, "en-US", labels)).toBe("now");
        expect(formatRowTime(now - 2 * 60_000, now, "en-US", labels)).toBe("2m");
        expect(formatRowTime(now - 59 * 60_000, now, "en-US", labels)).toBe("59m");
    });

    it("shows the time today and Yesterday the day before", () => {
        const today = formatRowTime(new Date(2026, 8, 24, 9, 5).getTime(), now, "en-US", labels);
        expect(today).toMatch(/9:05/);
        expect(formatRowTime(new Date(2026, 8, 23, 23, 0).getTime(), now, "en-US", labels)).toBe("Yesterday");
    });

    it("shows a weekday within the week, then a date", () => {
        const weekday = formatRowTime(new Date(2026, 8, 21, 12, 0).getTime(), now, "en-US", labels);
        expect(weekday).toBe("Mon");
        const date = formatRowTime(new Date(2026, 5, 2, 12, 0).getTime(), now, "en-US", labels);
        expect(date).toMatch(/Jun/);
        const lastYear = formatRowTime(new Date(2025, 5, 2, 12, 0).getTime(), now, "en-US", labels);
        expect(lastYear).toMatch(/2025/);
    });
});

describe("formatUnreadCount and toPlainText", () => {
    it("caps the pill at 99+", () => {
        expect(formatUnreadCount(5)).toBe("5");
        expect(formatUnreadCount(100)).toBe("99+");
    });

    it("turns an HTML body into one line of text", () => {
        expect(toPlainText("<p>Hello <b>there</b></p>\n<p>friend</p>")).toBe("Hello there friend");
    });
});
