import { describe, expect, it } from "vitest";
import type { NameTemplates, TopRowArea, TopRowPerson, TypingTemplates } from "../TopRowSummary";
import { formatPeopleNames, formatTypingLine, resolveMeetingAreaName, resolveTopRowState } from "../TopRowSummary";

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
