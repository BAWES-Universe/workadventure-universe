import CancelablePromise from "cancelable-promise";
import { ResourceLoadError } from "../Services/SuperLoaderPlugin";
import type { SuperLoaderPlugin } from "../Services/SuperLoaderPlugin";
import { SEPARATE_CACHE_PARAM, withSeparateCache } from "../../Utils/SeparateCacheUrl";
import { PlayerTexturesKey } from "./PlayerTextures";
import { reportWokaLoadStalled, WOKA_STALL_REPORT_MS } from "./WokaLoadReporter";
import type { WokaTextureDescriptionInterface, PlayerTextures } from "./PlayerTextures";
import Texture = Phaser.Textures.Texture;
import LoaderPlugin = Phaser.Loader.LoaderPlugin;

/**
 * A Woka or companion picture that has not arrived after this long is asked for again (the loader retries twice), then
 * counts as failed so the stand-in shows. Without it, a request that stalls (a phone coming back to the app) waits
 * forever and the Woka is never drawn.
 */
export const WOKA_LOAD_TIMEOUT_MS = 10_000;
// Only the timeout: Phaser keeps the file's own settings for every field left out (an image needs its "blob" type).
export const wokaXhrSettings = { timeout: WOKA_LOAD_TIMEOUT_MS } as Phaser.Types.Loader.XHRSettingsObject;

export { SEPARATE_CACHE_PARAM };

/**
 * The address to ask again at when a Woka picture from another site failed right away, or undefined when asking again
 * would not help.
 *
 * Orbit shows Woka pictures as plain pictures, and Orbit and the game share the browser's cache. When Orbit showed a
 * picture first, the cached copy lacks the header that lets the game read it, and the browser answers the game from
 * that copy: the load fails at once and the Woka shows as the stand-in (#1133). The same address with one more query
 * field has no cached copy, so the storage is asked and answers with the header.
 */
export function separateCacheUrl(url: string, error: unknown, elapsedMs: number): string | undefined {
    // A timeout was already asked again by the loader; a picture that arrived but can't be read won't change.
    if (!(error instanceof ResourceLoadError) || error.reason !== "load-error" || elapsedMs >= WOKA_LOAD_TIMEOUT_MS) {
        return undefined;
    }
    return withSeparateCache(url);
}

export interface FrameConfig {
    frameWidth: number;
    frameHeight: number;
}

export const loadAllLayers = (
    load: LoaderPlugin,
    playerTextures: PlayerTextures
): WokaTextureDescriptionInterface[][] => {
    const returnArray: WokaTextureDescriptionInterface[][] = [];
    playerTextures.getLayers().forEach((layer) => {
        const layerArray: WokaTextureDescriptionInterface[] = [];
        Object.values(layer).forEach((textureDescriptor) => {
            layerArray.push(textureDescriptor);
            if (!textureDescriptor.url) {
                console.warn("Player resource has no URL", textureDescriptor);
                return;
            }
            load.spritesheet(textureDescriptor.id, textureDescriptor.url, { frameWidth: 32, frameHeight: 32 });
        });
        returnArray.push(layerArray);
    });
    return returnArray;
};
export const loadAllDefaultModels = (
    load: LoaderPlugin,
    playerTextures: PlayerTextures
): WokaTextureDescriptionInterface[] => {
    const returnArray = Object.values(playerTextures.getTexturesResources(PlayerTexturesKey.Woka));
    returnArray.forEach((playerResource: WokaTextureDescriptionInterface) => {
        if (!playerResource.url) {
            console.warn("Player resource has no URL", playerResource);
            return;
        }
        load.spritesheet(playerResource.id, playerResource.url, { frameWidth: 32, frameHeight: 32 });
    });
    return returnArray;
};

/** Loads one Woka or companion picture, asking once more at a separate address when the cached copy is refused. */
export const loadWokaSpritesheet = (
    superLoaderPlugin: SuperLoaderPlugin,
    key: string,
    url: string
): CancelablePromise<Texture> => {
    const startedAt = Date.now();
    const load = (address: string) =>
        superLoaderPlugin.spritesheet(
            key,
            address,
            {
                frameWidth: 32,
                frameHeight: 32,
            },
            wokaXhrSettings
        );
    return load(url).catch((error: unknown) => {
        const retryUrl = separateCacheUrl(url, error, Date.now() - startedAt);
        if (retryUrl === undefined) {
            throw error;
        }
        return load(retryUrl);
    });
};

export const loadWokaTexture = (
    superLoaderPlugin: SuperLoaderPlugin,
    texture: WokaTextureDescriptionInterface
): CancelablePromise<Texture> => {
    return loadWokaSpritesheet(superLoaderPlugin, texture.id, texture.url);
};

export const lazyLoadPlayerCharacterTextures = (
    superLoaderPlugin: SuperLoaderPlugin,
    textures: WokaTextureDescriptionInterface[]
): CancelablePromise<string[]> => {
    const promisesList: CancelablePromise<Texture>[] = [];
    for (const texture of textures) {
        promisesList.push(loadWokaSpritesheet(superLoaderPlugin, texture.id, texture.url));
    }
    const returnPromise: CancelablePromise<Texture[]> = CancelablePromise.all(promisesList);

    // The loader can also go silent (a phone coming back to the app, a room rebuilt mid-load): no answer, no error.
    // Say so once, unless the room was simply closed meanwhile.
    const stallTimer = setTimeout(() => {
        if (!returnPromise.isCanceled() && !superLoaderPlugin.isSceneDestroyed()) {
            reportWokaLoadStalled(textures.map((texture) => ({ id: texture.id, url: texture.url })));
        }
    }, WOKA_STALL_REPORT_MS);
    const stopStallTimer = () => clearTimeout(stallTimer);
    returnPromise.then(stopStallTimer, stopStallTimer);

    return returnPromise.then(() =>
        textures.map((key) => {
            return key.id;
        })
    );
};
