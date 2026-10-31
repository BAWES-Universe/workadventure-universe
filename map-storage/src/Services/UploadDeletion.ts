import type { DeleteCustomEntityMessage } from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { mapsManager } from "../MapsManager";
import type { CustomEntityCollectionService } from "./CustomEntityCollectionService";
import { removeCopiesEverywhere, restoreCopies } from "./CustomEntityCopies";

/**
 * Deletes an upload with every placed copy of it, in every room of the world, all together (#1690). If any room can't
 * be changed, or the upload can't be taken out of the collection, nothing is deleted anywhere.
 *
 * @returns The path inside the world of each other room, so the people in them are told.
 */
export async function deleteUploadEverywhere({
    mapKey,
    universeWorldPath,
    pictureIds,
    commandId,
    message,
    uploads,
}: {
    mapKey: string;
    universeWorldPath: string;
    pictureIds: string[];
    commandId: string;
    message: DeleteCustomEntityMessage;
    uploads: CustomEntityCollectionService;
}): Promise<string[]> {
    const { removed, pathsInWorld } = await removeCopiesEverywhere(
        mapKey,
        universeWorldPath,
        pictureIds,
        (key) => mapsManager.readGameMap(key),
        (key) => mapsManager.getOrLoadGameMap(key)
    );
    try {
        for (const { mapKey: key } of removed) {
            // eslint-disable-next-line no-await-in-loop
            await mapsManager.saveMapNow(key);
        }
        await uploads.deleteEntities(pictureIds);
    } catch (e) {
        // Nothing is deleted: the copies come back in memory and in the files.
        restoreCopies(removed, (key) => mapsManager.getGameMap(key));
        for (const { mapKey: key } of removed) {
            // eslint-disable-next-line no-await-in-loop
            await mapsManager.saveMapNow(key).catch((saveError: unknown) => {
                console.error(`[${new Date().toISOString()}] Could not put the copies back in ${key}`, saveError);
                Sentry.captureException(saveError);
            });
        }
        throw e;
    }

    // The other rooms keep the command for a while, like any edit, so someone who joins right now still gets it.
    const told = new Set([...removed.map((room) => room.mapKey), ...mapsManager.getLoadedMaps()]);
    for (const key of told) {
        if (key === mapKey || !pathsInWorld.has(key)) continue;
        mapsManager.addCommandToQueue(key, {
            id: commandId,
            editMapMessage: {
                message: {
                    $case: "deleteCustomEntityMessage",
                    deleteCustomEntityMessage: { ...message, wholeUpload: true, pictureIds, otherRoomWamUrls: [] },
                },
            },
        });
    }
    return [...pathsInWorld.entries()].filter(([key]) => key !== mapKey).map(([, path]) => path);
}
