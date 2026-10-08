import { derived } from "svelte/store";
import { displayName } from "../Components/Exploration/exploreText";
import { exploreStore } from "./ExploreStore";

/**
 * The world's slug in a Universe room URL ("/@/universe/world/room"), or "" for any other URL.
 */
export function worldSlugFromRoomUrl(roomUrl: string | undefined): string {
    if (!roomUrl) return "";
    try {
        const parts = new URL(roomUrl, window.location.href).pathname.split("/");
        return parts[1] === "@" && parts[3] ? decodeURIComponent(parts[3]) : "";
    } catch {
        return "";
    }
}

/**
 * The name of the world the player is in, as the Explore list shows it, once the universe's rooms are loaded; "" until
 * then (callers fall back to the slug in the room URL).
 */
export const currentWorldNameStore = derived(exploreStore, ($explore) => {
    const current = $explore.universe?.worlds.find((world) => world.isCurrent);
    return current?.name ? displayName(current.name) : "";
});
