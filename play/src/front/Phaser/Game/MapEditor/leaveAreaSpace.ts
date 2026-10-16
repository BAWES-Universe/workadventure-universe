import type { SpaceRegistryInterface } from "../../../Space/SpaceRegistry/SpaceRegistryInterface";

/**
 * Leaves a zone's space, if this player is still in it. `get()` throws when the space is already gone (a quick second
 * leave, or a reconnect that destroyed it first): there is nothing left to leave, so that is not an error.
 */
export async function leaveAreaSpaceIfJoined(
    spaceRegistry: Pick<SpaceRegistryInterface, "exist" | "get" | "leaveSpace">,
    spaceName: string
): Promise<void> {
    if (!spaceRegistry.exist(spaceName)) return;
    await spaceRegistry.leaveSpace(spaceRegistry.get(spaceName));
}
