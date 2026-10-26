import { describe, expect, it } from "vitest";
import { describeRoom } from "../src/Services/RoomDescription";

const person = (uuid: string, name: string) => ({ uuid, name, tags: [] as string[] });

describe("describeRoom", () => {
    it("counts everyone in nbUsers, as before, and the bots apart", () => {
        const room = describeRoom("https://play.test/@/u/w/r", [
            person("alice", "Alice"),
            { uuid: "bot-1", name: "Helper", tags: [] },
            { uuid: "abc", name: "Guide", tags: ["bot"] },
            person("guest-1", "Sam"),
        ]);
        expect(room).toEqual({
            roomId: "https://play.test/@/u/w/r",
            nbUsers: 4,
            nbBots: 2,
            peopleNames: ["Alice", "Sam"],
        });
    });

    it("names a person once however many tabs they have open, A to Z", () => {
        const room = describeRoom("r", [
            person("zed", "zed"),
            person("me", "Khalid"),
            person("me", "Khalid"),
            person("a", "ahmad"),
        ]);
        expect(room.nbUsers).toBe(4);
        expect(room.nbBots).toBe(0);
        expect(room.peopleNames).toEqual(["ahmad", "Khalid", "zed"]);
    });

    it("lists no names for a room of bots", () => {
        expect(describeRoom("r", [{ uuid: "bot-1", name: "Helper", tags: ["bot"] }])).toEqual({
            roomId: "r",
            nbUsers: 1,
            nbBots: 1,
            peopleNames: [],
        });
    });
});
