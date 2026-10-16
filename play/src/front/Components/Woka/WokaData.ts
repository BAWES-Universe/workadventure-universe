import { wokaMine } from "@workadventure/messages";
import type { WokaMine } from "@workadventure/messages";
import { gameManager } from "../../Phaser/Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import { hasCapability } from "../../Connection/Capabilities";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import type { WokaData, WokaTexture } from "./WokaTypes";

/** The WOKA parts in the order they are drawn, bottom to top. */
export const wokaBodyPartOrder = ["body", "eyes", "hair", "clothes", "hat", "accessory", "woka"] as const;

/** How long the picker and the popup wait for `woka/mine` before they go on without it */
export const wokaMineTimeoutMs = 5000;

let cached: { roomUrl: string; promise: Promise<WokaData> } | undefined;

/**
 * The WOKA catalog of the room the player is in (woka/list). The join screens share one request: the name screen and the camera screen
 * show your WOKA. The pickers ask for a `fresh` list each time they open, so a WOKA granted while you stood in the
 * room shows without a room change or a reload; the answer then replaces the shared one. A failed request is not
 * kept, so Retry asks again.
 */
export function fetchWokaData({ fresh = false }: { fresh?: boolean } = {}): Promise<WokaData> {
    const roomUrl = gameManager.currentMapRoom.href;
    if (!fresh && cached && cached.roomUrl === roomUrl) {
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

/** A WOKA or companion picture: the catalogs give paths relative to the pusher. */
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

/**
 * What the signed-in player wears and wore lately, as seen from the room they are in (`woka/mine`): the popup draws
 * its outfits from it and the picker its Recent row. Asked each time, since every pick changes it. Undefined for a
 * guest, when the server does not tell, or when the request fails: the callers then go on without it.
 */
export async function fetchWokaMine(): Promise<WokaMine | undefined> {
    if (!localUserStore.isLogged() || !hasCapability("api/woka/mine")) return undefined;
    // The picker and the popup wait for this: a slow answer is dropped after a few seconds, not waited for forever
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), wokaMineTimeoutMs);
    try {
        const roomUrl = gameManager.currentMapRoom.href;
        const response = await fetch(`${ABSOLUTE_PUSHER_URL}woka/mine?roomUrl=${encodeURIComponent(roomUrl)}`, {
            headers: {
                Authorization: localUserStore.getAuthToken() || "",
            },
            credentials: "include",
            signal: controller.signal,
        });
        if (!response.ok) return undefined;
        const parsed = wokaMine.safeParse(await response.json());
        return parsed.success ? parsed.data : undefined;
    } catch (err) {
        console.warn("Cannot load what you wore lately:", err);
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}
