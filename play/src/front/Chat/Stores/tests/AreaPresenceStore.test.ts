import { get, writable } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";
import type { SpaceUserExtended } from "../../../Space/SpaceInterface";
import { areaPresenceStore, clearAreaPresence } from "../AreaPresenceStore";

describe("areaPresenceStore", () => {
    afterEach(() => {
        clearAreaPresence();
    });

    it("forgets every area when the scene closes, so nothing leaks to the next map", () => {
        const usersStore = writable(new Map<string, SpaceUserExtended>());
        areaPresenceStore.set("meeting-property", { kind: "video", name: "Standup", usersStore });
        areaPresenceStore.set("matrix-property", { kind: "matrix", name: "Library" });
        expect(get(areaPresenceStore).size).toBe(2);

        clearAreaPresence();

        expect(get(areaPresenceStore).size).toBe(0);
        expect(areaPresenceStore.get("meeting-property")).toBeUndefined();
    });

    it("notifies subscribers when cleared", () => {
        areaPresenceStore.set("matrix-property", { kind: "matrix", name: "Library" });
        const sizes: number[] = [];
        const unsubscribe = areaPresenceStore.subscribe((areas) => sizes.push(areas.size));

        clearAreaPresence();
        unsubscribe();

        expect(sizes).toEqual([1, 0]);
    });
});
