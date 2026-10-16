import CancelablePromise from "cancelable-promise";
import type { SuperLoaderPlugin } from "../Services/SuperLoaderPlugin";
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

export const loadWokaTexture = (
    superLoaderPlugin: SuperLoaderPlugin,
    texture: WokaTextureDescriptionInterface
): CancelablePromise<Texture> => {
    return superLoaderPlugin.spritesheet(
        texture.id,
        texture.url,
        {
            frameWidth: 32,
            frameHeight: 32,
        },
        wokaXhrSettings
    );
};

export const lazyLoadPlayerCharacterTextures = (
    superLoaderPlugin: SuperLoaderPlugin,
    textures: WokaTextureDescriptionInterface[]
): CancelablePromise<string[]> => {
    const promisesList: CancelablePromise<Texture>[] = [];
    for (const texture of textures) {
        promisesList.push(
            superLoaderPlugin.spritesheet(
                texture.id,
                texture.url,
                {
                    frameWidth: 32,
                    frameHeight: 32,
                },
                wokaXhrSettings
            )
        );
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
