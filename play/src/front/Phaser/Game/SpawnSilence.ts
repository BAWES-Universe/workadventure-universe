import { silentStore } from "../../Stores/MediaStore";

type SilenceReader = {
    hasPosition(): boolean;
    isSilentAt(x: number, y: number): boolean;
};

/**
 * The room join reads the availability status before the map has looked at the player's position. When the
 * player spawns inside a silent zone, mark them silent first, so the very first status the server sees already
 * keeps them out of proximity groups. Does nothing once the map has evaluated a position (reconnects).
 */
export function seedSpawnSilence(map: SilenceReader, spawn: { x: number; y: number }): void {
    if (map.hasPosition()) {
        return;
    }
    silentStore.setSpawnSilent(map.isSilentAt(spawn.x, spawn.y));
}

/**
 * Called once the map has evaluated the player's position: from then on the map listeners alone tell whether the
 * player is in a silent zone. A scene closed before that never releases it; the next scene seeds its own spawn.
 */
export function releaseSpawnSilence(): void {
    silentStore.setSpawnSilent(false);
}
