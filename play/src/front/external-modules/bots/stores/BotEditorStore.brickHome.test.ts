import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store only needs the API service to exist; nothing here reaches the network
vi.mock("../services/BotApiService", () => ({
    botApiService: { isInitialized: () => false },
}));

import type { BotData } from "../types";
import {
    botEditorModeStore,
    botPreviewsStore,
    confirmPlacement,
    onBrickPlaced,
    placementCursorStore,
    placingBotStore,
} from "./BotEditorStore";

const brick = {
    id: "brick-1",
    name: "Recipe Brick",
    behaviorType: "idle",
    brickHome: true,
    behaviorConfig: { assignedSpace: { center: { x: 0, y: 0 }, radius: 40 } },
} as unknown as BotData;

describe("placing one of the person's own Bricks in a room (#2005)", () => {
    let off: (() => void) | undefined;

    beforeEach(() => {
        botPreviewsStore.set(new Map());
        placingBotStore.set(brick);
        placementCursorStore.set({ x: 320, y: 480 });
        botEditorModeStore.set("placing");
    });
    afterEach(() => {
        off?.();
        off = undefined;
        placingBotStore.set(undefined);
        placementCursorStore.set(undefined);
    });

    it("hands the chosen spot to the editor, and never adds the Brick to the room's bots", () => {
        const heard = vi.fn();
        off = onBrickPlaced(heard);
        expect(confirmPlacement()).toBeUndefined();
        expect(heard).toHaveBeenCalledTimes(1);
        const [placed, spot] = heard.mock.calls[0] as [BotData, { behaviorConfig: BotData["behaviorConfig"] }];
        expect(placed.id).toBe("brick-1");
        // Only the spot: no behavior is made up and sent with it
        expect(spot).not.toHaveProperty("behaviorType");
        expect(Object.keys(spot.behaviorConfig)).toEqual(["assignedSpace"]);
        expect(spot.behaviorConfig.assignedSpace.center).toEqual({ x: 320, y: 480 });
        expect(spot.behaviorConfig.assignedSpace.radius).toBe(0);
        expect(get(botPreviewsStore).size).toBe(0);
        expect(get(placingBotStore)).toBeUndefined();
        expect(get(placementCursorStore)).toBeUndefined();
        expect(get(botEditorModeStore)).toBe("list");
    });

    it("stops telling the editor once it lets go", () => {
        const heard = vi.fn();
        off = onBrickPlaced(heard);
        off();
        placingBotStore.set(brick);
        placementCursorStore.set({ x: 1, y: 2 });
        confirmPlacement();
        expect(heard).not.toHaveBeenCalled();
    });
});
