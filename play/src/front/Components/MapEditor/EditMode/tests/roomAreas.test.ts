import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { AreaData } from "@workadventure/map-editor";

let currentScene: unknown;
vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene: () => currentScene },
}));

import { roomAreasStore } from "../roomAreas";

function area(id: string, name: string): AreaData {
    return { id, name, x: 0, y: 0, width: 10, height: 10, visible: true, properties: [] } as AreaData;
}

function sceneWith(...areas: AreaData[]) {
    return {
        getGameMapFrontWrapper: () => ({ getAreas: () => new Map(areas.map((a) => [a.id, a])) }),
        getMapEditorModeManager: () => ({ currentlyActiveTool: undefined }),
    };
}

describe("roomAreasStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists the areas of the room the player is in now, also after walking through a portal", () => {
        currentScene = sceneWith(area("1", "Portal to Food Capital"), area("2", "Way out"));
        const names: string[][] = [];
        const unsubscribe = roomAreasStore.subscribe((areas) => names.push(areas.map((a) => a.name)));
        expect(get(roomAreasStore).map((a) => a.name)).toEqual(["Portal to Food Capital", "Way out"]);

        // The player walks through a portal: another scene is current, with other areas.
        currentScene = sceneWith(area("1", "Kitchen"));
        vi.advanceTimersByTime(1100);
        expect(get(roomAreasStore).map((a) => a.name)).toEqual(["Kitchen"]);
        unsubscribe();
    });
});
