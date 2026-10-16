import type { WokaMine, WokaNotWearableReason } from "@workadventure/messages";
import { wokaBodyPartOrder } from "./WokaData";
import type { WokaData, WokaTexture } from "./WokaTypes";

/** One side of the popup: a WOKA drawn from its pictures (bottom to top), with the name to write under it. */
export interface RefusedWoka {
    layers: string[];
    name: string | null;
}

/** What the "Your WOKA can't be worn here" popup shows. */
export interface WokaRefusal {
    current: RefusedWoka & {
        reason: WokaNotWearableReason | null;
        placeName: string | null;
    };
    suggestion: RefusedWoka & {
        /** The ids "Wear this" saves */
        textureIds: string[];
        lastWorn: boolean;
    };
}

/** The pictures of the saved texture ids the room's catalog knows, in drawing order. A refused WOKA often is not there. */
function layersOf(textureIds: string[] | null, wokaData: WokaData | undefined): string[] {
    const layers: string[] = [];
    for (const part of wokaBodyPartOrder) {
        const texture = wokaData?.[part]?.collections
            .flatMap((collection) => collection.textures)
            .find((candidate: WokaTexture) => (textureIds ?? []).includes(candidate.id));
        if (texture) layers.push(texture.url);
    }
    return layers;
}

/** The room's first WOKA: what a guest, or a player whose history cannot be read, is offered. */
function firstWoka(wokaData: WokaData | undefined): WokaTexture | undefined {
    return wokaData?.woka?.collections.flatMap((collection) => collection.textures)[0];
}

/**
 * Builds the popup from what the server says the player wears (`woka/mine`), the room's catalog, and what the device
 * remembers. Signed-in players get the server's answer. Guests, or a failed request, get the device's WOKA and the room's
 * first one as the suggestion. Undefined when there is nothing to suggest at all: the caller then opens the picker.
 */
export function buildWokaRefusal(
    mine: WokaMine | undefined,
    wokaData: WokaData | undefined,
    deviceTextureIds: string[] | null
): WokaRefusal | undefined {
    let suggestion: WokaRefusal["suggestion"] | undefined;
    if (mine?.suggestion && mine.suggestion.textures.length > 0) {
        suggestion = {
            layers: mine.suggestion.textures.map((texture) => texture.url),
            name: mine.suggestion.name ?? null,
            textureIds: mine.suggestion.textures.map((texture) => texture.id),
            lastWorn: mine.suggestion.lastWorn,
        };
    } else {
        const first = firstWoka(wokaData);
        if (first) {
            suggestion = { layers: [first.url], name: first.name, textureIds: [first.id], lastWorn: false };
        }
    }
    if (!suggestion) return undefined;

    const current =
        mine?.current && mine.current.textures.length > 0
            ? {
                  layers: mine.current.textures.map((texture) => texture.url),
                  name: mine.current.name ?? null,
                  reason: mine.current.reason ?? null,
                  placeName: mine.current.placeName ?? null,
              }
            : { layers: layersOf(deviceTextureIds, wokaData), name: null, reason: null, placeName: null };

    return { current, suggestion };
}
