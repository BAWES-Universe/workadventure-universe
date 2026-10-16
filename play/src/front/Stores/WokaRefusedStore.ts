import { get, writable } from "svelte/store";
import { selectCharacterSceneVisibleStore } from "./SelectCharacterStore";

/** What the world refused: the player's WOKA or their companion. */
export type RefusedKind = "woka" | "companion";

/** Set while the "can't be worn here" popup is on screen. */
export const wokaRefusedStore = writable<RefusedKind | undefined>(undefined);

/**
 * Set while the WOKA or companion picker was opened from that popup. Its close button leads back to the popup, because
 * there is no room to go back to yet (the join was refused).
 */
export const refusedPickerStore = writable<RefusedKind | undefined>(undefined);

/** The join was refused for the WOKA or companion: ask the player what to wear instead of picking for them. */
export function showWokaRefused(kind: RefusedKind): void {
    selectCharacterSceneVisibleStore.set(false);
    refusedPickerStore.set(undefined);
    wokaRefusedStore.set(kind);
}

/** Whether the popup is waiting on the player (the join screens then stay out of its way). */
export function isWokaRefusedShown(): boolean {
    return get(wokaRefusedStore) !== undefined;
}

/**
 * What to ask the player when the page loads straight into a world that refuses what they wear (the answer of `/me`
 * says so), as when a join is refused later: the "can't be worn here" popup, never the plain picker. A player whose
 * device and account hold no WOKA yet has nothing to refuse: they pick their first one in the picker.
 */
export function refusedOnLoad(
    response: { isCharacterTexturesValid?: boolean; isCompanionTextureValid?: boolean },
    deviceTextureIds: string[] | null
): RefusedKind | undefined {
    if (response.isCharacterTexturesValid === false) {
        return deviceTextureIds && deviceTextureIds.length > 0 ? "woka" : undefined;
    }
    if (response.isCompanionTextureValid === false) return "companion";
    return undefined;
}
