import type { EntityPrefab, GameMap } from "@workadventure/map-editor";
import { canManageCustomEntity, EntityPermissions, uploaderOfNewPicture } from "@workadventure/map-editor";
import type { UploadEntityMessage } from "@workadventure/messages";

/** The person looking at the objects panel. */
export interface Viewer {
    uuid: string | undefined;
    name: string;
    canEditMap: boolean;
    tags: string[];
}

/**
 * Whose upload it is, as the objects panel says it (#1628): "mine", someone else's (with their name), or nothing for
 * an upload from before the uploader was recorded. `canManage`: the edit links show (the uploader and map editors).
 */
export function uploadOwnerView(
    prefab: Pick<EntityPrefab, "ownerId" | "ownerName">,
    viewer: Viewer
): { owner: "mine" | "someone" | "unknown"; ownerName: string; canManage: boolean } {
    const canManage = canManageCustomEntity(prefab, viewer.uuid, viewer.canEditMap);
    if (prefab.ownerId === undefined) {
        return { owner: "unknown", ownerName: "", canManage };
    }
    if (prefab.ownerId === viewer.uuid) {
        return { owner: "mine", ownerName: viewer.name, canManage };
    }
    return { owner: "someone", ownerName: prefab.ownerName ?? "", canManage };
}

/**
 * Our own copy of a new upload carries its uploader straight away, as map-storage will save it (map-storage writes it
 * again from the signed-in person, so this is only for what we show meanwhile).
 */
export function withUploader(
    message: UploadEntityMessage,
    prefabs: readonly Pick<EntityPrefab, "id" | "ownerId" | "ownerName">[],
    viewer: Viewer
): UploadEntityMessage {
    const isAnotherSide = message.variantOf !== undefined;
    const firstPicture = isAnotherSide ? prefabs.find((prefab) => prefab.id === message.variantOf) : undefined;
    const uploader = uploaderOfNewPicture(firstPicture, isAnotherSide, { uuid: viewer.uuid ?? "", name: viewer.name });
    return { ...message, ownerId: uploader.ownerId || undefined, ownerName: uploader.ownerName };
}

/**
 * The uploader (not a map editor) may delete their upload only while every copy sits where they can edit (#1628).
 * This looks at the room we are in; map-storage also checks the other rooms of the world.
 */
export function hasCopyHereOutsideViewerRights(
    pictureIds: readonly string[],
    gameMap: GameMap,
    viewer: Viewer
): boolean {
    if (viewer.canEditMap) {
        return false;
    }
    const gameMapEntities = gameMap.getGameMapEntities();
    const gameMapAreas = gameMap.getGameMapAreas();
    const copies = pictureIds.flatMap((id) => gameMapEntities?.findEntitiesByPrefabId(id) ?? []);
    if (copies.length === 0) {
        return false;
    }
    if (!gameMapAreas) {
        return true;
    }
    const permissions = new EntityPermissions(gameMapAreas, viewer.tags, false, viewer.uuid);
    return copies.some((copyId) => {
        const copy = gameMapEntities?.getEntity(copyId);
        return copy !== undefined && !permissions.canEdit({ x: copy.x, y: copy.y });
    });
}
