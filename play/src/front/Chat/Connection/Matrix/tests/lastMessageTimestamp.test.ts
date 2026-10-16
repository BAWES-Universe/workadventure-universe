import { describe, expect, it } from "vitest";
import type { TimelineEventLike } from "../lastMessageTimestamp";
import { lastMessageTimestamp } from "../lastMessageTimestamp";

function event(type: string, ts: number, relType?: string): TimelineEventLike {
    return {
        getType: () => type,
        getTs: () => ts,
        getRelation: () => (relType ? { rel_type: relType } : null),
    };
}

const DEC_2025 = Date.UTC(2025, 11, 23, 2, 47);
const OCT_2026 = Date.UTC(2026, 9, 11, 21, 0);

describe("lastMessageTimestamp", () => {
    it("uses the last message, not a later member event (a new name or picture)", () => {
        const events = [event("m.room.message", DEC_2025), event("m.room.member", OCT_2026)];
        expect(lastMessageTimestamp(events, undefined, undefined)).toBe(DEC_2025);
    });

    it("moves to a new message sent after the member event", () => {
        const events = [
            event("m.room.message", DEC_2025),
            event("m.room.member", OCT_2026 - 1000),
            event("m.room.message", OCT_2026),
        ];
        expect(lastMessageTimestamp(events, DEC_2025, undefined)).toBe(OCT_2026);
    });

    it("ignores reactions, edits and other room changes after the last message", () => {
        const events = [
            event("m.room.message", DEC_2025),
            event("m.reaction", OCT_2026),
            event("m.room.message", OCT_2026, "m.replace"),
            event("m.room.power_levels", OCT_2026),
            event("m.room.redaction", OCT_2026),
        ];
        expect(lastMessageTimestamp(events, undefined, undefined)).toBe(DEC_2025);
    });

    it("ignores an encrypted reaction or edit before it is decrypted", () => {
        const events = [
            event("m.room.message", DEC_2025),
            event("m.room.encrypted", OCT_2026, "m.annotation"),
            event("m.room.encrypted", OCT_2026, "m.replace"),
        ];
        expect(lastMessageTimestamp(events, undefined, undefined)).toBe(DEC_2025);
    });

    it("counts encrypted messages, but not stickers (the chat doesn't show them)", () => {
        expect(lastMessageTimestamp([event("m.room.encrypted", OCT_2026)], undefined, undefined)).toBe(OCT_2026);
        expect(
            lastMessageTimestamp(
                [event("m.room.message", DEC_2025), event("m.sticker", OCT_2026)],
                undefined,
                undefined
            )
        ).toBe(DEC_2025);
    });

    it("uses the newest loaded message when the timeline holds none (only member events)", () => {
        const events = [event("m.room.member", OCT_2026), event("m.room.member", OCT_2026)];
        expect(lastMessageTimestamp(events, DEC_2025, undefined)).toBe(DEC_2025);
    });

    it("falls back to the room's creation time when there is no message", () => {
        expect(lastMessageTimestamp([event("m.room.member", OCT_2026)], undefined, DEC_2025)).toBe(DEC_2025);
    });

    it("reports never when there is no time at all", () => {
        expect(lastMessageTimestamp([], undefined, undefined)).toBe(Number.MIN_SAFE_INTEGER);
    });
});
