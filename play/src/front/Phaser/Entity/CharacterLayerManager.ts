import type { CharacterTextureMessage } from "@workadventure/messages";
import type { GameScene } from "../Game/GameScene";
import { TexturesHelper } from "../Helpers/TexturesHelper";
import { CharacterTextureError } from "../../Exception/CharacterTextureError";
import { waitForGameScene } from "../Game/WhenGameScene";
import { lazyLoadPlayerCharacterTextures } from "./PlayerTexturesLoadingManager";
import { reportWokaLoadFailure } from "./WokaLoadReporter";

// Phaser.Scenes.SHUTDOWN: from this status on (SHUTDOWN, DESTROYED) a scene can no longer host new game objects.
const SCENE_STATUS_SHUTDOWN = 8;

/**
 * Class that let you generate a base64 image from a CharacterLayer[]
 */
export class CharacterLayerManager {
    /**
     * With `standIn: false`, a Woka whose pictures can't be loaded fails instead of drawing the plain stand-in body, so
     * the caller can show another picture of that person (the chat picture saved on their account).
     */
    static wokaBase64(
        characterTextures: CharacterTextureMessage[],
        { standIn = true }: { standIn?: boolean } = {}
    ): Promise<string> {
        // Asked from inside stores: during a reconnect there is no map for a moment, and asking then would throw
        // (freezing the interface). Draw the woka once the map is back instead.
        return waitForGameScene().then((scene) => this.drawWokaBase64(scene, characterTextures, standIn));
    }

    private static drawWokaBase64(
        scene: GameScene,
        characterTextures: CharacterTextureMessage[],
        standIn: boolean
    ): Promise<string> {
        const textureRefs = characterTextures.map((texture) => ({ id: texture.id, url: texture.url }));
        return lazyLoadPlayerCharacterTextures(scene.superLoad, textureRefs)
            .then(async (textures) => {
                // Wait 0 seconds to force the promise to be async and let Phaser frames update.
                // The scene may be destroyed or reset during this yield, so re-acquire it afterward
                // to guarantee we always operate on a live, initialised scene.
                await new Promise((resolve) => {
                    setTimeout(resolve, 0);
                });
                const liveScene = await waitForGameScene();
                return this.getSnapshot(liveScene, this.getSprites(liveScene, textures)).then((htmlImageElementSrc) => {
                    return htmlImageElementSrc;
                });
            })
            .catch((error) => {
                // Without a stand-in the caller has its own plan B (the chat picture): nothing to report here.
                if (!standIn) throw error;
                return waitForGameScene()
                    .then((liveScene) =>
                        lazyLoadPlayerCharacterTextures(liveScene.superLoad, [
                            {
                                id: "color_22",
                                url: "resources/customisation/character_color/character_color21.png",
                            },
                            {
                                id: "eyes_23",
                                url: "resources/customisation/character_eyes/character_eyes23.png",
                            },
                        ]).then((textures) => {
                            return this.getSnapshot(liveScene, this.getSprites(liveScene, textures)).then(
                                (htmlImageElementSrc) => {
                                    reportWokaLoadFailure("snapshot", error, { textures: textureRefs });
                                    return htmlImageElementSrc;
                                }
                            );
                        })
                    )
                    .catch((e) => {
                        reportWokaLoadFailure("snapshot", error, { textures: textureRefs, standInError: e });
                        throw e;
                    });
            });
    }

    /**
     * A scene sprites can still be built on. Phaser drops `sys.displayList` once a scene is destroyed, and a scene that is
     * shutting down (map change, reconnect) is about to lose it: building a sprite on either throws in `queueDepthSort`.
     */
    private static isSceneAlive(scene: GameScene | undefined): boolean {
        const sys = scene?.sys;
        if (!sys?.displayList) return false;
        // Scenes stubbed in tests (or torn down) may have no settings at all.
        const status = (sys.settings as { status?: number } | undefined)?.status;
        return status === undefined || status < SCENE_STATUS_SHUTDOWN;
    }

    private static async getSnapshot(
        scene: GameScene,
        sprites: Map<string, Phaser.GameObjects.Sprite>
    ): Promise<string> {
        if (!CharacterLayerManager.isSceneAlive(scene)) {
            throw new CharacterTextureError("scene not ready");
        }
        return TexturesHelper.getSnapshot(
            scene,
            ...Array.from(sprites.values()).map((sprite) => ({ sprite, frame: 1 }))
        ).catch((reason) => {
            console.warn(reason);
            for (const sprite of sprites.values()) {
                // we can be sure that either predefined woka or body texture is at this point loaded
                if (sprite.texture.key.includes("color") || sprite.texture.key.includes("male")) {
                    return scene.textures.getBase64(sprite.texture.key);
                }
            }
            return "male1";
        });
    }

    private static getSprites(
        scene: GameScene,
        textures: string[],
        frame?: string | number
    ): Map<string, Phaser.GameObjects.Sprite> {
        const sprites = new Map<string, Phaser.GameObjects.Sprite>();
        if (textures.length < 1) {
            throw new CharacterTextureError("no texture given");
        }
        if (!CharacterLayerManager.isSceneAlive(scene)) {
            throw new CharacterTextureError("scene not ready");
        }

        for (const texture of textures) {
            if (scene && !scene.textures.exists(texture)) {
                throw new CharacterTextureError("texture not found");
            }
            const sprite = new Phaser.GameObjects.Sprite(scene, 0, 0, texture, frame);

            sprites.set(texture, sprite);
        }
        return sprites;
    }
}
