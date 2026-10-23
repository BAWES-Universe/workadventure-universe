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
const getSnapshot = vi.hoisted(() => vi.fn());
vi.mock("../../Helpers/TexturesHelper", () => ({ TexturesHelper: { getSnapshot } }));

import { gameSceneIsLoadedStore } from "../../../Stores/GameSceneStore";
import { CharacterLayerManager } from "../CharacterLayerManager";
import { CharacterTextureError } from "../../../Exception/CharacterTextureError";

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

describe("CharacterLayerManager.wokaBase64 when the scene is reset while the frames update", () => {
    const spriteScenes: unknown[] = [];

    // A scene as Phaser leaves it once it is shut down: `sys.displayList` is gone.
    const deadScene = () => ({ superLoad: {}, sys: { displayList: null }, textures: { exists: () => true } });
    const liveScene = () => ({ superLoad: {}, sys: { displayList: {} }, textures: { exists: () => true } });

    const stubPhaser = () => {
        spriteScenes.length = 0;
        vi.stubGlobal("Phaser", {
            GameObjects: {
                Sprite: class {
                    constructor(scene: unknown) {
                        spriteScenes.push(scene);
                    }
                },
            },
        });
    };

    afterEach(() => {
        vi.unstubAllGlobals();
        sceneHolder.scene = undefined;
        gameSceneIsLoadedStore.set(false);
    });

    it("draws the woka on the scene that is live after the yield, not on the one captured before", async () => {
        const stale = liveScene() as { sys: { displayList: unknown } };
        const live = liveScene();
        stubPhaser();
        lazyLoad.mockReset();
        getSnapshot.mockReset();
        reportFailure.mockReset();
        getSnapshot.mockResolvedValue("data:image/png;base64,live");
        lazyLoad.mockImplementation(() => {
            // Registered before the code under test queues its own yield, so it fires first: the scene is torn
            // down and replaced while the textures are "loaded".
            setTimeout(() => {
                stale.sys.displayList = null;
                sceneHolder.scene = live;
            }, 0);
            return Promise.resolve(["color_1"]);
        });
        sceneHolder.scene = stale;
        gameSceneIsLoadedStore.set(true);

        await expect(CharacterLayerManager.wokaBase64([{ id: "color_1", url: "color_1.png" }])).resolves.toBe(
            "data:image/png;base64,live"
        );

        // The sprites were created on, and the snapshot taken from, the live scene only.
        expect(spriteScenes).toEqual([live]);
        expect(spriteScenes[0]).not.toBe(stale);
        expect(getSnapshot).toHaveBeenCalledTimes(1);
        expect(getSnapshot.mock.calls[0][0]).toBe(live);
        expect(getSnapshot.mock.calls[0][0]).not.toBe(stale);
        // The Woka's own pictures were enough: no stand-in, nothing reported.
        expect(lazyLoad).toHaveBeenCalledTimes(1);
        expect(reportFailure).not.toHaveBeenCalled();
    });

    it("falls back to the stand-in path, without an unhandled rejection, when the re-acquired scene is dead too", async () => {
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            const capturedScene = deadScene();
            const reacquiredScene = deadScene();
            stubPhaser();
            lazyLoad.mockReset();
            getSnapshot.mockReset();
            reportFailure.mockReset();
            lazyLoad.mockImplementation(() => Promise.resolve(["color_1"]));
            sceneHolder.scene = capturedScene;
            gameSceneIsLoadedStore.set(true);
            const failures: unknown[] = [];

            const result = CharacterLayerManager.wokaBase64([{ id: "color_1", url: "color_1.png" }]);
            // Swap in the second dead scene while the frames update.
            setTimeout(() => {
                sceneHolder.scene = reacquiredScene;
            }, 0);
            await result.catch((error) => failures.push(error));
            // Give a stray unhandled rejection the chance to be reported.
            await new Promise((resolve) => {
                setTimeout(resolve, 10);
            });

            // The guard refused the dead scene both times, the stand-in was tried, and it failed the same way.
            expect(failures).toHaveLength(1);
            expect(failures[0]).toBeInstanceOf(CharacterTextureError);
            expect((failures[0] as Error).message).toBe("scene not ready");
            expect(lazyLoad).toHaveBeenCalledTimes(2);
            expect(lazyLoad).toHaveBeenLastCalledWith(reacquiredScene.superLoad, [
                { id: "color_22", url: "resources/customisation/character_color/character_color21.png" },
                { id: "eyes_23", url: "resources/customisation/character_eyes/character_eyes23.png" },
            ]);
            // No sprite was ever built and no snapshot taken on a dead scene.
            expect(spriteScenes).toEqual([]);
            expect(getSnapshot).not.toHaveBeenCalled();
            expect(reportFailure).toHaveBeenCalledTimes(1);
            expect(reportFailure).toHaveBeenCalledWith("snapshot", expect.any(CharacterTextureError), {
                textures: [{ id: "color_1", url: "color_1.png" }],
                standInError: failures[0],
            });
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });
});
