import type { sendUnaryData, ServerUnaryCall } from "@grpc/grpc-js";
import * as Sentry from "@sentry/node";
import _ from "lodash";
import type {
    AreaData,
    AtLeast,
    EntityCoordinates,
    EntityDataProperties,
    EntityDimensions,
    WAMEntityData,
} from "@workadventure/map-editor";
import {
    AreaDataProperties,
    canManageCustomEntity,
    CreateAreaCommand,
    CreateEntityCommand,
    EntityPermissions,
    UpdateWAMMetadataCommand,
    UpdateWAMSettingCommand,
    uploaderOfNewPicture,
} from "@workadventure/map-editor";
import type {
    EditMapCommandMessage,
    EditMapCommandsArrayMessage,
    EditMapCommandWithKeyMessage,
    MapStorageClearAfterUploadMessage,
    PingMessage,
    UpdateMapToNewestWithKeyMessage,
    UploadCopiesAnswer,
    UploadCopiesWithKeyMessage,
} from "@workadventure/messages";
import type { Empty } from "@workadventure/messages/src/ts-proto-generated/google/protobuf/empty";
import type { MapStorageServer } from "@workadventure/messages/src/ts-proto-generated/services";
import { asError } from "catch-unknown";
import { DeleteCustomEntityMapStorageCommand } from "./Commands/Entity/DeleteCustomEntityMapStorageCommand";
import { ModifyCustomEntityMapStorageCommand } from "./Commands/Entity/ModifyCustomEntityMapStorageCommand";
import { UploadEntityMapStorageCommand } from "./Commands/Entity/UploadEntityMapStorageCommand";
import { CustomEntityCollectionService } from "./Services/CustomEntityCollectionService";
import { countCopiesByRoom, hasCopyOutsideUserRights } from "./Services/CustomEntityCopies";
import { deleteUploadEverywhere } from "./Services/UploadDeletion";
import { entitiesManager } from "./EntitiesManager";
import { mapsManager } from "./MapsManager";
import { mapPathUsingDomainWithPrefix } from "./Services/PathMapper";
import { editionLocksFor } from "./Services/EditionLocks";
import { DeleteAreaMapStorageCommand } from "./Commands/Area/DeleteAreaMapStorageCommand";
import { UpdateAreaMapStorageCommand } from "./Commands/Area/UpdateAreaMapStorageCommand";
import { DeleteEntityMapStorageCommand } from "./Commands/Entity/DeleteEntityMapStorageCommand";
import { UploadFileMapStorageCommand } from "./Commands/File/UploadFileMapStorageCommand";
import { hookManager } from "./Modules/HookManager";
import { UpdateEntityMapStorageCommand } from "./Commands/Entity/UpdateEntityMapStorageCommand";

/**
 * List of commands that can be executed even if the user does not have edit rights on the map
 * (but have local edit rights on a given area).
 */
// Players who can't edit the map may still place, move and delete objects inside an area that gives them write access
// (e.g. their personal area); each of these commands checks that below. Everything else needs edit rights, including
// custom assets, which are shared by the whole world.
const COMMANDS_ACCESSIBLE_WITHOUT_CAN_EDIT = new Set<string>([
    "modifyEntityMessage",
    "createEntityMessage",
    "deleteEntityMessage",
    // Uploads (#1628): someone who can edit a place of their own, such as their desk, may upload objects and manage
    // their own uploads. Each case below checks it.
    "uploadEntityMessage",
    "modifyCustomEntityMessage",
    "deleteCustomEntityMessage",
]);

/**
 * Extracts universe/world path from WAM pathname.
 * Path format: /domain/universe/world/room/map.wam or /universe/world/room/map.wam
 * @throws Error if path format is invalid
 */
function extractUniverseWorldPath(pathname: string): string {
    // Path format: /domain/universe/world/room/map.wam or /universe/world/room/map.wam
    const pathParts = pathname.split("/").filter((p) => p);

    if (pathParts.length < 3) {
        throw new Error(
            `Invalid WAM path format: expected at least 3 path segments (universe/world/room/map.wam), got: ${pathname}`
        );
    }

    // If first part looks like a domain (contains dots), skip it
    const startIndex = pathParts[0].includes(".") ? 1 : 0;

    if (pathParts.length < startIndex + 3) {
        throw new Error(`Invalid WAM path format: expected universe/world/room structure, got: ${pathname}`);
    }

    return `${pathParts[startIndex]}/${pathParts[startIndex + 1]}`;
}

/** The address of a map of the world, from its path inside the world and the address of another map of it. */
function wamUrlInWorld(sameWorldMapUrl: URL, universeWorldPath: string, pathInWorld: string): string {
    const worldStart = sameWorldMapUrl.href.indexOf(`/${universeWorldPath}/`);
    // A room's file name can hold spaces and other characters a web address writes differently: the address is built
    // the way the web address parser writes it, so it matches the address the room is known by.
    const escapedPath = pathInWorld
        .split("/")
        .map((part) => part.replace(/[%?#]/g, encodeURIComponent))
        .join("/");
    return new URL(`${sameWorldMapUrl.href.slice(0, worldStart)}/${universeWorldPath}/${escapedPath}`).href;
}

/**
 * Whether this person may delete an upload: map editors always; its uploader only while every copy of every picture is
 * where they can edit (#1628). The counts shown before a delete follow the same rule (#1690).
 */
async function mayDeleteUpload(
    {
        mapKey,
        universeWorldPath,
        uploads,
        id,
        pictureIds,
    }: {
        mapKey: string;
        universeWorldPath: string;
        uploads: CustomEntityCollectionService;
        id: string;
        pictureIds: Iterable<string>;
    },
    user: { uuid: string; tags: string[]; canEdit: boolean }
): Promise<boolean> {
    if (user.canEdit) return true;
    if (!canManageCustomEntity(await uploads.getEntity(id), user.uuid, user.canEdit)) return false;
    for (const pictureId of pictureIds) {
        // eslint-disable-next-line no-await-in-loop
        const copyOutsideRights = await hasCopyOutsideUserRights(
            mapKey,
            universeWorldPath,
            pictureId,
            { tags: user.tags, uuid: user.uuid },
            (key) => mapsManager.getOrLoadGameMap(key)
        );
        if (copyOutsideRights) return false;
    }
    return true;
}

const mapStorageServer: MapStorageServer = {
    ping(call: ServerUnaryCall<PingMessage, Empty>, callback: sendUnaryData<PingMessage>): void {
        callback(null, call.request);
    },
    handleClearAfterUpload(
        call: ServerUnaryCall<MapStorageClearAfterUploadMessage, Empty>,
        callback: sendUnaryData<Empty>
    ): void {
        const wamUrl = call.request.wamUrl;
        const url = new URL(wamUrl);
        const wamKey = mapPathUsingDomainWithPrefix(url.pathname, url.hostname);
        mapsManager.clearAfterUpload(wamKey);
        callback(null);
    },
    handleUpdateMapToNewestMessage(
        call: ServerUnaryCall<UpdateMapToNewestWithKeyMessage, Empty>,
        callback: sendUnaryData<EditMapCommandsArrayMessage>
    ): void {
        try {
            const mapUrl = new URL(call.request.mapKey);
            const mapKey = mapPathUsingDomainWithPrefix(mapUrl.pathname, mapUrl.hostname);
            const updateMapToNewestMessage = call.request.updateMapToNewestMessage;
            if (!updateMapToNewestMessage) {
                callback({ name: "MapStorageError", message: "UpdateMapToNewest message does not exist" }, null);
                return;
            }
            const clientCommandId = updateMapToNewestMessage.commandId;
            const lastCommandId = mapsManager.getGameMap(mapKey)?.getLastCommandId();
            let commandsToApply: EditMapCommandMessage[] = [];
            if (clientCommandId !== lastCommandId) {
                commandsToApply = mapsManager.getCommandsNewerThan(mapKey, updateMapToNewestMessage.commandId);
            }
            const editMapCommandsArrayMessage: EditMapCommandsArrayMessage = {
                editMapCommands: commandsToApply,
            };
            callback(null, editMapCommandsArrayMessage);
        } catch (e: unknown) {
            const error = asError(e);
            console.error(`[${new Date().toISOString()}] An error occurred in handleClearAfterUpload`, e);
            Sentry.captureException(e);
            callback({ name: "MapStorageError", message: error.message }, null);
        }
    },

    handleUploadCopiesQuery(
        call: ServerUnaryCall<UploadCopiesWithKeyMessage, UploadCopiesAnswer>,
        callback: sendUnaryData<UploadCopiesAnswer>
    ): void {
        (async () => {
            const { id, userCanEdit, userUUID, connectedUserTags } = call.request;
            const mapUrl = new URL(call.request.mapKey);
            const mapKey = mapPathUsingDomainWithPrefix(mapUrl.pathname, mapUrl.hostname);
            const universeWorldPath = extractUniverseWorldPath(mapUrl.pathname);
            const uploads = new CustomEntityCollectionService(mapUrl.hostname, universeWorldPath);
            const pictureIds = (await uploads.getUploadPictures(id)).map((picture) => picture.id);
            // Only those who could delete the upload, by the very rule the delete follows, are told where it is placed.
            if (
                !(await mayDeleteUpload(
                    { mapKey, universeWorldPath, uploads, id, pictureIds },
                    { uuid: userUUID, tags: connectedUserTags, canEdit: userCanEdit }
                ))
            ) {
                throw new Error(`User ${userUUID} is not allowed to see where the object ${id} is placed`);
            }
            const rooms = await countCopiesByRoom(
                mapKey,
                universeWorldPath,
                pictureIds.length > 0 ? pictureIds : [id],
                (key) => mapsManager.readGameMap(key)
            );
            callback(null, {
                rooms: rooms.map((room) => ({
                    wamUrl: wamUrlInWorld(mapUrl, universeWorldPath, room.pathInWorld),
                    count: room.count,
                })),
            });
        })().catch((e: unknown) => {
            console.error(e);
            callback({ name: "MapStorageError", message: getMessageFromError(e) }, null);
        });
    },

    handleEditMapCommandWithKeyMessage(
        call: ServerUnaryCall<EditMapCommandWithKeyMessage, Empty>,
        callback: sendUnaryData<EditMapCommandMessage>
    ): void {
        (async () => {
            const editMapCommandMessage = call.request.editMapCommandMessage;
            if (!editMapCommandMessage || !editMapCommandMessage.editMapMessage?.message) {
                callback({ name: "MapStorageError", message: "EditMapCommand message does not exist" }, null);
                return;
            }

            // The mapKey is the complete URL to the map. Let's map it to our virtual path.
            const mapUrl = new URL(call.request.mapKey);
            const mapKey = mapPathUsingDomainWithPrefix(mapUrl.pathname, mapUrl.hostname);

            // Extract universe/world from pathname - REQUIRED (throws if invalid)
            let universeWorldPath: string;
            try {
                universeWorldPath = extractUniverseWorldPath(mapUrl.pathname);
            } catch (error) {
                callback(
                    {
                        name: "MapStorageError",
                        message: error instanceof Error ? error.message : "Invalid WAM path format",
                    },
                    null
                );
                return;
            }

            const wholeUploadDelete =
                editMapCommandMessage.editMapMessage.message.$case === "deleteCustomEntityMessage" &&
                editMapCommandMessage.editMapMessage.message.deleteCustomEntityMessage.wholeUpload;
            const editionLocks = editionLocksFor(wholeUploadDelete, `${mapUrl.hostname}/${universeWorldPath}`);
            await editionLocks.waitForLock(mapKey, async () => {
                const editMapCommandMessage = call.request.editMapCommandMessage;
                if (!editMapCommandMessage || !editMapCommandMessage.editMapMessage?.message) {
                    callback({ name: "MapStorageError", message: "EditMapCommand message does not exist" }, null);
                    return;
                }
                const editMapMessage = editMapCommandMessage.editMapMessage.message;
                const gameMap = await mapsManager.getOrLoadGameMap(mapKey);

                const { connectedUserTags, userCanEdit, userUUID, userName } = call.request;

                const gameMapAreas = gameMap.getGameMapAreas();
                const entityCommandPermissions = gameMapAreas
                    ? new EntityPermissions(gameMapAreas, connectedUserTags, userCanEdit, userUUID)
                    : undefined;
                // Editors may edit objects anywhere; other players only inside an area that gives them write access.
                // With a size, the whole object must fit inside that area, as the map editor checks when placing it.
                const canEditEntityAt = (coordinates: EntityCoordinates, width = 0, height = 0): boolean =>
                    userCanEdit || (entityCommandPermissions?.canEdit(coordinates, width, height) ?? false);
                // Placing or moving: the size comes from the player's browser, so it has to be a real one.
                const canPlaceEntityAt = (coordinates: EntityCoordinates, width: number, height: number): boolean =>
                    userCanEdit ||
                    (isUsableFootprint(coordinates, width, height) && canEditEntityAt(coordinates, width, height));

                const commandId = editMapCommandMessage.id;

                if (!userCanEdit && !COMMANDS_ACCESSIBLE_WITHOUT_CAN_EDIT.has(editMapMessage.$case)) {
                    // A user tried to bypass security!
                    throw new Error(
                        `User ${userUUID} is not allowed to edit the map but tried to execute command: ${editMapMessage.$case} on map ${mapUrl}`
                    );
                }

                switch (editMapMessage.$case) {
                    case "modifyAreaMessage": {
                        const message = editMapMessage.modifyAreaMessage;
                        // NOTE: protobuf does not distinguish between null and empty array, we cannot create optional repeated value.
                        //       Because of that, we send additional "modifyProperties" flag set properties value as "undefined" so they won't get erased
                        //       by [] value which was supposed to be null.
                        const dataToModify: AtLeast<AreaData, "id"> = structuredClone(message);
                        if (!message.modifyProperties) {
                            dataToModify.properties = undefined;
                        }
                        const area = gameMap.getGameMapAreas()?.getArea(message.id);
                        if (area) {
                            await mapsManager.executeCommand(
                                mapKey,
                                mapUrl.host,
                                new UpdateAreaMapStorageCommand(
                                    gameMap,
                                    dataToModify,
                                    commandId,
                                    area,
                                    hookManager,
                                    mapUrl.hostname
                                )
                            );

                            const newAreaData = gameMap.getGameMapAreas()?.getArea(message.id);

                            if (newAreaData) {
                                const oldPropertiesParsed =
                                    AreaDataProperties.safeParse(editMapMessage.modifyAreaMessage.properties).data ||
                                    [];

                                const oldServerData = oldPropertiesParsed.reduce((acc, currProperty) => {
                                    if (currProperty.serverData) {
                                        acc.push({
                                            id: currProperty.id,
                                            serverData: currProperty.serverData,
                                        });
                                    }

                                    return acc;
                                }, [] as { id: string; serverData: unknown }[]);

                                const newServerData = newAreaData.properties.reduce((acc, currProperty) => {
                                    if (currProperty.serverData) {
                                        acc.push({
                                            id: currProperty.id,
                                            serverData: currProperty.serverData,
                                        });
                                    }
                                    return acc;
                                }, [] as { id: string; serverData: unknown }[]);

                                editMapMessage.modifyAreaMessage = {
                                    ...newAreaData,
                                    modifyServerData: !_.isEqual(oldServerData, newServerData),
                                };
                            }
                        } else {
                            console.info(`[${new Date().toISOString()}] Could not find area with id: ${message.id}`);
                        }
                        break;
                    }
                    case "createAreaMessage": {
                        const message = editMapMessage.createAreaMessage;
                        const areaObjectConfig: AreaData = {
                            ...message,
                            visible: true,
                        };
                        await mapsManager.executeCommand(
                            mapKey,
                            mapUrl.host,
                            new CreateAreaCommand(gameMap, areaObjectConfig, commandId)
                        );
                        break;
                    }
                    case "deleteAreaMessage": {
                        const message = editMapMessage.deleteAreaMessage;
                        await mapsManager.executeCommand(
                            mapKey,
                            mapUrl.host,
                            new DeleteAreaMapStorageCommand(
                                gameMap,
                                message.id,
                                commandId,
                                mapUrl.hostname,
                                hookManager
                            )
                        );
                        break;
                    }
                    case "modifyEntityMessage": {
                        const message = editMapMessage.modifyEntityMessage;

                        // NOTE: protobuf does not distinguish between null and empty array, we cannot create optional repeated value.
                        //       Because of that, we send additional "modifyProperties" flag set properties value as "undefined" so they won't get erased
                        //       by [] value which was supposed to be null.
                        const dataToModify: Partial<WAMEntityData> = structuredClone(message);
                        if (!message.modifyProperties) {
                            dataToModify.properties = undefined;
                        }
                        const entity = gameMap.getGameMapEntities()?.getEntity(message.id);
                        if (entity) {
                            const { x, y, width, height } = message;
                            // Both where the object is now and where it is going
                            if (
                                !canEditEntityAt({ x: entity.x, y: entity.y }) ||
                                !canPlaceEntityAt(
                                    getEntityCenterCoordinates({ x, y }, { width, height }),
                                    width,
                                    height
                                )
                            ) {
                                throw new Error(
                                    `User ${userUUID} is not allowed to modify entity ${message.id} on map ${mapUrl}`
                                );
                            }
                            await mapsManager.executeCommand(
                                mapKey,
                                mapUrl.host,
                                new UpdateEntityMapStorageCommand(
                                    gameMap,
                                    message.id,
                                    dataToModify,
                                    commandId,
                                    entity,
                                    hookManager,
                                    mapUrl.hostname
                                )
                            );
                        } else {
                            console.info(`[${new Date().toISOString()}] Could not find entity with id: ${message.id}`);
                        }
                        break;
                    }
                    case "createEntityMessage": {
                        const message = editMapMessage.createEntityMessage;
                        const { x, y, width, height } = message;
                        if (!canPlaceEntityAt(getEntityCenterCoordinates({ x, y }, { width, height }), width, height)) {
                            throw new Error(`User ${userUUID} is not allowed to create an entity on map ${mapUrl}`);
                        }
                        await mapsManager.executeCommand(
                            mapKey,
                            mapUrl.host,
                            new CreateEntityCommand(
                                gameMap,
                                message.id,
                                {
                                    prefabRef: {
                                        id: message.prefabId,
                                        collectionName: message.collectionName,
                                    },
                                    x: message.x,
                                    y: message.y,
                                    properties: message.properties as EntityDataProperties,
                                    name: message.name,
                                },
                                commandId
                            )
                        );
                        break;
                    }
                    case "deleteEntityMessage": {
                        const message = editMapMessage.deleteEntityMessage;
                        const entity = gameMap.getGameMapEntities()?.getEntity(message.id);
                        // An object's x/y is its top-left corner. Map-storage doesn't know object sizes, but placing and
                        // moving require the whole object inside the area, so its top-left corner is in there too.
                        if (!userCanEdit && (!entity || !canEditEntityAt({ x: entity.x, y: entity.y }))) {
                            throw new Error(
                                `User ${userUUID} is not allowed to delete entity ${message.id} on map ${mapUrl}`
                            );
                        }
                        await mapsManager.executeCommand(
                            mapKey,
                            mapUrl.host,
                            new DeleteEntityMapStorageCommand(
                                gameMap,
                                message.id,
                                commandId,
                                mapUrl.hostname,
                                hookManager
                            )
                        );
                        break;
                    }
                    case "uploadEntityMessage": {
                        const uploadEntityMessage = editMapMessage.uploadEntityMessage;
                        if (
                            !userCanEdit &&
                            !gameMapAreas?.isGameMapContainsSpecificAreas(userUUID, connectedUserTags)
                        ) {
                            throw new Error(`User ${userUUID} is not allowed to upload an object on map ${mapUrl}`);
                        }
                        const uploads = new CustomEntityCollectionService(mapUrl.hostname, universeWorldPath);
                        // The browser picks the id and the file name: someone who isn't a map editor must not replace
                        // a picture that is already saved, theirs or anyone's.
                        if (
                            !userCanEdit &&
                            (await uploads.isTaken(uploadEntityMessage.id, uploadEntityMessage.imagePath))
                        ) {
                            throw new Error(
                                `User ${userUUID} is not allowed to replace the object ${uploadEntityMessage.id} on map ${mapUrl}`
                            );
                        }
                        const isAnotherSide = uploadEntityMessage.variantOf !== undefined;
                        const firstPicture = isAnotherSide
                            ? await uploads.getEntity(uploadEntityMessage.variantOf ?? "")
                            : undefined;
                        // Adding a side or colour to an upload follows the rule for changing it.
                        if (isAnotherSide && !canManageCustomEntity(firstPicture, userUUID, userCanEdit)) {
                            throw new Error(
                                `User ${userUUID} is not allowed to add a side to the object ${uploadEntityMessage.variantOf} on map ${mapUrl}`
                            );
                        }
                        // Written on the message itself, whatever the browser sent, so that the uploader is saved and
                        // sent to everyone in the room.
                        const uploader = uploaderOfNewPicture(firstPicture, isAnotherSide, {
                            uuid: userUUID,
                            name: userName,
                        });
                        uploadEntityMessage.ownerId = uploader.ownerId;
                        uploadEntityMessage.ownerName = uploader.ownerName;
                        await entitiesManager.executeCommand(
                            new UploadEntityMapStorageCommand(uploadEntityMessage, mapUrl.hostname, universeWorldPath)
                        );
                        break;
                    }
                    case "modifyCustomEntityMessage": {
                        const modifyCustomEntityMessage = editMapMessage.modifyCustomEntityMessage;
                        if (!userCanEdit) {
                            const upload = await new CustomEntityCollectionService(
                                mapUrl.hostname,
                                universeWorldPath
                            ).getEntity(modifyCustomEntityMessage.id);
                            if (!canManageCustomEntity(upload, userUUID, userCanEdit)) {
                                throw new Error(
                                    `User ${userUUID} is not allowed to change the object ${modifyCustomEntityMessage.id} on map ${mapUrl}`
                                );
                            }
                        }
                        await entitiesManager.executeCommand(
                            new ModifyCustomEntityMapStorageCommand(
                                modifyCustomEntityMessage,
                                mapUrl.hostname,
                                universeWorldPath
                            )
                        );
                        break;
                    }
                    case "deleteCustomEntityMessage": {
                        const deleteCustomEntityMessage = editMapMessage.deleteCustomEntityMessage;
                        // These two are only ever written here, after the delete went through: whatever the browser
                        // sent in them is dropped, so it can't have other rooms told about a delete that didn't happen.
                        deleteCustomEntityMessage.pictureIds = [];
                        deleteCustomEntityMessage.otherRoomWamUrls = [];
                        const uploads = new CustomEntityCollectionService(mapUrl.hostname, universeWorldPath);
                        // The pictures that go: the browser deletes one picture, or a whole upload (#1690).
                        const pictureIds = new Set([deleteCustomEntityMessage.id]);
                        if (deleteCustomEntityMessage.wholeUpload || !userCanEdit) {
                            for (const picture of await uploads.getUploadPictures(deleteCustomEntityMessage.id)) {
                                pictureIds.add(picture.id);
                            }
                        }
                        // Checked before the command runs: it removes the placed copies from the map first. An
                        // upload's pictures are checked against the copies of every picture of it: either all of them
                        // go, or none.
                        if (
                            !(await mayDeleteUpload(
                                { mapKey, universeWorldPath, uploads, id: deleteCustomEntityMessage.id, pictureIds },
                                { uuid: userUUID, tags: connectedUserTags, canEdit: userCanEdit }
                            ))
                        ) {
                            throw new Error(
                                `User ${userUUID} is not allowed to delete the object ${deleteCustomEntityMessage.id} on map ${mapUrl}`
                            );
                        }
                        if (deleteCustomEntityMessage.wholeUpload) {
                            const otherRooms = await deleteUploadEverywhere({
                                mapKey,
                                universeWorldPath,
                                pictureIds: [...pictureIds],
                                commandId,
                                message: deleteCustomEntityMessage,
                                uploads,
                            });
                            // Told to the back, so the people in those rooms see the copies go.
                            deleteCustomEntityMessage.pictureIds = [...pictureIds];
                            deleteCustomEntityMessage.otherRoomWamUrls = otherRooms.map((room) =>
                                wamUrlInWorld(mapUrl, universeWorldPath, room)
                            );
                            break;
                        }
                        await entitiesManager.executeCommand(
                            new DeleteCustomEntityMapStorageCommand(
                                deleteCustomEntityMessage,
                                gameMap,
                                mapUrl.hostname,
                                universeWorldPath
                            )
                        );
                        break;
                    }
                    case "updateWAMSettingsMessage": {
                        const message = editMapMessage.updateWAMSettingsMessage;
                        const wam = gameMap.getWam();
                        if (!wam) {
                            throw new Error("WAM is not defined");
                        }
                        await mapsManager.executeCommand(
                            mapKey,
                            mapUrl.host,
                            new UpdateWAMSettingCommand(wam, message, commandId)
                        );
                        break;
                    }
                    case "errorCommandMessage": {
                        // Nothing to do, this message will never come from client
                        break;
                    }
                    case "modifiyWAMMetadataMessage": {
                        const message = editMapMessage.modifiyWAMMetadataMessage;
                        const wam = gameMap.getWam();
                        if (!wam) {
                            throw new Error("WAM is not defined");
                        }
                        await mapsManager.executeCommand(
                            mapKey,
                            mapUrl.host,
                            new UpdateWAMMetadataCommand(wam, message, commandId)
                        );
                        break;
                    }
                    case "uploadFileMessage": {
                        const uploadFileMessage = editMapMessage.uploadFileMessage;
                        await entitiesManager.executeCommand(
                            new UploadFileMapStorageCommand(uploadFileMessage, mapUrl.hostname)
                        );
                        editMapMessage.uploadFileMessage.file = new Uint8Array(0);
                        break;
                    }
                    default: {
                        const _exhaustiveCheck: never = editMapMessage;
                    }
                }
                // send edit map message back as a valid one
                mapsManager.addCommandToQueue(mapKey, editMapCommandMessage);
                callback(null, editMapCommandMessage);
            });
        })().catch((e: unknown) => {
            console.error(e);
            Sentry.captureException(e);
            callback(null, {
                id: call.request.editMapCommandMessage?.id ?? "Unknown id command error",
                editMapMessage: {
                    message: {
                        $case: "errorCommandMessage",
                        errorCommandMessage: {
                            reason: getMessageFromError(e),
                        },
                    },
                },
            });
        });
    },
};

function getMessageFromError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    } else if (typeof error === "string") {
        return error;
    } else {
        return "Unknown error";
    }
}

// The size of an object comes from the player's browser. A size that is missing, zero, negative or not a number
// would make the "whole object inside the area" check pass for any spot, so players who are not editors must send
// a real one. A positive size is still the browser's word: reading it from the object's picture on the server is
// the stronger fix.
const MAX_ENTITY_SIDE = 8192;
function isUsableFootprint(centre: EntityCoordinates, width: number, height: number): boolean {
    return (
        Number.isFinite(centre.x) &&
        Number.isFinite(centre.y) &&
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width >= 1 &&
        height >= 1 &&
        width <= MAX_ENTITY_SIDE &&
        height <= MAX_ENTITY_SIDE
    );
}

function getEntityCenterCoordinates(entityCoordinates: EntityCoordinates, entityDimensions: EntityDimensions) {
    return {
        x: entityCoordinates.x + entityDimensions.width * 0.5,
        y: entityCoordinates.y + entityDimensions.height * 0.5,
    };
}

export { mapStorageServer };
