import { readable } from "svelte/store";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import { botWokaCatalogStore, ensureBotWokaCatalog } from "../../external-modules/bots/stores/BotWokaCatalogStore";
import type { WokaData } from "../../Components/Woka/WokaTypes";
import type { PictureStore } from "../../Stores/PictureStore";
import { storedWokaStore } from "../Stores/StoredWokaStore";
import { brickPictureUrl, isBrickLook } from "./Brick";

/**
 * The picture of a Brick's look (game #1996). A Brick look is one of the game's own pictures. A Brick can also wear a
 * WOKA: that one is drawn from the WOKAs the game offers a bot, read once per room and only when a Brick wears one.
 * Until it is drawn (or when the game no longer offers that WOKA) there is no picture, and the chat shows a letter.
 */

/** A WOKA's picture address: the game's own server serves the relative ones. */
export function wokaTextureUrl(relativeUrl: string): string {
    if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) return relativeUrl;
    return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
}

/** The WOKA of this id among the ones a bot can wear. */
export function findWokaTexture(
    catalog: WokaData | null | undefined,
    id: string
): { id: string; url: string } | undefined {
    for (const collection of catalog?.woka?.collections ?? []) {
        const texture = collection.textures.find((one) => one.id === id);
        if (texture) return { id: texture.id, url: wokaTextureUrl(texture.url) };
    }
    return undefined;
}

function wokaPicture(look: string): PictureStore {
    return readable<string | undefined>(undefined, (set) => {
        let stopPicture: (() => void) | undefined;
        let drawnUrl: string | undefined;
        ensureBotWokaCatalog().catch((error: unknown) =>
            console.warn("Could not read the WOKAs a Brick can wear", error)
        );
        const stopCatalog = botWokaCatalogStore.subscribe((catalog) => {
            const texture = findWokaTexture(catalog, look);
            if (!texture || texture.url === drawnUrl) return;
            drawnUrl = texture.url;
            stopPicture?.();
            stopPicture = storedWokaStore([texture])?.subscribe((picture) => {
                if (picture) set(picture);
            });
        });
        return () => {
            stopCatalog();
            stopPicture?.();
        };
    });
}

/** One picture store per look, so a list that reads it again does not redraw. */
const pictures = new Map<string, PictureStore>();
export function brickPicture(look: string | null | undefined): PictureStore {
    const key = look && !isBrickLook(look) ? look : brickPictureUrl(look);
    let picture = pictures.get(key);
    if (!picture) {
        picture = look && !isBrickLook(look) ? wokaPicture(look) : readable<string | undefined>(key);
        pictures.set(key, picture);
    }
    return picture;
}
