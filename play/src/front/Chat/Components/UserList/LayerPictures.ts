import type { PictureStore } from "../../../Stores/PictureStore";
import { storedWokaStore } from "../../Stores/StoredWokaStore";

/** Someone whose Woka Orbit sent as layers (bottom first). */
export interface PersonWithLayers {
    uuid: string;
    characterTextures?: readonly { id: string; url: string }[];
}

/**
 * Draws the real Woka of people Orbit sent with their layers (friends, requests, search results). One picture store per
 * person for as long as the same layers are shown, so a list does not redraw them. Nothing for someone without layers:
 * the caller falls back to what it had before, and the game's default Woka after that.
 */
export function createLayerPictures(): (person: PersonWithLayers) => PictureStore | undefined {
    const known = new Map<string, { layers: string; picture: PictureStore | undefined }>();
    return (person) => {
        const textures = person.characterTextures ?? [];
        const layers = textures.map((texture) => texture.url).join("|");
        if (!layers) return undefined;
        const before = known.get(person.uuid);
        if (before?.layers === layers) return before.picture;
        const picture = storedWokaStore(textures);
        known.set(person.uuid, { layers, picture });
        return picture;
    };
}
