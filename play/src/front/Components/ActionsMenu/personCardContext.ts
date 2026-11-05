import { readable, type Readable } from "svelte/store";
import { gameManager } from "../../Phaser/Game/GameManager";
import type { SpaceUserExtended } from "../../Space/SpaceInterface";

/** Everyone in the world with you, as the People tab has them; nothing while a reconnect swaps the scene. */
export function worldUsersStore(): Readable<Map<string, SpaceUserExtended> | undefined> {
    return gameManager.tryGetCurrentGameScene()?.allUsersInWorldStore ?? readable(undefined);
}
