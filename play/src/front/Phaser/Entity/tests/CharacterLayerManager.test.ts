import { afterEach, describe, expect, it, vi } from "vitest";

const sceneHolder = vi.hoisted(() => ({ scene: undefined as unknown }));
const lazyLoad = vi.hoisted(() => vi.fn(() => new Promise(() => {})));

vi.mock("../../Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => {
            if (!sceneHolder.scene) throw new Error("Not the Game Scene");
            return sceneHolder.scene;
        },
        tryGetCurrentGameScene: () => sceneHolder.scene,
    },
}));
vi.mock("../PlayerTexturesLoadingManager", () => ({ lazyLoadPlayerCharacterTextures: lazyLoad }));

import { gameSceneIsLoadedStore } from "../../../Stores/GameSceneStore";
import { CharacterLayerManager } from "../CharacterLayerManager";

describe("CharacterLayerManager.wokaBase64 during a reconnect", () => {
    afterEach(() => {
        sceneHolder.scene = undefined;
        gameSceneIsLoadedStore.set(false);
    });

    it("does not throw while there is no map, and draws the woka once the map is back", async () => {
        expect(() => CharacterLayerManager.wokaBase64([{ id: "color_1", url: "color_1.png" }])).not.toThrow();
        await Promise.resolve();
        expect(lazyLoad).not.toHaveBeenCalled();

        const superLoad = {};
        sceneHolder.scene = { superLoad };
        gameSceneIsLoadedStore.set(true);
        await vi.waitFor(() =>
            expect(lazyLoad).toHaveBeenCalledWith(superLoad, [{ id: "color_1", url: "color_1.png" }])
        );
    });

    it("draws the woka on the new map, not the destroyed one, when the load fails because the map was swapped", async () => {
        lazyLoad.mockClear();
        const oldSuperLoad = { name: "old" };
        const newSuperLoad = { name: "new" };
        sceneHolder.scene = { superLoad: oldSuperLoad };

        lazyLoad.mockImplementationOnce(() => {
            // A reconnect swaps the map while the first load is in flight, and that load fails.
            sceneHolder.scene = { superLoad: newSuperLoad };
            return Promise.reject(new Error("Trying to load a spritesheet in a Scene that is already destroyed."));
        });

        void CharacterLayerManager.wokaBase64([{ id: "color_1", url: "color_1.png" }]);

        await vi.waitFor(() =>
            expect(lazyLoad).toHaveBeenCalledWith(newSuperLoad, [{ id: "color_1", url: "color_1.png" }])
        );
        // The fallback textures must never be requested from the destroyed scene.
        for (const call of lazyLoad.mock.calls as unknown[][]) {
            if (call[0] === oldSuperLoad) {
                expect(call[1]).toEqual([{ id: "color_1", url: "color_1.png" }]);
            }
        }
    });
});
