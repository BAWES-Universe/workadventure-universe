import { describe, expect, it } from "vitest";
import type { SessionTimelineMessage } from "../ProximitySessions";
import { ROOM_MESSAGES_SESSION_ID, buildProximitySessions, listableSessions, liveSession } from "../ProximitySessions";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 24, 10, minute));

function message(id: string, minute: number, type = "proximity"): SessionTimelineMessage {
    return { id, date: at(minute), type };
}

function start(id: string, minute: number, sessionId: string, participants: string[]): SessionTimelineMessage {
    return {
        id,
        date: at(minute),
        type: "incoming",
        session: { kind: "start", label: participants.join(" & "), participants, sessionId, participantIds: [] },
    };
}

function end(id: string, minute: number, sessionId: string, unsentDraft?: string): SessionTimelineMessage {
    return {
        id,
        date: at(minute),
        type: "outcoming",
        session: { kind: "end", label: "", participants: [], sessionId, unsentDraft },
    };
}

describe("buildProximitySessions", () => {
    it("makes one session per stay, with the messages written in it", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"]),
                message("m1", 1),
                message("n1", 2, "incoming"),
                end("e1", 3, "a"),
                start("s2", 10, "b", ["Omar"]),
                message("m2", 11),
            ],
            at(10).getTime()
        );
        expect(sessions.map((session) => [session.id, session.messages.length, session.isLive])).toEqual([
            ["a", 1, false],
            ["b", 1, true],
        ]);
        expect(sessions[0].endedAt).toBe(at(3).getTime());
        expect(sessions[0].entries.map((entry) => entry.role)).toEqual(["start", "message", "message", "end"]);
        expect(liveSession(sessions)?.id).toBe("b");
    });

    it("puts messages outside any stay in the room messages, and lists them only without a live stay", () => {
        const loose = buildProximitySessions(
            [message("script", 0), start("s1", 1, "a", ["Sara"]), end("e1", 2, "a")],
            undefined
        );
        expect(loose[0].id).toBe(ROOM_MESSAGES_SESSION_ID);
        expect(loose[0].messages).toHaveLength(1);
        expect(listableSessions(loose).map((session) => session.id)).toEqual([ROOM_MESSAGES_SESSION_ID]);

        const withLive = buildProximitySessions([message("script", 0), start("s1", 1, "a", ["Sara"])], at(1).getTime());
        expect(listableSessions(withLive)).toEqual([]);
    });

    it("counts an unfinished stay as ended once no space is joined (a carried timeline)", () => {
        const sessions = buildProximitySessions([start("s1", 0, "a", ["Sara"]), message("m1", 1)], undefined);
        expect(sessions[0].isLive).toBe(false);
        expect(listableSessions(sessions).map((session) => session.id)).toEqual(["a"]);
    });

    it("keeps a stay with only an unsent draft, and drops one with only join and leave notices", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"]),
                message("n1", 1, "incoming"),
                end("e1", 2, "a", "was about to say"),
                start("s2", 3, "b", ["Omar"]),
                end("e2", 4, "b"),
            ],
            undefined
        );
        expect(listableSessions(sessions).map((session) => session.id)).toEqual(["a"]);
        expect(sessions[0].unsentDraft).toBe("was about to say");
    });

    it("pairs markers without ids by order, for timelines written before ids existed", () => {
        const sessions = buildProximitySessions(
            [
                { id: "s", date: at(0), session: { kind: "start", label: "Sara", participants: ["Sara"] } },
                message("m", 1),
                { id: "e", date: at(2), session: { kind: "end", label: "Sara", participants: ["Sara"] } },
            ],
            undefined
        );
        expect(sessions).toHaveLength(1);
        expect(sessions[0].messages).toHaveLength(1);
    });
});
