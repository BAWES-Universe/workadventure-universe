import { describe, expect, it } from "vitest";
import { get, writable } from "svelte/store";
import type { SpaceInterface } from "../../Space/SpaceInterface";
import { countPeople, countPeopleAndBots, countPeopleElsewhere, WorldUserProvider } from "./WorldUserProvider";

function spaceUser(id: string, name: string, tags: string[] = []) {
    return {
        uuid: id,
        spaceUserId: `room_${id}`,
        name,
        tags,
        pictureStore: writable(undefined),
        reactiveUser: { availabilityStatus: writable(0) },
    };
}

describe("WorldUserProvider.peopleCount", () => {
    it("counts the people in the world without bots, and stays put while the People filter is typed in", async () => {
        const users = new Map([
            ["1", spaceUser("1", "Sara")],
            ["2", spaceUser("2", "Omar")],
            ["3", spaceUser("bot-3", "Helper", ["bot"])],
        ]);
        const space = { usersStore: writable(users) } as unknown as SpaceInterface;
        const provider = new WorldUserProvider(space);
        expect(get(provider.peopleCount)).toBe(2);
        await provider.setFilter("sara");
        expect(get(provider.users)).toHaveLength(1);
        expect(get(provider.peopleCount)).toBe(2);
    });
});

describe("WorldUserProvider search", () => {
    const world = () => {
        const users = new Map([
            ["1", spaceUser("1", "Sara")],
            ["2", spaceUser("2", "Bottle Bob")],
            ["3", spaceUser("bot-3", "Helper", ["bot"])],
            ["4", spaceUser("4", "Melody", ["bot"])],
        ]);
        return new WorldUserProvider({ usersStore: writable(users) } as unknown as SpaceInterface);
    };
    const names = (provider: WorldUserProvider) => get(provider.users).map((user) => user.username);

    it('finds every bot, whatever it is named, when "Bot" or "Brick" is typed whole (#1995)', async () => {
        const provider = world();
        for (const word of ["brick", "Bricks", "BOTS"]) {
            // eslint-disable-next-line no-await-in-loop
            await provider.setFilter(word);
            expect(names(provider)).toEqual(["Helper", "Melody"]);
        }
        // "bot" is also part of a person's name here: they are found as before, with the bots
        await provider.setFilter("bot");
        expect(names(provider)).toEqual(["Bottle Bob", "Helper", "Melody"]);
    });

    it("lists nobody extra while a name is being typed", async () => {
        const provider = world();
        await provider.setFilter("bri");
        expect(names(provider)).toEqual([]);
        await provider.setFilter("bo");
        expect(names(provider)).toEqual(["Bottle Bob"]);
        await provider.setFilter("mel");
        expect(names(provider)).toEqual(["Melody"]);
        await provider.setFilter("");
        expect(names(provider)).toHaveLength(4);
    });
});

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

describe("countPeopleElsewhere", () => {
    it("counts the people in this world's other rooms, bots and this room left out", () => {
        const usersByRoom = new Map<string | undefined, { users: { isBot?: boolean }[] }>([
            ["hq", { users: [{}, {}, { isBot: true }] }],
            ["cafe", { users: [{}, {}, {}, { isBot: true }, { isBot: true }, { isBot: true }, { isBot: true }] }],
            ["garden", { users: [{ isBot: true }] }],
            [undefined, { users: [{}] }],
        ]);
        expect(countPeopleElsewhere(usersByRoom, "hq")).toBe(3);
    });

    it("is 0 when only bots are elsewhere", () => {
        expect(countPeopleElsewhere(new Map([["lab", { users: [{ isBot: true }] }]]), "hq")).toBe(0);
    });
});
