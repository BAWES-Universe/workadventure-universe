import { readable } from "svelte/store";
import * as Sentry from "@sentry/svelte";
import type { CharacterTextureMessage } from "@workadventure/messages";
import type { PictureStore } from "../../Stores/PictureStore";

/**
 * A person's saved Woka as a picture, for someone who has no live avatar (they're away). Nothing is drawn until
 * something shows the picture, so a long list of away people costs only the ones on screen. Without a saved Woka
 * there is no picture, and the caller shows a letter as before.
 */
export function storedWokaStore(textures: readonly CharacterTextureMessage[] | undefined): PictureStore | undefined {
    if (!textures || textures.length === 0) return undefined;
    const layers = textures.map((texture) => ({ id: texture.id, url: texture.url }));
    return readable<string | undefined>(undefined, (set) => {
        let stopped = false;
        // Loaded when first needed: the game's map code isn't something the chat list should pull in up front.
        import("../../Phaser/Entity/CharacterLayerManager")
            .then(({ CharacterLayerManager }) => CharacterLayerManager.wokaBase64(layers))
            .then((wokaBase64) => {
                if (!stopped) set(wokaBase64);
            })
            .catch((error) => {
                Sentry.captureException(error);
                console.warn("Error while getting woka base64", error);
            });
        return () => {
            stopped = true;
        };
    });
}
