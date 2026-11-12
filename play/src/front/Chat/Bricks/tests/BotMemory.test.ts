import { get } from "svelte/store";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const orbit = vi.hoisted(() => ({
    getMyMemory: vi.fn<(botId: string) => Promise<unknown>>(),
    forgetMyMemory: vi.fn<(botId: string, what: unknown) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: orbit }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import LL, { setLocale } from "../../../../i18n/i18n-svelte";
import { botMemoryList, parseMyMemory, sayItem, type MemoryItem } from "../BotMemory";

const BOT = "0b7c1d2e-1111-4222-8333-944455556666";
const DAY = Date.parse("2026-11-06T10:00:00.000Z");

const thing = (over: Partial<MemoryItem> = {}): Record<string, unknown> => ({
    id: "k1",
    kind: "pref",
    value: "lo-fi",
    label: null,
    at: DAY,
    private: false,
    ...over,
});

describe("what a bot remembers about the person (#2003)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    describe("reading Orbit's list", () => {
        it("keeps whole things and leaves out what is not", () => {
            expect(
                parseMyMemory({
                    items: [
                        thing(),
                        thing({ id: "", value: "no key" }),
                        thing({ id: "k2", value: "  " }),
                        thing({ id: "k3", kind: "secret" as never }),
                        thing({ id: "k4", at: -5 }),
                        null,
                    ],
                })
            ).toEqual([
                { id: "k1", kind: "pref", value: "lo-fi", label: null, at: DAY, private: false },
                { id: "k4", kind: "pref", value: "lo-fi", label: null, at: null, private: false },
            ]);
            expect(parseMyMemory(undefined)).toEqual([]);
            expect(parseMyMemory({ items: "x" })).toEqual([]);
        });
    });

    describe("what each thing says", () => {
        const say = (over: Partial<MemoryItem>) =>
            sayItem(parseMyMemory({ items: [thing(over)] })[0], get(LL), "en-US");

        it("puts a thing into plain words with where it came from", () => {
            expect(say({})).toEqual({ text: "Likes lo-fi", note: "From a chat on 6 Nov", private: false });
            expect(say({ kind: "name", value: "Sara" }).text).toBe("Your name is Sara");
            expect(say({ kind: "birthday", value: "June 5" }).text).toBe("Your birthday is June 5");
            expect(say({ kind: "fact", label: "current_state", value: "tired" }).text).toBe("Said you were tired");
            expect(say({ kind: "fact", label: "favorite_color", value: "blue" }).text).toBe("blue");
        });

        it("says only 'From a chat' when the bot did not keep the day", () => {
            expect(say({ at: null }).note).toBe("From a chat");
        });

        it("says what was said privately is kept out of group chats", () => {
            expect(say({ private: true })).toMatchObject({
                note: "Said privately · kept out of group chats",
                private: true,
            });
        });
    });

    describe("the list", () => {
        it("reads what Orbit says for this bot", async () => {
            orbit.getMyMemory.mockResolvedValue({ items: [thing()] });
            const list = botMemoryList(BOT);
            expect(get(list.state)).toBe("loading");
            await list.load();
            expect(orbit.getMyMemory).toHaveBeenCalledWith(BOT);
            expect(get(list.state)).toBe("ready");
            expect(get(list.items).map((item) => item.value)).toEqual(["lo-fi"]);
        });

        it("says so when it could not read, and shows no list it did not read", async () => {
            orbit.getMyMemory.mockRejectedValue(new Error("offline"));
            const list = botMemoryList(BOT);
            await list.load();
            expect(get(list.state)).toBe("failed");
            expect(get(list.items)).toEqual([]);
        });

        it("forgets one thing at once, by its key, and keeps the rest", async () => {
            orbit.getMyMemory.mockResolvedValue({ items: [thing(), thing({ id: "k2", value: "jazz" })] });
            orbit.forgetMyMemory.mockResolvedValue({ forgotten: 1 });
            const list = botMemoryList(BOT);
            await list.load();
            const done = list.forget("k1");
            expect(get(list.items).map((item) => item.id)).toEqual(["k2"]);
            expect(await done).toBe(true);
            expect(orbit.forgetMyMemory).toHaveBeenCalledWith(BOT, { itemId: "k1" });
        });

        it("brings the thing back, where it was, when Orbit refuses", async () => {
            orbit.getMyMemory.mockResolvedValue({ items: [thing(), thing({ id: "k2", value: "jazz" })] });
            orbit.forgetMyMemory.mockRejectedValue(new Error("offline"));
            const list = botMemoryList(BOT);
            await list.load();
            expect(await list.forget("k1")).toBe(false);
            expect(get(list.items).map((item) => item.id)).toEqual(["k1", "k2"]);
        });

        it("brings back each thing that fails, in any order, and keeps one that is forgotten", async () => {
            orbit.getMyMemory.mockResolvedValue({
                items: [thing(), thing({ id: "k2", value: "jazz" }), thing({ id: "k3", value: "tea" })],
            });
            const answers: { resolve: () => void; reject: (error: Error) => void }[] = [];
            orbit.forgetMyMemory.mockImplementation(
                () =>
                    new Promise((resolve, reject) => {
                        answers.push({ resolve: () => resolve({ forgotten: 1 }), reject });
                    })
            );
            const list = botMemoryList(BOT);
            await list.load();
            const first = list.forget("k1");
            const second = list.forget("k2");
            const third = list.forget("k3");
            expect(get(list.items)).toEqual([]);
            // The first fails before the second does: the second goes on being gone
            answers[0].reject(new Error("offline"));
            expect(await first).toBe(false);
            expect(get(list.items).map((item) => item.id)).toEqual(["k1"]);
            answers[2].resolve();
            expect(await third).toBe(true);
            answers[1].reject(new Error("offline"));
            expect(await second).toBe(false);
            expect(get(list.items).map((item) => item.id)).toEqual(["k1", "k2"]);
        });

        it("forgets everything, and brings it all back when Orbit refuses", async () => {
            orbit.getMyMemory.mockResolvedValue({ items: [thing(), thing({ id: "k2" })] });
            orbit.forgetMyMemory.mockResolvedValueOnce({ forgotten: 2, everything: true });
            const list = botMemoryList(BOT);
            await list.load();
            expect(await list.forgetEverything()).toBe(true);
            expect(orbit.forgetMyMemory).toHaveBeenCalledWith(BOT, { everything: true });
            expect(get(list.items)).toEqual([]);

            orbit.getMyMemory.mockResolvedValue({ items: [thing(), thing({ id: "k2" })] });
            await list.load();
            orbit.forgetMyMemory.mockRejectedValueOnce(new Error("offline"));
            expect(await list.forgetEverything()).toBe(false);
            expect(get(list.items)).toHaveLength(2);
        });
    });
});
