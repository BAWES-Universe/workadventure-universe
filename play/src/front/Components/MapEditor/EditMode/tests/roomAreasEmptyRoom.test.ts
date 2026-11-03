import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { AreaData } from "@workadventure/map-editor";

let areas: Map<string, AreaData> | undefined;

vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => ({
            getGameMapFrontWrapper: () => ({ getAreas: () => areas }),
            getMapEditorModeManager: () => undefined,
        }),
    },
}));

import { roomAreasStore } from "../roomAreas";

function area(id: string, name: string): AreaData {
    return { id, name, x: 0, y: 0, width: 32, height: 32, visible: true, properties: [] } as unknown as AreaData;
}

describe("roomAreasStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows no areas in a room without any, instead of the areas the previous room left in the store", () => {
        // First room: the panel is open and shows its areas.
        areas = new Map([["a", area("a", "Portal to Food Capital")]]);
        const unsubscribeFirst = roomAreasStore.subscribe(() => undefined);
        expect(get(roomAreasStore).map((a) => a.name)).toEqual(["Portal to Food Capital"]);
        unsubscribeFirst();

        // The portal closes the panel; the next room has no areas, and the panel opens again.
        areas = new Map();
        const unsubscribeSecond = roomAreasStore.subscribe(() => undefined);
        expect(get(roomAreasStore)).toEqual([]);
        unsubscribeSecond();
    });

    it("follows the room's areas as they change", () => {
        areas = new Map();
        const seen: string[][] = [];
        const unsubscribe = roomAreasStore.subscribe((list) => seen.push(list.map((a) => a.name)));
        areas = new Map([["b", area("b", "Stage")]]);
        vi.advanceTimersByTime(1000);
        unsubscribe();
        expect(seen[seen.length - 1]).toEqual(["Stage"]);
    });
});
