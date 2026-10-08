import {v4} from "uuid";
import {S3_CDN_USER_REFS_BUCKET, S3_CDN_BOT_GENS_BUCKET} from "../Enum/EnvironmentVariable";
import {Location, StorageProvider} from "./StorageProvider";
import {storageProviderService, tempProviderService, getCdnProvider, isCdnConfigured} from "./StorageProviderService";
import {TempStorageProvider} from "./TempStorageProvider";
import {TargetDevice} from "./TargetDevice";
import {NullStorageProvider} from "./NullStorageProvider";

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

    /**
     * A file lives in the default storage or, for chat files and bot images, in one of the CDN buckets, and the id
     * does not say which. Deleting from every place it could be (a delete of a missing file is not an error) means
     * the file is really gone, and a failure anywhere is reported instead of being answered with "ok".
     */
    async deleteFileById(fileId: string){
        const providers: StorageProvider[] = [];
        const cdnProviders = [S3_CDN_USER_REFS_BUCKET, S3_CDN_BOT_GENS_BUCKET]
            .filter((bucket, index, buckets): bucket is string => !!bucket && buckets.indexOf(bucket) === index)
            .map((bucket) => getCdnProvider(bucket))
            .filter((provider): provider is StorageProvider => !!provider);
        // Without a default storage there is nothing to delete from there.
        if (!(this.storageProvider instanceof NullStorageProvider) || cdnProviders.length === 0) {
            providers.push(this.storageProvider);
        }
        providers.push(...cdnProviders);

        const results = await Promise.allSettled(providers.map(async (provider) => provider.deleteFileById(fileId)));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) {
            throw failed.reason;
        }
    }

    getTemp(fileId: string){
        return this.tempStorageProvider.get(fileId);
    }

    async copyFile(fileId: string, target: TargetDevice): Promise<void> {
        await this.storageProvider.copyFile(fileId, target)
    }
}

export class CdnNotConfiguredError extends Error {
    constructor() {
        super("Transient storage not configured. Set S3_CDN_ACCESS_KEY_ID, S3_CDN_USER_REFS_BUCKET, and S3_CDN_ENDPOINT to enable user file uploads.");
        this.name = "CdnNotConfiguredError";
    }
}

export const uploaderService = new UploaderService(storageProviderService, tempProviderService);
