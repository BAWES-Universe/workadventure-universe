import { describe, expect, it, vi } from "vitest";

// A reconnect is swapping the map: there is no game scene to draw in.
vi.mock("../../Game/GameManager", () => {
    class GameSceneNotFoundError extends Error {}
    return {
        GameSceneNotFoundError,
        gameManager: {
            getCurrentGameScene: () => {
                throw new GameSceneNotFoundError("Not the Game Scene");
            },
            tryGetCurrentGameScene: () => undefined,
        },
    };
});
vi.mock("../PlayerTexturesLoadingManager", () => ({ lazyLoadPlayerCharacterTextures: vi.fn() }));

import { CharacterLayerManager } from "../CharacterLayerManager";

describe("CharacterLayerManager.wokaBase64 with no game scene", () => {
    it("fails the promise instead of throwing, so the store asking for it keeps working", async () => {
        let result: Promise<string> | undefined;
        expect(() => {
            result = CharacterLayerManager.wokaBase64([{ id: "color_1", url: "color_1.png" }]);
        }).not.toThrow();
        await expect(result).rejects.toThrow();
    });
});
