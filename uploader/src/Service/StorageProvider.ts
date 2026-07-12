import {TargetDevice} from "./TargetDevice";

export interface StorageProvider {

    upload(fileUuid: string, chunks: Buffer, mimeType: string | undefined, bucket?: string): Promise<string>;

    deleteFileById(fileId: string): Promise<void>;

    copyFile(fileId: string, target: TargetDevice): void

    /**
     * Get a signed/download URL for a stored object.
     * Returns the URL that can be used to access the stored file.
     * Implementations that don't support this should throw.
     */
    getSignedUrl(key: string): Promise<string>;
}

export interface Location {
    Location: string;
    Key: string;
}
