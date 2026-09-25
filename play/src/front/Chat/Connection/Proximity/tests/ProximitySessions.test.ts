import { describe, expect, it } from "vitest";
import type { ProximitySessionMarker, SessionTimelineMessage } from "../ProximitySessions";
import { buildTimelineEntries, findNotSentInsertIndex, formatSessionDivider } from "../ProximitySessions";

function at(minute: number): Date {
    return new Date(Date.UTC(2026, 8, 24, 10, minute));
}

function message(id: string, minute: number, session?: ProximitySessionMarker): SessionTimelineMessage {
    return { id, date: at(minute), session };
}

const withSara: ProximitySessionMarker = { kind: "start", label: "Sara", participants: ["Sara"] };
const saraLeft: ProximitySessionMarker = { kind: "end", label: "Sara", participants: ["Sara"] };
const withOmar: ProximitySessionMarker = { kind: "start", label: "Omar", participants: ["Omar"] };
const designRoom: ProximitySessionMarker = { kind: "start", label: "Design room", participants: [] };

describe("buildTimelineEntries", () => {
    // Leave bubble A (Sara), enter bubble B (Omar).
    const timeline = [
        message("a-start", 1, withSara),
        message("a-1", 2),
        message("a-2", 3),
        message("a-end", 4, saraLeft),
        message("b-start", 5, withOmar),
        message("b-1", 6),
    ];

    it("groups messages under the divider of the group they were written in", () => {
        const entries = buildTimelineEntries(timeline, at(5).getTime());
        expect(entries.map((entry) => [entry.message.id, entry.role, entry.sessionIndex])).toEqual([
            ["a-start", "start", 1],
            ["a-1", "message", 1],
            ["a-2", "message", 1],
            ["a-end", "end", 1],
            ["b-start", "start", 2],
            ["b-1", "message", 2],
        ]);
    });

    it("marks only the group this tab is in now as current", () => {
        const entries = buildTimelineEntries(timeline, at(5).getTime());
        expect(entries.filter((entry) => entry.isCurrentSession).map((entry) => entry.message.id)).toEqual([
            "b-start",
            "b-1",
        ]);
    });

    it("has no current group once the space is left", () => {
        const entries = buildTimelineEntries(timeline, undefined);
        expect(entries.some((entry) => entry.isCurrentSession)).toBe(false);
    });

    it("has no current group when the last group ended", () => {
        const entries = buildTimelineEntries(timeline.slice(0, 4), at(1).getTime());
        expect(entries.some((entry) => entry.isCurrentSession)).toBe(false);
    });

    it("never takes an older group for the one just joined, before its start marker is written", () => {
        // A new bubble was joined at minute 10, but the people in it are not known yet: no marker so far.
        const entries = buildTimelineEntries(timeline, at(10).getTime());
        expect(entries.some((entry) => entry.isCurrentSession)).toBe(false);
    });

    it("keeps messages written before any marker in session 0, never current", () => {
        const entries = buildTimelineEntries([message("old", 0), ...timeline], at(5).getTime());
        expect(entries[0]).toMatchObject({ role: "message", sessionIndex: 0, isCurrentSession: false });
    });

    it("starts a new group on a start marker even when the previous one has no end marker", () => {
        const entries = buildTimelineEntries(
            [message("m-start", 1, designRoom), message("m-1", 2), message("b-start", 3, withOmar)],
            at(3).getTime()
        );
        expect(entries.map((entry) => entry.sessionIndex)).toEqual([1, 1, 2]);
        expect(entries.map((entry) => entry.isCurrentSession)).toEqual([false, false, true]);
    });

    it("leaves timelines without markers (saved conversations) as plain messages", () => {
        const entries = buildTimelineEntries([message("x", 1), message("y", 2)], undefined);
        expect(entries.map((entry) => entry.role)).toEqual(["message", "message"]);
    });
});

describe("findNotSentInsertIndex", () => {
    it("puts a message that could not be sent at the end of its own group, before the leave marker", () => {
        const timeline = [
            message("a-start", 1, withSara),
            message("a-1", 3),
            message("a-end", 4, saraLeft),
            message("b-start", 5, withOmar),
        ];
        expect(findNotSentInsertIndex(timeline, at(2))).toBe(2);
    });

    it("goes before the next group's divider when the group had no leave marker", () => {
        const timeline = [message("a-start", 1, withSara), message("b-start", 5, withOmar), message("b-1", 6)];
        expect(findNotSentInsertIndex(timeline, at(2))).toBe(1);
    });

    it("is appended when no marker came after it", () => {
        const timeline = [message("a-start", 1, withSara), message("a-1", 2)];
        expect(findNotSentInsertIndex(timeline, at(3))).toBe(2);
    });
});

describe("formatSessionDivider", () => {
    const templates = { withPeople: ({ names }: { names: string }) => `With ${names}` };

    it("names the people of a group", () => {
        expect(
            formatSessionDivider({ kind: "start", label: "Sara & Omar", participants: ["Sara", "Omar"] }, templates)
        ).toBe("With Sara & Omar");
    });

    it("names a meeting area by itself", () => {
        expect(formatSessionDivider(designRoom, templates)).toBe("Design room");
    });

    it("works with translated templates", () => {
        expect(formatSessionDivider(withSara, { withPeople: ({ names }) => `مع ${names}` })).toBe("مع Sara");
    });
});
