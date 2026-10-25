import { describe, expect, it } from "vitest";
import { MAX_LIVE_READERS, usedReaders } from "../readerBudget";

describe("usedReaders", () => {
    const open = ["a", "b", "c", "d", "e"];

    it("keeps only the item in front and the one used before it, out of five open", () => {
        let recent: string[] = [];
        for (const picked of open) recent = usedReaders(recent, picked, open);

        expect(recent).toEqual(["e", "d"]);
        expect(recent).toHaveLength(MAX_LIVE_READERS);
    });

    it("brings an item forward to the front of the list, and lets go of the oldest", () => {
        expect(usedReaders(["e", "d"], "b", open)).toEqual(["b", "e"]);
        expect(usedReaders(["e", "d"], "d", open)).toEqual(["d", "e"]);
    });

    it("forgets an item that was closed, and keeps what is left", () => {
        expect(usedReaders(["e", "d"], "d", ["a", "b", "c", "d"])).toEqual(["d"]);
        expect(usedReaders(["e", "d"], "a", ["a", "d"])).toEqual(["a", "d"]);
    });

    it("keeps the same items while nothing is picked", () => {
        expect(usedReaders(["e", "d"], undefined, open)).toEqual(["e", "d"]);
        expect(usedReaders([], undefined, open)).toEqual([]);
    });
});
