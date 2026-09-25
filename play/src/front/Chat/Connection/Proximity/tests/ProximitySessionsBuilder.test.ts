import { describe, expect, it } from "vitest";
import type { SessionTimelineMessage } from "../ProximitySessions";
import {
    NO_CONTINUATION,
    ROOM_MESSAGES_SESSION_ID,
    buildProximitySessions,
    listableSessions,
    liveSession,
    sessionOfStay,
} from "../ProximitySessions";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 24, 10, minute));

function message(id: string, minute: number, type = "proximity"): SessionTimelineMessage {
    return { id, date: at(minute), type };
}

function start(
    id: string,
    minute: number,
    sessionId: string,
    participants: string[],
    participantIds: string[] = []
): SessionTimelineMessage {
    return {
        id,
        date: at(minute),
        type: "incoming",
        session: { kind: "start", label: participants.join(" & "), participants, sessionId, participantIds },
    };
}

function end(
    id: string,
    minute: number,
    sessionId: string,
    unsentDraft?: string,
    participants: string[] = [],
    participantIds: string[] = []
): SessionTimelineMessage {
    return {
        id,
        date: at(minute),
        type: "outcoming",
        session: { kind: "end", label: "", participants, participantIds, sessionId, unsentDraft },
    };
}

function area(id: string, minute: number, sessionId: string, label: string): SessionTimelineMessage {
    return {
        id,
        date: at(minute),
        type: "incoming",
        session: { kind: "start", label, participants: [], participantIds: [], sessionId, isArea: true },
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

describe("buildProximitySessions: carrying on a conversation", () => {
    // Sara (id "u1") chats, you walk away at minute 3 and are back with her at `backAt`.
    const backWithSara = (backAt: number, ids: string[] = ["u1"], joinedAt = backAt) =>
        buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 3, "a"),
                start("s2", backAt, "b", ["Sara"], ids),
                message("m2", backAt + 1),
            ],
            at(joinedAt).getTime()
        );

    it("carries on the same chat when you're back with the same person within 15 minutes", () => {
        const sessions = backWithSara(10);
        expect(sessions).toHaveLength(1);
        const [chat] = sessions;
        expect(chat.id).toBe("a");
        expect(chat.stayIds).toEqual(["a", "b"]);
        expect(chat.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
        expect(chat.lastMessage?.id).toBe("m2");
        expect(chat.isLive).toBe(true);
        expect(chat.participants).toEqual(["Sara"]);
        // The second start reads as "Back with Sara"; the first one stays the start of the chat.
        expect(chat.entries.map((entry) => entry.role)).toEqual(["start", "message", "end", "resume", "message"]);
        expect(chat.entries.every((entry) => entry.isCurrentSession)).toBe(true);
        expect(liveSession(sessions)?.id).toBe("a");
        expect(sessionOfStay(sessions, "b")?.id).toBe("a");
    });

    it("starts another chat when you're back after more than 15 minutes", () => {
        const sessions = backWithSara(19);
        expect(sessions.map((session) => session.id)).toEqual(["a", "b"]);
        expect(sessions[0].isLive).toBe(false);
        expect(sessions[1].isLive).toBe(true);
    });

    it("carries on for 5 minutes only when the person can only be matched by name (they reconnected)", () => {
        expect(backWithSara(7, ["u9"]).map((session) => session.id)).toEqual(["a"]);
        expect(backWithSara(9, ["u9"]).map((session) => session.id)).toEqual(["a", "b"]);
        // The newest id replaces the old one, so "Walk to" finds the avatar that is around now.
        expect(backWithSara(7, ["u9"])[0].participantIds).toEqual(["u9"]);
    });

    it("never joins chats with different people, whatever the gap", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 2, "a"),
                start("s2", 3, "b", ["Omar"], ["u2"]),
                message("m2", 4),
            ],
            at(3).getTime()
        );
        expect(sessions.map((session) => session.id)).toEqual(["a", "b"]);
    });

    it("carries on a group when at least one of the same people is back", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara", "Omar"], ["u1", "u2"]),
                message("m1", 1),
                end("e1", 2, "a"),
                start("s2", 5, "b", ["Omar", "Lina"], ["u2", "u3"]),
                message("m2", 6),
            ],
            at(5).getTime()
        );
        expect(sessions).toHaveLength(1);
        expect(sessions[0].participants).toEqual(["Sara", "Omar", "Lina"]);
    });

    it("counts someone who joined later (there when you left) as part of the chat", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 2, "a", undefined, ["Omar"], ["u2"]),
                start("s2", 5, "b", ["Omar"], ["u2"]),
                message("m2", 6),
            ],
            at(5).getTime()
        );
        expect(sessions).toHaveLength(1);
        expect(sessions[0].participants).toEqual(["Sara", "Omar"]);
    });

    it("going back and forth between two people keeps two chats, not one per visit", () => {
        // Johnny, then Khalid, then Johnny, then Khalid, all within a minute or two.
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Johnny"], ["bot"]),
                message("m1", 0),
                end("e1", 1, "a"),
                start("s2", 1, "b", ["Khalid"], ["u2"]),
                message("m2", 1),
                end("e2", 2, "b"),
                start("s3", 2, "c", ["Johnny"], ["bot"]),
                message("m3", 2),
                end("e3", 3, "c"),
                start("s4", 3, "d", ["Khalid"], ["u2"]),
                message("m4", 3),
            ],
            at(3).getTime()
        );
        expect(sessions.map((session) => [session.id, session.stayIds])).toEqual([
            ["a", ["a", "c"]],
            ["b", ["b", "d"]],
        ]);
        // Each chat holds only its own messages, in order.
        expect(sessions[0].messages.map((m) => m.id)).toEqual(["m1", "m3"]);
        expect(sessions[1].messages.map((m) => m.id)).toEqual(["m2", "m4"]);
        expect(sessions[0].isLive).toBe(false);
        expect(liveSession(sessions)?.id).toBe("b");
        expect(listableSessions(sessions).map((session) => session.id)).toEqual(["a"]);
    });

    it("still starts a new chat when the last one with that person ended more than 15 minutes ago", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 2, "a"),
                start("s2", 3, "b", ["Omar"], ["u2"]),
                message("m2", 4),
                end("e2", 20, "b"),
                start("s3", 21, "c", ["Sara"], ["u1"]),
                message("m3", 22),
            ],
            at(21).getTime()
        );
        expect(sessions.map((session) => session.id)).toEqual(["a", "b", "c"]);
    });

    it("a group carries on the most recent chat it shares people with", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 0),
                end("e1", 1, "a"),
                start("s2", 1, "b", ["Omar"], ["u2"]),
                message("m2", 1),
                end("e2", 2, "b"),
                start("s3", 3, "c", ["Sara", "Omar"], ["u1", "u2"]),
                message("m3", 3),
            ],
            at(3).getTime()
        );
        expect(sessions.map((session) => [session.id, session.stayIds])).toEqual([
            ["a", ["a"]],
            ["b", ["b", "c"]],
        ]);
    });

    it("looks past a walk-by where nobody wrote anything", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 2, "a"),
                start("s2", 3, "b", ["Omar"], ["u2"]),
                end("e2", 3, "b"),
                start("s3", 6, "c", ["Sara"], ["u1"]),
                message("m3", 7),
            ],
            at(6).getTime()
        );
        expect(sessions.map((session) => session.id)).toEqual(["a", "b"]);
        expect(sessions[0].stayIds).toEqual(["a", "c"]);
        expect(listableSessions(sessions)).toEqual([]);
        expect(liveSession(sessions)?.id).toBe("a");
    });

    it("carries on in the same meeting area, not in another one", () => {
        const same = buildProximitySessions(
            [area("s1", 0, "a", "Design room"), message("m1", 1), end("e1", 2, "a"), area("s2", 5, "b", "Design room")],
            at(5).getTime()
        );
        expect(same.map((session) => session.id)).toEqual(["a"]);
        const other = buildProximitySessions(
            [area("s1", 0, "a", "Design room"), message("m1", 1), end("e1", 2, "a"), area("s2", 5, "b", "Lobby")],
            at(5).getTime()
        );
        expect(other.map((session) => session.id)).toEqual(["a", "b"]);
    });

    it("keeps the text left when you walked away, so the composer can take it back", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 3, "a"),
                start("s2", 5, "b", ["Sara"], ["u1"]),
            ],
            at(5).getTime(),
            undefined,
            new Map([["a", "was about to say"]])
        );
        expect(sessions).toHaveLength(1);
        expect(sessions[0].isLive).toBe(true);
        expect(sessions[0].unsentDraft).toBe("was about to say");
    });

    it("can be switched off: every stay is then its own session", () => {
        const sessions = buildProximitySessions(
            [
                start("s1", 0, "a", ["Sara"], ["u1"]),
                message("m1", 1),
                end("e1", 3, "a"),
                start("s2", 5, "b", ["Sara"], ["u1"]),
                message("m2", 6),
            ],
            at(5).getTime(),
            NO_CONTINUATION
        );
        expect(sessions.map((session) => session.id)).toEqual(["a", "b"]);
    });
});
