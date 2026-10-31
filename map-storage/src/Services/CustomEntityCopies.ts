import path from "path";
import { EntityPermissions } from "@workadventure/map-editor";
import type { GameMap, WAMEntityData } from "@workadventure/map-editor";
import { fileSystem } from "../fileSystem";

/**
 * Every map of the world a map belongs to, the map itself included.
 *
 * @param mapKey The storage key of a map of the world.
 * @param universeWorldPath "universe/world".
 * @returns The storage key of each map, and the same key with the world's directory cut off, as a path inside it.
 */
export async function listWorldMapKeys(
    mapKey: string,
    universeWorldPath: string
): Promise<{ mapKeys: Map<string, string>; worldDirectory: string }> {
    const worldIndex = mapKey.indexOf(`${universeWorldPath}/`);
    if (worldIndex === -1) {
        throw new Error(`The map ${mapKey} is not in the world ${universeWorldPath}`);
    }
    const worldDirectory = mapKey.slice(0, worldIndex + universeWorldPath.length + 1);
    const mapKeys = new Map<string, string>([[mapKey, mapKey.slice(worldDirectory.length)]]);
    for (const file of await fileSystem.listFiles(worldDirectory, ".wam")) {
        mapKeys.set(path.join(worldDirectory, file), file);
    }
    return { mapKeys, worldDirectory };
}

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
    const { mapKeys } = await listWorldMapKeys(mapKey, universeWorldPath);

    for (const key of mapKeys.keys()) {
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

export type CopiesInRoom = {
    /** The storage key of the map. */
    mapKey: string;
    /** The map's path inside the world, e.g. "lounge/map.wam". */
    pathInWorld: string;
    /** How many copies of the upload, all its pictures together, the map holds. */
    count: number;
};

/**
 * Where an upload is placed: every map of the world holding a copy of any of its pictures, with how many (#1690).
 * Maps without a copy are left out. Reading a map that can't be read fails the whole count, so nobody is shown a
 * list that misses a room.
 */
export async function countCopiesByRoom(
    mapKey: string,
    universeWorldPath: string,
    pictureIds: string[],
    loadGameMap: (key: string) => Promise<GameMap>
): Promise<CopiesInRoom[]> {
    const { mapKeys } = await listWorldMapKeys(mapKey, universeWorldPath);
    const rooms: CopiesInRoom[] = [];
    for (const [key, pathInWorld] of mapKeys) {
        // eslint-disable-next-line no-await-in-loop
        const entities = (await loadGameMap(key)).getGameMapEntities();
        const count = pictureIds.reduce((sum, id) => sum + (entities?.findEntitiesByPrefabId(id).length ?? 0), 0);
        if (count > 0) {
            rooms.push({ mapKey: key, pathInWorld, count });
        }
    }
    return rooms;
}

/** What a map lost, to put it back when the delete can't be finished. */
export type RemovedCopies = { mapKey: string; entities: Record<string, WAMEntityData> };

/**
 * Takes every copy of the pictures out of every map of the world, in memory, and gives back what was taken. Every map
 * is read, and each one that holds a copy is loaded for editing, before the first one changes: a map that can't be
 * read stops the delete with nothing changed.
 *
 * @param readGameMap Gives a map to read from, without keeping it in memory.
 * @param editGameMap Gives the map to change, the one the editor and the autosave work on.
 * @returns What each map lost, and the path inside the world of every map of it.
 */
export async function removeCopiesEverywhere(
    mapKey: string,
    universeWorldPath: string,
    pictureIds: string[],
    readGameMap: (key: string) => Promise<GameMap>,
    editGameMap: (key: string) => Promise<GameMap>
): Promise<{ removed: RemovedCopies[]; pathsInWorld: Map<string, string> }> {
    const { mapKeys } = await listWorldMapKeys(mapKey, universeWorldPath);
    const withCopies: string[] = [];
    for (const key of mapKeys.keys()) {
        // eslint-disable-next-line no-await-in-loop
        const entities = (await readGameMap(key)).getGameMapEntities();
        if (pictureIds.some((id) => (entities?.findEntitiesByPrefabId(id).length ?? 0) > 0)) {
            withCopies.push(key);
        }
    }
    const maps: { key: string; entities: NonNullable<ReturnType<GameMap["getGameMapEntities"]>> }[] = [];
    for (const key of withCopies) {
        // eslint-disable-next-line no-await-in-loop
        const entities = (await editGameMap(key)).getGameMapEntities();
        if (entities) {
            maps.push({ key, entities });
        }
    }
    const removed: RemovedCopies[] = [];
    for (const { key, entities } of maps) {
        const taken: Record<string, WAMEntityData> = {};
        for (const id of pictureIds) {
            for (const copyId of entities.findEntitiesByPrefabId(id)) {
                const copy = entities.getEntity(copyId);
                if (copy) {
                    taken[copyId] = structuredClone(copy);
                }
            }
            entities.deleteCustomEntities(id);
        }
        if (Object.keys(taken).length > 0) {
            removed.push({ mapKey: key, entities: taken });
        }
    }
    return { removed, pathsInWorld: mapKeys };
}

/** Puts back what removeCopiesEverywhere took. */
export function restoreCopies(removed: RemovedCopies[], getGameMap: (key: string) => GameMap | undefined): void {
    for (const { mapKey, entities } of removed) {
        const mapEntities = getGameMap(mapKey)?.getGameMapEntities();
        for (const [id, entity] of Object.entries(entities)) {
            mapEntities?.addEntity(id, entity);
        }
    }
}
