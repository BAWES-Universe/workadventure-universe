import { gameManager } from "../../Phaser/Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import type { WokaData, WokaTexture } from "./WokaTypes";

/** The WOKA parts in the order they are drawn, bottom to top. */
export const wokaBodyPartOrder = ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"] as const;

let cached: { roomUrl: string; promise: Promise<WokaData> } | undefined;

/**
 * The room's WOKA catalog (woka/list). The join screens share one request: the name screen and the camera screen
 * show your WOKA, and the picker lists the catalog. A failed request is not kept, so Retry asks again.
 */
export function fetchWokaData(): Promise<WokaData> {
    const roomUrl = gameManager.currentStartedRoom.href;
    if (cached && cached.roomUrl === roomUrl) {
        return cached.promise;
    }
    const promise = fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
        headers: {
            Authorization: localUserStore.getAuthToken() || "",
        },
        credentials: "include",
    }).then(async (response) => {
        if (!response.ok) {
            throw new Error("Failed to load Woka data");
        }
        return (await response.json()) as WokaData;
    });
    cached = { roomUrl, promise };
    promise.catch(() => {
        if (cached?.promise === promise) {
            cached = undefined;
        }
    });
    return promise;
}

export function getWokaTextureUrl(relativeUrl: string): string {
    if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
        return relativeUrl;
    }
    return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
}

/**
 * Sorts saved texture ids (a flat list) into the parts they belong to, as WokaImage expects. Ids the catalog no
 * longer has are left out. With no saved WOKA, the catalog's first WOKA stands in.
 */
export function texturesByPart(textureIds: string[] | null, wokaData: WokaData): Record<string, string> {
    const result: Record<string, string> = {};
    for (const id of textureIds ?? []) {
        for (const part of wokaBodyPartOrder) {
            const found = wokaData[part]?.collections.some((collection) =>
                collection.textures.some((texture: WokaTexture) => texture.id === id)
            );
            if (found) {
                result[part] = id;
                break;
            }
        }
    }
    if (Object.keys(result).length === 0) {
        const first = wokaData.woka?.collections?.[0]?.textures?.[0]?.id;
        if (first) result.woka = first;
    }
    return result;
}
