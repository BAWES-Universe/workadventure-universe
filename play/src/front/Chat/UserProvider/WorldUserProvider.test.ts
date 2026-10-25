import { describe, expect, it } from "vitest";
import { countPeople, countPeopleAndBots } from "./WorldUserProvider";

describe("countPeople", () => {
    it("counts each tab of one account (clones) as a person", () => {
        expect(
            countPeople([
                { spaceUserId: "room_1", uuid: "me" },
                { spaceUserId: "room_2", uuid: "me" },
                { spaceUserId: "room_3", uuid: "bob" },
            ])
        ).toBe(3);
    });

    it("counts the same tab once", () => {
        expect(
            countPeople([
                { spaceUserId: "room_1", uuid: "me" },
                { spaceUserId: "room_1", uuid: "me" },
            ])
        ).toBe(1);
    });

    it("falls back to the uuid without a space user id", () => {
        expect(countPeople([{ uuid: "bob" }, { uuid: "bob" }, { uuid: "eve" }])).toBe(2);
    });
});

describe("countPeopleAndBots", () => {
    it("counts bots apart from people, and everyone else (guests, you) as a person", () => {
        expect(countPeopleAndBots([{ isBot: false }, { isBot: true }, {}, { isBot: true }, { isBot: true }])).toEqual({
            people: 2,
            bots: 3,
        });
    });

    it("is zero and zero for an empty room", () => {
        expect(countPeopleAndBots([])).toEqual({ people: 0, bots: 0 });
    });

    it("is all bots when only bots are there", () => {
        expect(countPeopleAndBots([{ isBot: true }, { isBot: true }])).toEqual({ people: 0, bots: 2 });
    });
});
