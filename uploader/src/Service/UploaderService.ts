import {v4} from "uuid";
import {Location, StorageProvider} from "./StorageProvider";
import {storageProviderService, tempProviderService, getCdnProvider, isCdnConfigured} from "./StorageProviderService";
import {TempStorageProvider} from "./TempStorageProvider";
import {TargetDevice} from "./TargetDevice";

class UploaderService{
    constructor(
        private storageProvider: StorageProvider,
        private tempStorageProvider: TempStorageProvider,
        private cdnProvider?: StorageProvider,
    ){
    }

    async uploadFile(fileName: string, chunks: Buffer, mimeType?: string, bucket?: string): Promise<string>{
        const fileUuid = `${v4()}.${fileName.split('.').pop()}`;

        if (bucket) {
            // Route to CDN provider for specific bucket
            const provider = getCdnProvider(bucket);
            if (!provider) {
                throw new CdnNotConfiguredError();
            }
            return provider.upload(fileUuid, chunks, mimeType);
        }

        // Default: use the default storage provider
        return this.storageProvider.upload(fileUuid, chunks, mimeType)
    }

    uploadTempFile(audioMessageId: string, buffer: Buffer, expireSecond: number){
        return this.tempStorageProvider.uploadTempFile(audioMessageId, buffer, expireSecond)
    }

    async deleteFileById(fileId: string){
        await this.storageProvider.deleteFileById(fileId)
    }

    getTemp(fileId: string){
        return this.tempStorageProvider.get(fileId);
    }

    copyFile(fileId: string, target: TargetDevice) {
        this.storageProvider.copyFile(fileId, target)
    }
}

export class CdnNotConfiguredError extends Error {
    constructor() {
        super("Transient storage not configured. Set S3_CDN_ACCESS_KEY_ID, S3_CDN_USER_REFS_BUCKET, and S3_CDN_ENDPOINT to enable user file uploads.");
        this.name = "CdnNotConfiguredError";
    }
}

export const uploaderService = new UploaderService(storageProviderService, tempProviderService);
