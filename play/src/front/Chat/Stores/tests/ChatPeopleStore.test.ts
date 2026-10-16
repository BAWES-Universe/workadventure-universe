import { get, readable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { ChatPersonAnswer } from "@workadventure/messages";
import type { ChatUser } from "../../Connection/ChatConnection";
import { ChatPeople, chatPeopleOf, firstPicture, isAwayMember, worldKnowsWoka } from "../ChatPeopleStore";

const WOKA = [{ id: "male1", url: "resources/male1.png" }];

/** A question the test answers by hand, when it likes. */
function manualAsk() {
    const pending: { chatId: string; resolve: (answer: ChatPersonAnswer) => void; reject: (error: Error) => void }[] =
        [];
    const ask = vi.fn(
        (chatId: string) =>
            new Promise<ChatPersonAnswer>((resolve, reject) => {
                pending.push({ chatId, resolve, reject });
            })
    );
    return { ask, pending };
}

describe("ChatPeople", () => {
    it("asks Orbit about a person once, and keeps the answer: their name and a picture", async () => {
        const ask = vi.fn((chatId: string) =>
            Promise.resolve<ChatPersonAnswer>({ wokaName: " Alice ", characterTextures: WOKA })
        );
        const people = new ChatPeople(ask);

        people.request("@alice:m");
        people.request("@alice:m");
        await vi.waitFor(() => expect(get(people.store).has("@alice:m")).toBe(true));
        people.request("@alice:m");

        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask).toHaveBeenCalledWith("@alice:m");
        const alice = get(people.store).get("@alice:m");
        expect(alice?.name).toBe("Alice");
        expect(alice?.picture).toBeDefined();
    });

    it("keeps a name without a picture, a picture without a name, and nothing for an empty answer (but does not ask again)", async () => {
        const answers: Record<string, ChatPersonAnswer> = {
            "@named:m": { wokaName: "Named", characterTextures: [] },
            "@dressed:m": { characterTextures: WOKA },
            "@nobody:m": { characterTextures: [] },
        };
        const ask = vi.fn((chatId: string) => Promise.resolve(answers[chatId]));
        const people = new ChatPeople(ask);
        for (const chatId of Object.keys(answers)) people.request(chatId);
        await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(3));
        await vi.waitFor(() => expect(get(people.store).size).toBe(2));

        expect(get(people.store).get("@named:m")).toEqual({ name: "Named", picture: undefined });
        expect(get(people.store).get("@dressed:m")?.name).toBeUndefined();
        expect(get(people.store).get("@dressed:m")?.picture).toBeDefined();
        people.request("@nobody:m");
        expect(ask).toHaveBeenCalledTimes(3);
    });

    it("has only three questions out at once, and asks the rest as they come back", async () => {
        const { ask, pending } = manualAsk();
        const people = new ChatPeople(ask);
        for (const n of [1, 2, 3, 4, 5]) people.request(`@p${n}:m`);

        expect(ask).toHaveBeenCalledTimes(3);
        pending[0].resolve({ characterTextures: [] });
        await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(4));
        pending[1].resolve({ characterTextures: [] });
        await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(5));
        expect(ask.mock.calls.map(([chatId]) => chatId)).toEqual(["@p1:m", "@p2:m", "@p3:m", "@p4:m", "@p5:m"]);
    });

    it("does not ask again while the first question is out", () => {
        const { ask } = manualAsk();
        const people = new ChatPeople(ask);
        people.request("@alice:m");
        people.request("@alice:m");
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it("asks again after a minute when the question failed, not before", async () => {
        let time = 1_000;
        const ask = vi
            .fn<(chatId: string) => Promise<ChatPersonAnswer>>()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValue({ wokaName: "Alice", characterTextures: [] });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const people = new ChatPeople(ask, () => time);

        people.request("@alice:m");
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        time += 59_000;
        people.request("@alice:m");
        expect(ask).toHaveBeenCalledTimes(1);

        time += 2_000;
        people.request("@alice:m");
        await vi.waitFor(() => expect(get(people.store).get("@alice:m")?.name).toBe("Alice"));
        expect(ask).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

describe("ChatPeople refresh", () => {
    it("asks again for a person whose answer is two minutes old, and shows the new name and picture", async () => {
        let time = 1_000;
        const ask = vi
            .fn<(chatId: string) => Promise<ChatPersonAnswer>>()
            .mockResolvedValueOnce({ wokaName: "Alice", characterTextures: [] })
            .mockResolvedValue({ wokaName: "Alice B.", characterTextures: WOKA });
        const people = new ChatPeople(ask, () => time);

        people.request("@alice:m");
        await vi.waitFor(() => expect(get(people.store).get("@alice:m")?.name).toBe("Alice"));
        time += 119_000;
        people.request("@alice:m");
        expect(ask).toHaveBeenCalledTimes(1);

        time += 1_000;
        people.request("@alice:m");
        await vi.waitFor(() => expect(get(people.store).get("@alice:m")?.name).toBe("Alice B."));
        expect(ask).toHaveBeenCalledTimes(2);
        expect(get(people.store).get("@alice:m")?.picture).toBeDefined();
    });

    it("keeps the old name on screen while the new answer is out, and when it fails", async () => {
        let time = 1_000;
        const retries: (() => void)[] = [];
        const ask = vi
            .fn<(chatId: string) => Promise<ChatPersonAnswer>>()
            .mockResolvedValueOnce({ wokaName: "Alice", characterTextures: [] })
            .mockRejectedValueOnce(new Error("network"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const people = new ChatPeople(
            ask,
            () => time,
            (retry) => retries.push(retry)
        );

        people.request("@alice:m");
        await vi.waitFor(() => expect(get(people.store).get("@alice:m")?.name).toBe("Alice"));
        time += 120_000;
        people.request("@alice:m");
        // The question is out: asking again does nothing
        people.request("@alice:m");
        expect(ask).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());

        expect(get(people.store).get("@alice:m")?.name).toBe("Alice");
        warn.mockRestore();
    });

    it("keeps to three questions at once when many old answers are refreshed together", async () => {
        let time = 1_000;
        const ask = vi.fn((_chatId: string) =>
            Promise.resolve<ChatPersonAnswer>({ wokaName: "x", characterTextures: [] })
        );
        const people = new ChatPeople(ask, () => time);
        const chatIds = ["@p1:m", "@p2:m", "@p3:m", "@p4:m", "@p5:m"];
        for (const chatId of chatIds) people.request(chatId);
        await vi.waitFor(() => expect(get(people.store).size).toBe(5));
        expect(ask).toHaveBeenCalledTimes(5);

        time += 120_000;
        for (const chatId of chatIds) people.request(chatId);

        expect(ask).toHaveBeenCalledTimes(8);
        await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(10));
    });
});

describe("ChatPeople retries", () => {
    it("asks again on its own a minute after a failure, while the chat stays open", async () => {
        let time = 1_000;
        const retries: (() => void)[] = [];
        const ask = vi
            .fn<(chatId: string) => Promise<ChatPersonAnswer>>()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValue({ wokaName: "Alice", characterTextures: [] });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const people = new ChatPeople(
            ask,
            () => time,
            (retry, delayMs) => {
                expect(delayMs).toBe(60_000);
                retries.push(retry);
            }
        );

        people.request("@alice:m");
        await vi.waitFor(() => expect(retries).toHaveLength(1));
        // A timer may run a little early by the wall clock: the retry still asks
        time += 59_990;
        retries[0]();
        await vi.waitFor(() => expect(get(people.store).get("@alice:m")?.name).toBe("Alice"));
        expect(ask).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it("stops retrying on its own after three failures in a row", async () => {
        let time = 1_000;
        const retries: (() => void)[] = [];
        const ask = vi.fn<(chatId: string) => Promise<ChatPersonAnswer>>().mockRejectedValue(new Error("down"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const people = new ChatPeople(
            ask,
            () => time,
            (retry) => retries.push(retry)
        );

        people.request("@alice:m");
        const retryAfterFailure = async (attempt: number) => {
            await vi.waitFor(() => expect(retries).toHaveLength(attempt));
            time += 60_000;
            retries[attempt - 1]();
        };
        await retryAfterFailure(1);
        await retryAfterFailure(2);
        await retryAfterFailure(3);
        await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(4));
        await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(4));
        expect(retries).toHaveLength(3);
        warn.mockRestore();
    });
});

describe("chatPeopleOf", () => {
    it("is one set of people per connection, and none without a connection", () => {
        const connection = { queryChatPerson: vi.fn() };
        const other = { queryChatPerson: vi.fn() };
        expect(chatPeopleOf(undefined)).toBeUndefined();
        expect(chatPeopleOf(connection)).toBe(chatPeopleOf(connection));
        expect(chatPeopleOf(connection)).not.toBe(chatPeopleOf(other));
    });

    it("asks through the connection", async () => {
        const connection = {
            queryChatPerson: vi.fn(() =>
                Promise.resolve<ChatPersonAnswer>({ wokaName: "Alice", characterTextures: [] })
            ),
        };
        const people = chatPeopleOf(connection);
        people?.request("@alice:m");
        await vi.waitFor(() => expect(get(people!.store).get("@alice:m")?.name).toBe("Alice"));
        expect(connection.queryChatPerson).toHaveBeenCalledWith("@alice:m");
    });
});

function user(chatId: string, extra: Partial<ChatUser> = {}): ChatUser {
    return {
        chatId,
        availabilityStatus: readable(0),
        username: chatId,
        pictureStore: readable(undefined),
        roomName: undefined,
        playUri: undefined,
        color: undefined,
        spaceUserId: undefined,
        ...extra,
    };
}

describe("worldKnowsWoka", () => {
    const usersByRoom = (users: ChatUser[]) => new Map([["map", { roomName: "Map", users }]]);

    it("is true for someone in the world right now, and for someone whose saved Woka the member list carries", () => {
        const world = usersByRoom([
            user("@live:m", { spaceUserId: "7", pictureStore: readable("live.png") }),
            user("@member:m", { storedWoka: readable("stored.png") }),
        ]);
        expect(worldKnowsWoka(world, "@live:m")).toBe(true);
        expect(worldKnowsWoka(world, "@member:m")).toBe(true);
    });

    it("is false for a chat partner the world has no picture for: only the chat knows them, or a member without a Woka", () => {
        const world = usersByRoom([user("@chat:m", { pictureStore: readable("account.png") }), user("@bare:m")]);
        expect(worldKnowsWoka(world, "@chat:m")).toBe(false);
        expect(worldKnowsWoka(world, "@bare:m")).toBe(false);
        expect(worldKnowsWoka(world, "@nobody:m")).toBe(false);
        expect(worldKnowsWoka(new Map(), "@nobody:m")).toBe(false);
    });
});

describe("isAwayMember", () => {
    const usersByRoom = (users: ChatUser[]) => new Map([["map", { roomName: "Map", users }]]);

    it("is true for a member the list carries a Woka for who is not in the room, and false for everyone else", () => {
        const world = usersByRoom([
            user("@live:m", {
                spaceUserId: "7",
                pictureStore: readable("live.png"),
                storedWoka: readable("stored.png"),
            }),
            user("@away:m", { storedWoka: readable("stored.png") }),
            user("@bare:m"),
        ]);
        expect(isAwayMember(world, "@away:m")).toBe(true);
        expect(isAwayMember(world, "@live:m")).toBe(false);
        expect(isAwayMember(world, "@bare:m")).toBe(false);
        expect(isAwayMember(world, "@nobody:m")).toBe(false);
    });
});

describe("firstPicture", () => {
    it("is the first picture that has one, and the same store for the same pair", () => {
        const first = readable<string | undefined>(undefined);
        const second = readable<string | undefined>("orbit.png");
        const both = firstPicture(first, second);
        expect(get(both)).toBe("orbit.png");
        expect(firstPicture(first, second)).toBe(both);
        expect(get(firstPicture(readable("world.png"), second))).toBe("world.png");
    });
});
