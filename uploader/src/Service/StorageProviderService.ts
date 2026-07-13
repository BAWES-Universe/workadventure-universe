import {
    S3_CDN_ACCESS_KEY_ID,
    S3_CDN_SECRET_ACCESS_KEY,
    S3_CDN_USER_REFS_BUCKET,
    S3_CDN_BOT_GENS_BUCKET,
    S3_CDN_ENDPOINT,
    S3_CDN_REGION
} from "../Enum/EnvironmentVariable";
import {StorageProvider} from "./StorageProvider";
import {S3StorageProvider, s3StorageProvider} from "./S3StorageProvider";
import {redisStorageProvider} from "./RedisStorageProvider";
import {NullStorageProvider} from "./NullStorageProvider";

export const storageProviderService: StorageProvider =
    s3StorageProvider || redisStorageProvider || new NullStorageProvider()

export const tempProviderService = redisStorageProvider || new NullStorageProvider()

/**
 * Optional second S3 provider for transient content (user refs, bot gens).
 * Only created when S3_CDN_* env vars are configured.
 */
let cdnS3Provider: S3StorageProvider | null = null;
if (S3_CDN_ACCESS_KEY_ID && S3_CDN_SECRET_ACCESS_KEY && (S3_CDN_USER_REFS_BUCKET || S3_CDN_BOT_GENS_BUCKET)) {
    cdnS3Provider = new S3StorageProvider(
        S3_CDN_USER_REFS_BUCKET || S3_CDN_BOT_GENS_BUCKET || '',
        S3_CDN_REGION,
        S3_CDN_ENDPOINT,
        S3_CDN_ACCESS_KEY_ID,
        S3_CDN_SECRET_ACCESS_KEY,
    );
}

/**
 * Cache of S3StorageProvider instances per bucket name.
 * Avoids creating a new AWS.S3 client and re-running CORS setup on every upload.
 */
const cdnProviderCache = new Map<string, S3StorageProvider>();

/**
 * Get the CDN provider for a specific bucket name.
 * Returns null if CDN provider is not configured.
 */
export function getCdnProvider(bucketName: string): StorageProvider | null {
    if (!cdnS3Provider) {
        return null;
    }
    let provider = cdnProviderCache.get(bucketName);
    if (!provider) {
        provider = new S3StorageProvider(
            bucketName,
            S3_CDN_REGION,
            S3_CDN_ENDPOINT,
            S3_CDN_ACCESS_KEY_ID,
            S3_CDN_SECRET_ACCESS_KEY,
        );
        cdnProviderCache.set(bucketName, provider);
    }
    return provider;
}

/**
 * Check if the CDN provider is configured.
 */
export function isCdnConfigured(): boolean {
    return cdnS3Provider !== null;
}
