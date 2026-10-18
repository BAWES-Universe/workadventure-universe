import { beforeAll, describe, expect, it, vi } from "vitest";
import CancelablePromise from "cancelable-promise";
import { ResourceLoadError } from "../../Services/SuperLoaderPlugin";
import {
    lazyLoadPlayerCharacterTextures,
    separateCacheUrl,
    WOKA_LOAD_TIMEOUT_MS,
} from "../PlayerTexturesLoadingManager";

beforeAll(() => {
    vi.stubGlobal("Phaser", { Textures: { Texture: class {} } });
});

const ORBIT_PICTURE = "https://storage.example.com/map-templates/avatar-textures/set/melon.png?t=1780671829835";
const loadError = (url: string) =>
    new ResourceLoadError(`Failed loading "spritesheet": "${url}"`, "melon", url, "load-error");

describe("separateCacheUrl", () => {
    it("adds wa_cors to a picture from another site that failed at once, keeping its own query", () => {
        const retry = separateCacheUrl(ORBIT_PICTURE, loadError(ORBIT_PICTURE), 20);
        expect(retry).toBe(`${ORBIT_PICTURE}&wa_cors=1`);
    });

    it("does not ask again for the game's own pictures", () => {
        const own = new URL("/resources/customisation/character_color/character_color2.png", window.location.href).href;
        expect(separateCacheUrl(own, loadError(own), 20)).toBeUndefined();
        expect(separateCacheUrl("character_color2.png", loadError("character_color2.png"), 20)).toBeUndefined();
    });

    it("does not ask again after a timeout, a picture that can't be read, or a second failure", () => {
        expect(separateCacheUrl(ORBIT_PICTURE, loadError(ORBIT_PICTURE), WOKA_LOAD_TIMEOUT_MS)).toBeUndefined();
        const notDecoded = new ResourceLoadError("x", "melon", ORBIT_PICTURE, "not-decoded");
        expect(separateCacheUrl(ORBIT_PICTURE, notDecoded, 20)).toBeUndefined();
        const retried = `${ORBIT_PICTURE}&wa_cors=1`;
        expect(separateCacheUrl(retried, loadError(retried), 20)).toBeUndefined();
    });
});

describe("lazyLoadPlayerCharacterTextures", () => {
    it("asks once more at the separate address when an Orbit picture fails, and draws it", async () => {
        const texture = {};
        const spritesheet = vi.fn((key: string, url: string) =>
            url === ORBIT_PICTURE ? CancelablePromise.reject(loadError(url)) : CancelablePromise.resolve(texture)
        );
        const loader = { spritesheet, isSceneDestroyed: () => false };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ids = await lazyLoadPlayerCharacterTextures(loader as any, [{ id: "melon", url: ORBIT_PICTURE }]);

        expect(ids).toEqual(["melon"]);
        expect(spritesheet).toHaveBeenCalledTimes(2);
        expect(spritesheet.mock.calls[1][1]).toBe(`${ORBIT_PICTURE}&wa_cors=1`);
        expect(spritesheet.mock.calls[1][0]).toBe("melon");
    });

    it("still fails, so the stand-in shows, when the second ask fails too", async () => {
        const spritesheet = vi.fn((key: string, url: string) => CancelablePromise.reject(loadError(url)));
        const loader = { spritesheet, isSceneDestroyed: () => false };

        await expect(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lazyLoadPlayerCharacterTextures(loader as any, [{ id: "melon", url: ORBIT_PICTURE }])
        ).rejects.toBeInstanceOf(ResourceLoadError);
        expect(spritesheet).toHaveBeenCalledTimes(2);
    });

    it("asks only once for a picture that loads", async () => {
        const spritesheet = vi.fn(() => CancelablePromise.resolve({}));
        const loader = { spritesheet, isSceneDestroyed: () => false };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await lazyLoadPlayerCharacterTextures(loader as any, [{ id: "melon", url: ORBIT_PICTURE }]);
        expect(spritesheet).toHaveBeenCalledTimes(1);
    });
});
