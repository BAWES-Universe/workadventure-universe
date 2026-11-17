import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "universe.brick.closedCards";

/** The store reads the device's memory when it loads: each test loads it anew. */
async function load() {
    vi.resetModules();
    return import("../ClosedBrickCards");
}

describe("the Brick cards a person closed", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("stay closed, each on its own: the ways to start of one chat, the ideas under one answer", async () => {
        const { closeBrickCard, closedBrickCards, ideasCardKey, startersCardKey } = await load();
        expect(get(closedBrickCards).size).toBe(0);
        closeBrickCard(startersCardKey("!one:chat.test"));
        expect(get(closedBrickCards).has(startersCardKey("!one:chat.test"))).toBe(true);
        expect(get(closedBrickCards).has(startersCardKey("!two:chat.test"))).toBe(false);
        expect(get(closedBrickCards).has(ideasCardKey("!one:chat.test"))).toBe(false);
        closeBrickCard(ideasCardKey("answer-1"));
        expect(get(closedBrickCards).has(ideasCardKey("answer-1"))).toBe(true);
        expect(get(closedBrickCards).has(ideasCardKey("answer-2"))).toBe(false);
    });

    it("are still closed after a reload", async () => {
        const first = await load();
        first.closeBrickCard(first.startersCardKey("!one:chat.test"));
        const second = await load();
        expect(get(second.closedBrickCards).has(second.startersCardKey("!one:chat.test"))).toBe(true);
    });

    it("are written once however often the same card is closed", async () => {
        const { closeBrickCard, closedBrickCards } = await load();
        closeBrickCard("starters:!one");
        closeBrickCard("starters:!one");
        expect([...get(closedBrickCards)]).toEqual(["starters:!one"]);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual(["starters:!one"]);
    });

    it("keep only the newest 40", async () => {
        const { closeBrickCard, closedBrickCards } = await load();
        for (let i = 0; i < 45; i++) closeBrickCard("ideas:answer-" + String(i));
        const kept = get(closedBrickCards);
        expect(kept.size).toBe(40);
        expect(kept.has("ideas:answer-4")).toBe(false);
        expect(kept.has("ideas:answer-5")).toBe(true);
        expect(kept.has("ideas:answer-44")).toBe(true);
    });

    it("count nothing as closed when the device's memory holds something else, or cannot be read", async () => {
        localStorage.setItem(STORAGE_KEY, '{"not":"a list"}');
        expect(get((await load()).closedBrickCards).size).toBe(0);
        localStorage.setItem(STORAGE_KEY, "not json");
        expect(get((await load()).closedBrickCards).size).toBe(0);
        localStorage.setItem(STORAGE_KEY, '["starters:!one", 7, null]');
        expect([...get((await load()).closedBrickCards)]).toEqual(["starters:!one"]);
    });

    it("stay closed for this visit when the device's memory cannot be written", async () => {
        const { closeBrickCard, closedBrickCards } = await load();
        const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("full");
        });
        closeBrickCard("starters:!one");
        expect(get(closedBrickCards).has("starters:!one")).toBe(true);
        write.mockRestore();
    });
});
