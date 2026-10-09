import path from "path";
import {
    CollisionGrid,
    ENTITIES_FOLDER_PATH,
    ENTITY_COLLECTION_FILE,
    EntityCollectionRaw,
    EntityRawPrefab,
    entityUploadSupportedFormatForMapStorage,
    mapCustomEntityDirectionToDirection,
} from "@workadventure/map-editor";
import type {
    DeleteCustomEntityMessage,
    ModifyCustomEntityMessage,
    UploadEntityMessage,
} from "@workadventure/messages";
import { fileSystem } from "../fileSystem";
import { mapPathUsingDomainWithPrefix } from "./PathMapper";

// The custom entities file is shared by every map of a universe/world, while map-storage serialises commands per map
// and creates one service per command. So the read-modify-write of that file is serialised here, per file, across
// instances: two maps of the same universe editing their uploads at once no longer overwrite each other's change.
const collectionFileLocks = new Map<string, Promise<void>>();

async function withCollectionFileLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = collectionFileLocks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const release = run.then(
        () => undefined,
        () => undefined
    );
    collectionFileLocks.set(key, release);
    try {
        return await run;
    } finally {
        if (collectionFileLocks.get(key) === release) {
            collectionFileLocks.delete(key);
        }
    }
}

export class CustomEntityCollectionService {
    private readonly hostname: string;
    private readonly universeWorldPath: string; // Required, not optional

    constructor(hostname: string, universeWorldPath: string) {
        this.hostname = hostname;
        this.universeWorldPath = universeWorldPath;
    }

    private getEntityCollectionFileVirtualPath() {
        const basePath = `${ENTITIES_FOLDER_PATH}/${ENTITY_COLLECTION_FILE}`;
        // Always scope entities per universe/world
        const scopedPath = `${this.universeWorldPath}/${basePath}`;
        return mapPathUsingDomainWithPrefix(scopedPath, this.hostname);
    }

    private getEntityToUploadVirtualPath(fileName: string) {
        const { base: filenameWithoutPotentialPath, ext: fileExtension } = path.parse(fileName);

        if (fileExtension.match(entityUploadSupportedFormatForMapStorage) === null) {
            throw new Error("File extension is not a supported image");
        }
        const basePath = `${ENTITIES_FOLDER_PATH}/${filenameWithoutPotentialPath}`;
        // Always scope entities per universe/world
        const scopedPath = `${this.universeWorldPath}/${basePath}`;
        return mapPathUsingDomainWithPrefix(scopedPath, this.hostname);
    }

    public async uploadEntity(uploadEntityMessage: UploadEntityMessage) {
        const { imagePath, file } = uploadEntityMessage;
        await fileSystem.writeByteArrayAsFile(this.getEntityToUploadVirtualPath(imagePath), file);
        await this.addEntityInEntityCollectionFile(
            this.mapEntityFromUploadEntityMessageToEntityRawPrefab(uploadEntityMessage)
        );
        return;
    }

    public async modifyEntity(modifyCustomEntityMessage: ModifyCustomEntityMessage) {
        const { id, name, tags, depthOffset } = modifyCustomEntityMessage;
        let collisionGrid = undefined;
        if (modifyCustomEntityMessage.collisionGrid) {
            collisionGrid = CollisionGrid.parse(modifyCustomEntityMessage.collisionGrid);
        }
        await this.updateCollection((customEntityCollection) => {
            const indexOfEntityToModify = customEntityCollection.collection.findIndex((entity) => entity.id === id);
            if (indexOfEntityToModify === -1) {
                console.error(
                    `[${new Date().toISOString()}] Unable to find the entity to modify in custom entities file`
                );
                return false;
            }
            const entityToModify = customEntityCollection.collection[indexOfEntityToModify];
            customEntityCollection.collection[indexOfEntityToModify] = {
                ...entityToModify,
                name,
                tags,
                depthOffset,
                collisionGrid,
            };
            return true;
        });
    }

    public async deleteEntity(deleteCustomEntityMessage: DeleteCustomEntityMessage) {
        const { id } = deleteCustomEntityMessage;
        let customEntityToDelete: EntityRawPrefab | undefined;
        // Awaited to the end on purpose: the map's edit lock must not open before the file is written, because
        // deleting an upload with several pictures sends one message per picture, and the next one reads this file.
        await this.updateCollection((customEntityCollection) => {
            customEntityToDelete = customEntityCollection.collection.find((entity) => entity.id === id);
            customEntityCollection.collection = customEntityCollection.collection.filter(
                (customEntity) => customEntity.id !== id
            );
            return true;
        });
        if (customEntityToDelete) {
            await fileSystem.deleteFiles(this.getEntityToUploadVirtualPath(customEntityToDelete.imagePath));
        }
    }

    /**
     * Reads the collection file, lets `change` edit it in place and writes it back, all under the per-file lock.
     * `change` returns false to leave the file untouched.
     */
    private async updateCollection(change: (collection: EntityCollectionRaw) => boolean): Promise<void> {
        const entityCollectionFileVirtualPath = this.getEntityCollectionFileVirtualPath();
        await withCollectionFileLock(entityCollectionFileVirtualPath, async () => {
            const customEntityCollectionFileContent = await this.readOrCreateEntitiesCollectionFile();
            const customEntityCollection = EntityCollectionRaw.parse(JSON.parse(customEntityCollectionFileContent));
            if (!change(customEntityCollection)) {
                return;
            }
            await fileSystem.writeStringAsFile(entityCollectionFileVirtualPath, JSON.stringify(customEntityCollection));
        });
    }

    private async readOrCreateEntitiesCollectionFile() {
        const entityCollectionFileVirtualPath = this.getEntityCollectionFileVirtualPath();
        const fileExist = await fileSystem.exist(entityCollectionFileVirtualPath);
        if (!fileExist) {
            const entityCollectionFile: EntityCollectionRaw = {
                version: "1.0",
                collection: [],
                collectionName: "custom entities",
                tags: [],
            };
            await fileSystem.writeStringAsFile(entityCollectionFileVirtualPath, JSON.stringify(entityCollectionFile));
        }
        //Check current version and migrate to new one
        return fileSystem.readFileAsString(entityCollectionFileVirtualPath);
    }

    private mapEntityFromUploadEntityMessageToEntityRawPrefab(
        uploadEntityMessage: UploadEntityMessage
    ): EntityRawPrefab {
        return EntityRawPrefab.parse({
            ...uploadEntityMessage,
            direction: mapCustomEntityDirectionToDirection(uploadEntityMessage.direction),
        });
    }

    private async addEntityInEntityCollectionFile(entityToAddInCollection: EntityRawPrefab) {
        await this.updateCollection((customEntityCollection) => {
            customEntityCollection.collection.push(entityToAddInCollection);
            return true;
        });
    }
}
