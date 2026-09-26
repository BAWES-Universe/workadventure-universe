import { afterEach, describe, expect, it, vi } from "vitest";

const sceneHolder = vi.hoisted(() => ({ scene: undefined as unknown }));

vi.mock("../GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => {
            if (!sceneHolder.scene) throw new Error("Not the Game Scene");
            return sceneHolder.scene;
        },
        tryGetCurrentGameScene: () => sceneHolder.scene,
    },
}));

import { gameSceneIsLoadedStore } from "../../../Stores/GameSceneStore";
import { waitForGameScene, whenGameScene } from "../WhenGameScene";

describe("whenGameScene", () => {
    afterEach(() => {
        sceneHolder.scene = undefined;
        gameSceneIsLoadedStore.set(false);
    });

    it("runs right away when there is a map", () => {
        sceneHolder.scene = { name: "map" };
        const run = vi.fn();
        whenGameScene(run);
        expect(run).toHaveBeenCalledWith(sceneHolder.scene);
    });

    it("waits while a reconnect swaps the map, then runs once the map is back", () => {
        const run = vi.fn();
        whenGameScene(run);
        expect(run).not.toHaveBeenCalled();

        sceneHolder.scene = { name: "new map" };
        gameSceneIsLoadedStore.set(true);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(sceneHolder.scene);

        gameSceneIsLoadedStore.set(false);
        gameSceneIsLoadedStore.set(true);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("stops waiting, or undoes what it set up, when stopped", () => {
        const run = vi.fn();
        const stop = whenGameScene(run);
        stop();
        sceneHolder.scene = { name: "new map" };
        gameSceneIsLoadedStore.set(true);
        expect(run).not.toHaveBeenCalled();

        const cleanup = vi.fn();
        whenGameScene(() => cleanup)();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("waitForGameScene resolves once the map is back", async () => {
        const scene = waitForGameScene();
        sceneHolder.scene = { name: "new map" };
        gameSceneIsLoadedStore.set(true);
        await expect(scene).resolves.toBe(sceneHolder.scene);
    });
});
