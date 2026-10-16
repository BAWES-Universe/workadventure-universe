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
const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("../WokaLoadReporter", () => ({ reportWokaLoadFailure: reportFailure }));

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

describe("CharacterLayerManager.wokaBase64 when the pictures can't be loaded", () => {
    afterEach(() => {
        sceneHolder.scene = undefined;
        gameSceneIsLoadedStore.set(false);
    });

    it("fails without drawing the stand-in when asked for no stand-in", async () => {
        const failure = new Error('Failed loading "spritesheet": "melon.png"');
        lazyLoad.mockReset();
        lazyLoad.mockImplementation(() => Promise.reject(failure));
        sceneHolder.scene = { superLoad: {} };
        gameSceneIsLoadedStore.set(true);

        await expect(
            CharacterLayerManager.wokaBase64([{ id: "melon", url: "melon.png" }], { standIn: false })
        ).rejects.toBe(failure);
        // Only the Woka's own pictures were asked for: no stand-in body.
        expect(lazyLoad).toHaveBeenCalledTimes(1);
    });

    it("asks for the stand-in body by default", async () => {
        lazyLoad.mockReset();
        lazyLoad.mockImplementationOnce(() => Promise.reject(new Error("Failed loading")));
        lazyLoad.mockImplementationOnce(() => new Promise(() => {}));
        sceneHolder.scene = { superLoad: {} };
        gameSceneIsLoadedStore.set(true);

        void CharacterLayerManager.wokaBase64([{ id: "melon", url: "melon.png" }]);
        await vi.waitFor(() => expect(lazyLoad).toHaveBeenCalledTimes(2));
        expect(lazyLoad).toHaveBeenLastCalledWith({}, [
            { id: "color_22", url: "resources/customisation/character_color/character_color21.png" },
            { id: "eyes_23", url: "resources/customisation/character_eyes/character_eyes23.png" },
        ]);
    });

    it("reports to Sentry that nothing could be drawn when the stand-in fails too", async () => {
        const first = new Error("Failed loading");
        const second = new Error("stand-in gone");
        lazyLoad.mockReset();
        reportFailure.mockReset();
        lazyLoad.mockImplementationOnce(() => Promise.reject(first));
        lazyLoad.mockImplementationOnce(() => Promise.reject(second));
        sceneHolder.scene = { superLoad: {} };
        gameSceneIsLoadedStore.set(true);

        await expect(CharacterLayerManager.wokaBase64([{ id: "melon", url: "melon.png" }])).rejects.toBe(second);
        expect(reportFailure).toHaveBeenCalledWith("snapshot", first, {
            textures: [{ id: "melon", url: "melon.png" }],
            standInError: second,
        });
    });

    it("reports nothing when the Woka's own pictures load, or when no stand-in was asked for", async () => {
        lazyLoad.mockReset();
        reportFailure.mockReset();
        lazyLoad.mockImplementation(() => Promise.reject(new Error("Failed loading")));
        sceneHolder.scene = { superLoad: {} };
        gameSceneIsLoadedStore.set(true);

        await expect(
            CharacterLayerManager.wokaBase64([{ id: "melon", url: "melon.png" }], { standIn: false })
        ).rejects.toThrow();
        expect(reportFailure).not.toHaveBeenCalled();
    });
});
