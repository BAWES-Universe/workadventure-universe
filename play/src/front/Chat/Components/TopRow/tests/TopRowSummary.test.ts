import { describe, expect, it } from "vitest";
import type { NameTemplates, TopRowArea, TopRowPerson, TypingTemplates } from "../TopRowSummary";
import {
    countWorldPresence,
    formatHereLine,
    formatPeopleNames,
    formatTypingLine,
    peopleOnThisMap,
    resolveMeetingAreaName,
    resolveTopRowState,
} from "../TopRowSummary";

const names: NameTemplates = {
    two: ({ first, second }) => `${first} & ${second}`,
    more: ({ first, second, count }) => `${first}, ${second} +${count}`,
};

const typing: TypingTemplates = {
    one: ({ name }) => `${name} is typing`,
    two: ({ first, second }) => `${first} & ${second} are typing`,
    many: ({ count }) => `${count} people are typing`,
    someone: "Someone",
};

const sara: TopRowPerson = { id: "s", name: "Sara" };
const omar: TopRowPerson = { id: "o", name: "Omar" };

describe("formatPeopleNames", () => {
    it("names one, two, or two and a count", () => {
        expect(formatPeopleNames([], names)).toBe("");
        expect(formatPeopleNames(["Sara"], names)).toBe("Sara");
        expect(formatPeopleNames(["Sara", "Omar"], names)).toBe("Sara & Omar");
        expect(formatPeopleNames(["Sara", "Omar", "Lina"], names)).toBe("Sara, Omar +1");
        expect(formatPeopleNames(["Sara", "Omar", "Lina", "Tom", "Ada"], names)).toBe("Sara, Omar +3");
    });

    it("keeps clones with the same name, and skips blank names", () => {
        expect(formatPeopleNames(["Sara", "Sara"], names)).toBe("Sara & Sara");
        expect(formatPeopleNames(["  ", "Omar"], names)).toBe("Omar");
    });
});

describe("formatTypingLine", () => {
    it("says who is typing", () => {
        expect(formatTypingLine([], typing)).toBeUndefined();
        expect(formatTypingLine(["Sara"], typing)).toBe("Sara is typing");
        expect(formatTypingLine(["Sara", "Omar"], typing)).toBe("Sara & Omar are typing");
        expect(formatTypingLine(["Sara", "Omar", "Lina"], typing)).toBe("3 people are typing");
    });

    it("falls back to someone for a member without a name", () => {
        expect(formatTypingLine([null], typing)).toBe("Someone is typing");
    });
});

describe("resolveMeetingAreaName", () => {
    it("prefers the area name, then the room name, then the fallback", () => {
        expect(resolveMeetingAreaName("Headquarters", "hq-room", "Meeting")).toBe("Headquarters");
        expect(resolveMeetingAreaName("  ", "hq-room", "Meeting")).toBe("hq-room");
        expect(resolveMeetingAreaName(undefined, "", "Meeting")).toBe("Meeting");
    });
});

describe("resolveTopRowState", () => {
    const noAreas: TopRowArea[] = [];

    it("is alone with no space", () => {
        expect(resolveTopRowState({ spaceKind: "none", spaceName: "", participants: [], areas: noAreas })).toEqual({
            kind: "alone",
        });
    });

    it("names the people in a bubble", () => {
        expect(
            resolveTopRowState({
                spaceKind: "bubble",
                spaceName: "Proximity Chat",
                participants: [sara],
                areas: noAreas,
            })
        ).toEqual({ kind: "withPeople", people: [sara], areaName: undefined });
    });

    it("names the area in a meeting with people, and says only you when the meeting's space is empty", () => {
        expect(
            resolveTopRowState({ spaceKind: "meeting", spaceName: "Board room", participants: [sara], areas: noAreas })
        ).toEqual({ kind: "withPeople", people: [sara], areaName: "Board room" });
        expect(
            resolveTopRowState({ spaceKind: "meeting", spaceName: "Board room", participants: [], areas: noAreas })
        ).toEqual({ kind: "meetingAlone", areaName: "Board room" });
    });

    it("never claims a speaker zone is empty: listeners are not listed", () => {
        expect(
            resolveTopRowState({ spaceKind: "stream", spaceName: "Stage", participants: [], areas: noAreas })
        ).toEqual({ kind: "area", areaName: "Stage" });
    });

    it("counts video participants in a meeting without chat", () => {
        const withOthers: TopRowArea[] = [{ kind: "video", name: "Standup", participants: [sara, omar] }];
        expect(resolveTopRowState({ spaceKind: "none", spaceName: "", participants: [], areas: withOthers })).toEqual({
            kind: "withPeople",
            people: [sara, omar],
            areaName: "Standup",
        });

        const empty: TopRowArea[] = [{ kind: "video", name: "Standup", participants: [] }];
        expect(resolveTopRowState({ spaceKind: "none", spaceName: "", participants: [], areas: empty })).toEqual({
            kind: "meetingAlone",
            areaName: "Standup",
        });
    });

    it("names a Matrix-only area without claiming who is there", () => {
        const matrix: TopRowArea[] = [{ kind: "matrix", name: "Library" }];
        expect(resolveTopRowState({ spaceKind: "none", spaceName: "", participants: [], areas: matrix })).toEqual({
            kind: "area",
            areaName: "Library",
        });
    });

    it("prefers the people in your bubble over an area you stand in", () => {
        const matrix: TopRowArea[] = [{ kind: "matrix", name: "Library" }];
        expect(resolveTopRowState({ spaceKind: "bubble", spaceName: "", participants: [omar], areas: matrix })).toEqual(
            { kind: "withPeople", people: [omar], areaName: undefined }
        );
    });
});

describe("countWorldPresence", () => {
    const here = "https://play.example.test/@/org/world/hq";
    const other = "https://play.example.test/@/org/world/garden";

    it("splits by map and excludes only this tab's own avatar", () => {
        const users = [
            { spaceUserId: "me", playUri: here },
            // A clone of this account, in the same map: it counts.
            { spaceUserId: "me-tab-2", playUri: here },
            { spaceUserId: "sara", playUri: here + "?x=1#start" },
            { spaceUserId: "omar", playUri: other },
            { spaceUserId: "ghost", playUri: undefined },
        ];
        expect(countWorldPresence(users, "me", here)).toEqual({ here: 2, elsewhere: 2 });
    });

    it("counts everyone when this tab's avatar is unknown", () => {
        expect(countWorldPresence([{ spaceUserId: "sara", playUri: here }], undefined, here)).toEqual({
            here: 1,
            elsewhere: 0,
        });
    });
});

describe("peopleOnThisMap", () => {
    const here = "http://play.test/_/global/maps.test/map.json";
    const there = "http://play.test/_/global/maps.test/other.json";

    it("lists everyone on this map except this tab, clones included", () => {
        const users = [
            { spaceUserId: "me", playUri: here },
            { spaceUserId: "omar", playUri: here },
            { spaceUserId: "me-clone", playUri: here },
            { spaceUserId: "sara", playUri: there },
            { spaceUserId: "nowhere", playUri: undefined },
        ];
        expect(peopleOnThisMap(users, "me", here).map((user) => user.spaceUserId)).toEqual(["omar", "me-clone"]);
    });
});

describe("formatHereLine", () => {
    const templates = {
        you: "You",
        onlyYou: "Only you here",
        elsewhere: ({ count }: { count: number }) => `${count} elsewhere in this world`,
        separator: " · ",
        two: ({ first, second }: { first: string; second: string }) => `${first} & ${second}`,
        more: ({ first, second, count }: { first: string; second: string; count: number }) =>
            `${first}, ${second} +${count}`,
    };

    it("names who is here with you", () => {
        expect(formatHereLine(["Omar"], 0, templates)).toBe("You & Omar");
        expect(formatHereLine(["Omar", "Sara", "Lea"], 4, templates)).toBe("You, Omar +2");
    });

    it("says you're alone, and how many are elsewhere", () => {
        expect(formatHereLine([], 0, templates)).toBe("Only you here");
        expect(formatHereLine([], 12, templates)).toBe("Only you here · 12 elsewhere in this world");
    });
});
