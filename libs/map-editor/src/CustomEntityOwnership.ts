import type { EntityRawPrefab } from "./types";

/**
 * Who may rename, change or delete an upload, or add a side or colour to it (#1628): map editors, and the person who
 * uploaded it. Uploads from before the uploader was recorded stay editors-only.
 */
export function canManageCustomEntity(
    entity: Pick<EntityRawPrefab, "ownerId"> | undefined,
    userUUID: string | undefined,
    userCanEdit: boolean
): boolean {
    if (userCanEdit) {
        return true;
    }
    return entity?.ownerId !== undefined && userUUID !== undefined && entity.ownerId === userUUID;
}

/**
 * The uploader of a new picture: its first picture's uploader when it is another side or colour of an upload (sides
 * and colours belong to the first picture's uploader), otherwise the person uploading it.
 */
export function uploaderOfNewPicture(
    firstPicture: Pick<EntityRawPrefab, "ownerId" | "ownerName"> | undefined,
    isAnotherSide: boolean,
    user: { uuid: string; name: string }
): { ownerId?: string; ownerName?: string } {
    if (isAnotherSide && firstPicture) {
        return { ownerId: firstPicture.ownerId, ownerName: firstPicture.ownerName };
    }
    return { ownerId: user.uuid, ownerName: user.name };
}
