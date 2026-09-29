import { writable, type Readable } from "svelte/store";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { localUserStore } from "../../../Connection/LocalUserStore";
import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
import type { WokaData } from "../../../Components/Woka/WokaTypes";

/**
 * The woka catalogue a bot can wear, shared by every bot card and the detail view.
 *
 * On prod the pusher asks the admin API for this list, which runs several database queries,
 * so it is loaded once per room instead of once per bot card.
 */
const catalogStore = writable<WokaData | null>(null);
export const botWokaCatalogStore: Readable<WokaData | null> = catalogStore;

let loadedRoomUrl: string | null = null;
let inFlight: { roomUrl: string; promise: Promise<void> } | null = null;

function currentRoomUrl(): string | null {
    return gameManager?.currentStartedRoom?.href || window.location.href || null;
}

/**
 * Load the catalogue for the current room unless it is already loaded or loading.
 */
export function ensureBotWokaCatalog(): Promise<void> {
    const roomUrl = currentRoomUrl();
    if (!roomUrl) return Promise.resolve();
    if (roomUrl === loadedRoomUrl) return Promise.resolve();
    if (inFlight?.roomUrl === roomUrl) return inFlight.promise;

    if (loadedRoomUrl !== null) {
        // Different room: drop the old catalogue so cards don't render textures from it
        loadedRoomUrl = null;
        catalogStore.set(null);
    }

    const promise = (async () => {
        try {
            const response = await fetch(
                `${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}&context=bot`,
                {
                    headers: {
                        Authorization: localUserStore.getAuthToken() || "",
                    },
                    credentials: "include",
                }
            );
            if (!response.ok || inFlight?.roomUrl !== roomUrl) return;
            const data = (await response.json()) as WokaData;
            if (inFlight?.roomUrl !== roomUrl) return;
            loadedRoomUrl = roomUrl;
            catalogStore.set(data);
        } catch (err) {
            // Woka previews are optional; a failed load is retried by the next caller
            console.warn("Could not load bot woka catalogue:", err);
        } finally {
            if (inFlight?.roomUrl === roomUrl) inFlight = null;
        }
    })();
    inFlight = { roomUrl, promise };
    return promise;
}
