import { writable, type Readable } from "svelte/store";
import type { CompanionTexture, CompanionTextureCollection } from "@workadventure/messages";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";

/**
 * The companions (pets) a bot can walk with: the room's companion list, loaded once per room and shared by the
 * bot page and its companion picker, the way the woka catalogue is ([[BotWokaCatalogStore]]).
 */
const catalogStore = writable<CompanionTextureCollection[] | null>(null);
export const botCompanionCatalogStore: Readable<CompanionTextureCollection[] | null> = catalogStore;

let loadedRoomUrl: string | null = null;
let inFlight: { roomUrl: string; promise: Promise<void> } | null = null;

function currentRoomUrl(): string | null {
    return gameManager?.currentStartedRoom?.href || window.location.href || null;
}

/** The companion with this id in the catalogue, if the room's list has it. */
export function findCompanion(
    catalog: CompanionTextureCollection[] | null,
    id: string | null | undefined
): CompanionTexture | undefined {
    if (!catalog || !id) return undefined;
    for (const collection of catalog) {
        const texture = collection.textures.find((t) => t.id === id);
        if (texture) return texture;
    }
    return undefined;
}

/**
 * Load the companion list for the current room unless it is already loaded or loading.
 */
export function ensureBotCompanionCatalog(): Promise<void> {
    const roomUrl = currentRoomUrl();
    if (!roomUrl) return Promise.resolve();
    if (roomUrl === loadedRoomUrl) return Promise.resolve();
    if (inFlight?.roomUrl === roomUrl) return inFlight.promise;

    if (loadedRoomUrl !== null) {
        // Different room: drop the old list so the page doesn't show companions from it
        loadedRoomUrl = null;
        catalogStore.set(null);
    }

    const promise = (async () => {
        try {
            const response = await fetch(
                `${ABSOLUTE_PUSHER_URL}companion/list?roomUrl=${encodeURIComponent(roomUrl)}`,
                {
                    headers: {
                        Authorization: localUserStore.getAuthToken() || "",
                    },
                    credentials: "include",
                }
            );
            if (!response.ok || inFlight?.roomUrl !== roomUrl) return;
            const data = (await response.json()) as CompanionTextureCollection[];
            if (inFlight?.roomUrl !== roomUrl) return;
            loadedRoomUrl = roomUrl;
            catalogStore.set(Array.isArray(data) ? data : []);
        } catch (err) {
            // The companion list is optional; a failed load is retried by the next caller
            console.warn("Could not load bot companion list:", err);
        } finally {
            if (inFlight?.roomUrl === roomUrl) inFlight = null;
        }
    })();
    inFlight = { roomUrl, promise };
    return promise;
}
