import { describe, expect, it } from "vitest";
import { countPeople } from "./WorldUserProvider";

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
