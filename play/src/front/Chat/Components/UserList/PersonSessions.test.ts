import { AvailabilityStatus } from "@workadventure/messages";
import { describe, expect, it } from "vitest";
import type { Session } from "./PersonSessions";
import {
    availabilityRank,
    bestStatus,
    groupSessions,
    isMyAccount,
    pickSessionToReach,
    sessionCount,
    splitBots,
} from "./PersonSessions";

const HERE = "http://play.test/_/global/maps/here.json";
const ELSEWHERE = "http://play.test/_/global/maps/elsewhere.json";

type TestSession = Session & { status?: AvailabilityStatus };

const me = { spaceUserId: `${HERE}_1`, chatId: "@me:matrix.test", uuid: "uuid-me" };
const statusOf = (session: TestSession) => session.status;

function session(overrides: Partial<TestSession>): TestSession {
    return { status: AvailabilityStatus.ONLINE, ...overrides };
}

describe("groupSessions", () => {
    it("shows each account once, however many sessions it has", () => {
        const groups = groupSessions(
            [
                session({ spaceUserId: `${HERE}_1`, uuid: "uuid-me", chatId: "@me:matrix.test", playUri: HERE }),
                session({ spaceUserId: `${HERE}_2`, uuid: "uuid-bob", playUri: HERE }),
                session({ spaceUserId: `${ELSEWHERE}_7`, uuid: "uuid-me", playUri: ELSEWHERE }),
                session({ spaceUserId: `${HERE}_3`, uuid: "uuid-me", playUri: HERE }),
            ],
            me,
            HERE,
            statusOf
        );

        expect(groups.map((group) => group.key)).toEqual(["uuid-me", "uuid-bob"]);
        expect(groups[0].sessions).toHaveLength(3);
        expect(groups[1].sessions).toHaveLength(1);
    });

    it("makes this tab the row for yourself, with your other sessions after it (this map first)", () => {
        const [mine] = groupSessions(
            [
                session({ spaceUserId: `${ELSEWHERE}_7`, uuid: "uuid-me", playUri: ELSEWHERE, roomName: "Lobby" }),
                session({ spaceUserId: `${HERE}_3`, uuid: "uuid-me", playUri: HERE }),
                session({ spaceUserId: `${HERE}_1`, uuid: "uuid-me", playUri: HERE }),
            ],
            me,
            HERE,
            statusOf
        );

        expect(mine.isMe).toBe(true);
        expect(mine.sessions.map((s) => s.spaceUserId)).toEqual([`${HERE}_1`, `${HERE}_3`, `${ELSEWHERE}_7`]);
    });

    it("stands someone else's row for a session on your map, even a less available one", () => {
        const [bob] = groupSessions(
            [
                session({ spaceUserId: `${ELSEWHERE}_7`, uuid: "uuid-bob", playUri: ELSEWHERE }),
                session({ spaceUserId: `${HERE}_4`, uuid: "uuid-bob", playUri: HERE, status: AvailabilityStatus.AWAY }),
            ],
            me,
            HERE,
            statusOf
        );

        expect(bob.isMe).toBe(false);
        expect(bob.primary.spaceUserId).toBe(`${HERE}_4`);
    });

    it("stands the row for the most available session when none is on your map", () => {
        const [bob] = groupSessions(
            [
                session({
                    spaceUserId: "a_1",
                    uuid: "uuid-bob",
                    playUri: ELSEWHERE,
                    status: AvailabilityStatus.SILENT,
                }),
                session({ spaceUserId: "b_2", uuid: "uuid-bob", playUri: "other", status: AvailabilityStatus.ONLINE }),
            ],
            me,
            HERE,
            statusOf
        );

        expect(bob.primary.spaceUserId).toBe("b_2");
    });

    it("keeps entries without an account id apart", () => {
        const groups = groupSessions(
            [session({ spaceUserId: "x_1" }), session({ spaceUserId: "x_2" })],
            me,
            HERE,
            statusOf
        );
        expect(groups).toHaveLength(2);
    });
});

describe("pickSessionToReach", () => {
    const sessions = [
        session({ spaceUserId: `${HERE}_4`, uuid: "uuid-bob", playUri: HERE }),
        session({ spaceUserId: `${HERE}_5`, uuid: "uuid-bob", playUri: HERE }),
        session({ spaceUserId: `${ELSEWHERE}_6`, uuid: "uuid-bob", playUri: ELSEWHERE }),
    ];
    const positions = new Map([
        [4, { x: 500, y: 500 }],
        [5, { x: 110, y: 100 }],
    ]);

    it("picks the session on your map closest to you", () => {
        const picked = pickSessionToReach({ primary: sessions[0], sessions }, HERE, { x: 100, y: 100 }, (id) =>
            positions.get(id)
        );
        expect(picked.spaceUserId).toBe(`${HERE}_5`);
    });

    it("falls back to the row's session when no avatar is in view", () => {
        const picked = pickSessionToReach(
            { primary: sessions[0], sessions },
            HERE,
            { x: 100, y: 100 },
            () => undefined
        );
        expect(picked).toBe(sessions[0]);
    });
});

describe("statuses", () => {
    it("ranks online first and disconnected last", () => {
        expect(availabilityRank(AvailabilityStatus.ONLINE)).toBeLessThan(availabilityRank(AvailabilityStatus.BUSY));
        expect(availabilityRank(AvailabilityStatus.BUSY)).toBeLessThan(availabilityRank(AvailabilityStatus.SILENT));
        expect(availabilityRank(AvailabilityStatus.SILENT)).toBeLessThan(
            availabilityRank(AvailabilityStatus.UNCHANGED)
        );
    });

    it("shows a person as available as their most available session", () => {
        expect(bestStatus([AvailabilityStatus.SILENT, AvailabilityStatus.AWAY])).toBe(AvailabilityStatus.AWAY);
        expect(bestStatus([])).toBeUndefined();
    });
});

describe("isMyAccount", () => {
    it("recognises another of your sessions by account", () => {
        expect(isMyAccount({ spaceUserId: `${HERE}_9`, uuid: "uuid-me" }, me)).toBe(true);
        expect(isMyAccount({ chatId: "@me:matrix.test" }, me)).toBe(true);
        expect(isMyAccount({ spaceUserId: `${HERE}_2`, uuid: "uuid-bob", chatId: "@bob:matrix.test" }, me)).toBe(false);
    });
});

describe("splitBots", () => {
    const row = (name: string, isBot: boolean, sessions = 1) => ({
        primary: { username: name, isBot },
        sessions: Array.from({ length: sessions }, () => name),
    });

    it("puts bots in their own list and keeps the order of each", () => {
        const { people, bots } = splitBots([
            row("Anas", false),
            row("Attio", true),
            row("Yousef", false),
            row("Dosu", true),
        ]);
        expect(people.map((p) => p.primary.username)).toEqual(["Anas", "Yousef"]);
        expect(bots.map((b) => b.primary.username)).toEqual(["Attio", "Dosu"]);
    });

    it("counts sessions, so the groups add up to the room's count", () => {
        const all = [row("Khalid", false, 3), row("Anas", false), row("Attio", true)];
        const { people, bots } = splitBots(all);
        expect(sessionCount(people)).toBe(4);
        expect(sessionCount(bots)).toBe(1);
        expect(sessionCount(people) + sessionCount(bots)).toBe(sessionCount(all));
    });
});
