import { get, writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { wokaMenuStore } from "../WokaMenuStore";

describe("wokaMenuStore when players leave the map", () => {
    it("closes the card of the person who left", () => {
        wokaMenuStore.initialize("Mona", 7, "mona", undefined);
        wokaMenuStore.removeRemotePlayer("mona");
        expect(get(wokaMenuStore)).toBeUndefined();
    });

    it("leaves the card and its subscribers alone when someone else leaves", () => {
        wokaMenuStore.initialize("Mona", 7, "mona", undefined);
        const listener = vi.fn();
        const unsubscribe = wokaMenuStore.subscribe(listener);
        listener.mockClear();

        wokaMenuStore.removeRemotePlayer("stitch");

        expect(listener).not.toHaveBeenCalled();
        expect(get(wokaMenuStore)?.userUuid).toBe("mona");
        unsubscribe();
        wokaMenuStore.clear();
    });

    it("a card open while the map closes can't stop the rest of the interface updating", () => {
        // The person card's subscriber reads the current map; while a reconnect swaps the map there is none. Closing
        // the old map removes every other player, one by one: none of that may reach the card.
        wokaMenuStore.initialize("Mona", 7, "mona", undefined);
        let mapGone = false;
        const unsubscribe = wokaMenuStore.subscribe((card) => {
            if (card && mapGone) throw new Error("Not the Game Scene");
        });
        mapGone = true;

        for (const other of ["stitch", "lilo", "nani"]) {
            wokaMenuStore.removeRemotePlayer(other);
        }

        // Any other store in the app still notifies (a stuck queue would leave `seen` at its first value).
        const screen = writable("reconnecting");
        const seen: string[] = [];
        const stopWatching = screen.subscribe((value) => seen.push(value));
        screen.set("game");
        expect(seen).toEqual(["reconnecting", "game"]);
        stopWatching();
        unsubscribe();
        mapGone = false;
        wokaMenuStore.clear();
    });
});
