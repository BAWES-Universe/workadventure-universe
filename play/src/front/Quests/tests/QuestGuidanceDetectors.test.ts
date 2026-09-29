import { writable } from "svelte/store";
import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { armQuestGuidance } from "../QuestGuidanceDetectors";
import type { CapabilityKey } from "../QuestGuidance";

function setup(initialEmote?: { at: number }) {
    const emotePlayed = writable<{ at: number } | undefined>(initialEmote);
    const saySent = new Subject<string>();
    const entityPlaced = new Subject<{ kind: string }>();
    const uses: CapabilityKey[] = [];
    const stop = armQuestGuidance(
        { emotePlayed, saySent, entityPlaced },
        (key) => uses.push(key),
        (command) => (command as { kind: string }).kind === "create"
    );
    return { emotePlayed, saySent, entityPlaced, uses, stop };
}

describe("armQuestGuidance", () => {
    it("does not count an emote played before the scene armed", () => {
        const { uses } = setup({ at: 5 });
        expect(uses).toEqual([]);
    });

    it("counts a new emote and a say bubble as Express uses", () => {
        const { emotePlayed, saySent, uses } = setup();
        emotePlayed.set({ at: 10 });
        saySent.next("say");
        expect(uses).toEqual(["express", "express"]);
    });

    it("counts the same emote reported twice once", () => {
        const { emotePlayed, uses } = setup();
        emotePlayed.set({ at: 10 });
        emotePlayed.set({ at: 10 });
        expect(uses).toEqual(["express"]);
    });

    it("counts only entity placements as building", () => {
        const { entityPlaced, uses } = setup();
        entityPlaced.next({ kind: "delete" });
        entityPlaced.next({ kind: "create" });
        expect(uses).toEqual(["build"]);
    });

    it("stops listening once disarmed", () => {
        const { emotePlayed, saySent, entityPlaced, uses, stop } = setup();
        stop();
        emotePlayed.set({ at: 1 });
        saySent.next("say");
        entityPlaced.next({ kind: "create" });
        expect(uses).toEqual([]);
    });
});
