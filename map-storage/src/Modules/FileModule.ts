import type { AreaDataProperty, EntityDataProperty } from "@workadventure/map-editor";
import { CustomFileService } from "../Services/CustomFileService";
import type { HookManager } from "./HookManager";
import type { MapStorageModuleInterface } from "./MapStorageModuleInterface";

type FileProperty = AreaDataProperty | EntityDataProperty;

/**
 * The property's own uploaded file is no longer used: an "Open file" was emptied, or a "Play a sound" sound was
 * replaced by another upload or by a link (#1626).
 */
function uploadedFileIsDropped(oldProperty: FileProperty, newProperty: FileProperty): boolean {
    if (oldProperty.type === "openFile" && newProperty.type === "openFile") {
        return Boolean(oldProperty.name && oldProperty.link && !newProperty.name && !newProperty.link);
    }
    if (oldProperty.type === "playAudio" && newProperty.type === "playAudio") {
        return Boolean(oldProperty.audioName && oldProperty.audioName !== newProperty.audioName);
    }
    return false;
}

function hasUploadedFile(property: FileProperty): boolean {
    return property.type === "openFile" || (property.type === "playAudio" && Boolean(property.audioName));
}

export class FileModule implements MapStorageModuleInterface {
    public init(hookManager: HookManager): void {
        const onPropertyChange = async <T extends FileProperty>(
            oldProperty: T,
            newProperty: T | undefined,
            hostname: string
        ): Promise<T> => {
            if (!newProperty) {
                return oldProperty;
            }

            if (uploadedFileIsDropped(oldProperty, newProperty)) {
                const fileService = new CustomFileService(hostname);
                await fileService.deleteFile(oldProperty);
            }

            return Promise.resolve(newProperty);
        };

        const onPropertyDelete = async <T extends FileProperty>(oldProperty: T, hostname: string): Promise<T> => {
            if (!hasUploadedFile(oldProperty)) {
                return oldProperty;
            }

            try {
                const fileService = new CustomFileService(hostname);
                await fileService.deleteFile(oldProperty);
            } catch (error) {
                console.error("Error deleting file", error);
                return oldProperty;
            }

            return Promise.resolve(oldProperty);
        };

        hookManager.subscribeAreaPropertyChange((area, oldProperty, newProperty, hostname) =>
            onPropertyChange(oldProperty, newProperty, hostname)
        );
        hookManager.subscribeAreaPropertyDelete((area, oldProperty, hostname) =>
            onPropertyDelete(oldProperty, hostname)
        );
        hookManager.subscribeEntityPropertyChange((entity, oldProperty, newProperty, hostname) =>
            onPropertyChange(oldProperty, newProperty, hostname)
        );
        hookManager.subscribeEntityPropertyDelete((entity, oldProperty, hostname) =>
            onPropertyDelete(oldProperty, hostname)
        );
    }
}
