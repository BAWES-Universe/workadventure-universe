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
});
