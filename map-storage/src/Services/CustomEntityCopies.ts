import path from "path";
import { EntityPermissions } from "@workadventure/map-editor";
import type { GameMap } from "@workadventure/map-editor";
import { fileSystem } from "../fileSystem";

/**
 * Deleting an upload removes every placed copy of it. Its uploader may do that only while every copy, in every room
 * of the world, sits in a place they can edit, such as their own desk (#1628). Otherwise only map editors can, so
 * that an uploader never wipes objects out of rooms they cannot change.
 *
 * @param mapKey The storage key of the map the delete comes from.
 * @param universeWorldPath "universe/world": the uploads belong to the whole world.
 * @param loadGameMap Gives the map stored under a key, as edits see it.
 */
export async function hasCopyOutsideUserRights(
    mapKey: string,
    universeWorldPath: string,
    prefabId: string,
    user: { tags: string[]; uuid: string },
    loadGameMap: (key: string) => Promise<GameMap>
): Promise<boolean> {
    const worldIndex = mapKey.indexOf(`${universeWorldPath}/`);
    if (worldIndex === -1) {
        throw new Error(`The map ${mapKey} is not in the world ${universeWorldPath}`);
    }
    const worldDirectory = mapKey.slice(0, worldIndex + universeWorldPath.length + 1);
    const mapKeys = new Set([mapKey]);
    for (const file of await fileSystem.listFiles(worldDirectory, ".wam")) {
        mapKeys.add(path.join(worldDirectory, file));
    }

    for (const key of mapKeys) {
        // eslint-disable-next-line no-await-in-loop
        const gameMap = await loadGameMap(key);
        const gameMapEntities = gameMap.getGameMapEntities();
        const gameMapAreas = gameMap.getGameMapAreas();
        const copies = gameMapEntities?.findEntitiesByPrefabId(prefabId) ?? [];
        if (copies.length === 0) {
            continue;
        }
        if (!gameMapAreas) {
            return true;
        }
        const permissions = new EntityPermissions(gameMapAreas, user.tags, false, user.uuid);
        for (const copyId of copies) {
            const copy = gameMapEntities?.getEntity(copyId);
            if (copy && !permissions.canEdit({ x: copy.x, y: copy.y })) {
                return true;
            }
        }
    }
    return false;
}
