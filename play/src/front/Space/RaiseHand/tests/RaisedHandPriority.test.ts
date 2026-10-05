import { describe, expect, it } from "vitest";
import { priorityWithRaisedHand, RAISED_HAND_PRIORITY } from "../RaisedHandPriority";
import { stableNSort } from "../../../Stores/StableNSorter";

const box = (spaceUserId: string, uuid: string, priority: number, uniqueId = spaceUserId) => ({
    uniqueId,
    priority,
    spaceUser: { spaceUserId, uuid } as never,
});

describe("priorityWithRaisedHand", () => {
    const hands = new Map([
        ["sara", 1],
        ["omar", 2],
    ]);

    it("puts a raised hand after whoever is talking and before everyone else", () => {
        expect(priorityWithRaisedHand(box("s1", "sara", 11999), hands)).toBe(RAISED_HAND_PRIORITY + 1);
        expect(priorityWithRaisedHand(box("o1", "omar", 20000), hands)).toBe(RAISED_HAND_PRIORITY + 2);
        // Talking (2000 + rank) keeps its place in front.
        expect(priorityWithRaisedHand(box("s1", "sara", 2001), hands)).toBe(2001);
        // No hand: unchanged.
        expect(priorityWithRaisedHand(box("n1", "noura", 11999), hands)).toBe(11999);
    });

    it("leaves screen shares alone", () => {
        expect(priorityWithRaisedHand(box("s1", "sara", 1500, "screensharing_s1"), hands)).toBe(1500);
        expect(priorityWithRaisedHand(box("s1", "sara", 20000, "screensharing_s1"), hands)).toBe(20000);
    });

    it('brings a raised hand from behind "+N" into the spots that show', () => {
        const people = [box("a", "a", 20000), box("b", "b", 20000), box("c", "c", 20000), box("d", "d", 20000)];
        const order: string[] = [];
        stableNSort(new Map(people.map((p) => [p.uniqueId, p])), 2, order);
        expect(order.slice(0, 2)).toEqual(["a", "b"]);

        const handUp = new Map([["d", 1]]);
        const withHand = people.map((p) => ({ ...p, priority: priorityWithRaisedHand(p, handUp) }));
        const { items } = stableNSort(new Map(withHand.map((p) => [p.uniqueId, p])), 2, order);
        expect(items.slice(0, 2).map((p) => p.uniqueId)).toContain("d");
    });
});
