// Uploads are on unless the switch is explicitly turned off ("false" or "0"); unset or empty keeps them on.
// A plain `|| true` read the text "false" as on.
function readSwitch(value: string | undefined, defaultValue: boolean): boolean {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized === "") {
        return defaultValue;
    }
    return !["false", "0", "no", "off"].includes(normalized);
}

// Size limit of one chat file, in bytes. Always a positive, finite number, so a missing, empty or unreadable
// setting can never turn the limit off.
const DEFAULT_UPLOAD_MAX_FILESIZE = 10 * 1024 * 1024;
function readMaxFileSize(value: string | undefined): string {
    const parsed = Number(value);
    if (!value || !Number.isFinite(parsed) || parsed <= 0) {
        if (value) {
            console.warn(`UPLOAD_MAX_FILESIZE "${value}" is not a positive number: using ${DEFAULT_UPLOAD_MAX_FILESIZE} bytes.`);
        }
        return String(DEFAULT_UPLOAD_MAX_FILESIZE);
    }
    return String(Math.floor(parsed));
}

const ENABLE_CHAT_UPLOAD = readSwitch(process.env.ENABLE_CHAT_UPLOAD, true);
const UPLOAD_MAX_FILESIZE = readMaxFileSize(process.env.UPLOAD_MAX_FILESIZE);
const ADMIN_API_URL = process.env.ADMIN_API_URL;

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION;
const AWS_BUCKET = process.env.AWS_BUCKET;
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
const UPLOADER_AWS_SIGNED_URL_EXPIRATION = parseInt(process.env.UPLOADER_AWS_SIGNED_URL_EXPIRATION || "60")

const S3_CDN_ACCESS_KEY_ID = process.env.S3_CDN_ACCESS_KEY_ID;
const S3_CDN_SECRET_ACCESS_KEY = process.env.S3_CDN_SECRET_ACCESS_KEY;
const S3_CDN_USER_REFS_BUCKET = process.env.S3_CDN_USER_REFS_BUCKET;
const S3_CDN_BOT_GENS_BUCKET = process.env.S3_CDN_BOT_GENS_BUCKET;
const S3_CDN_ENDPOINT = process.env.S3_CDN_ENDPOINT;
const S3_CDN_REGION = process.env.S3_CDN_REGION;

const S3_CDN_USER_REFS_PUBLIC_URL = process.env.S3_CDN_USER_REFS_PUBLIC_URL;
const S3_CDN_BOT_GENS_PUBLIC_URL = process.env.S3_CDN_BOT_GENS_PUBLIC_URL;
const BOT_SERVICE_TOKEN = process.env.BOT_SERVICE_TOKEN;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT || "6379";
const REDIS_DB_NUMBER = process.env.REDIS_DB_NUMBER;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

// Same value as play's SECRET_KEY: used to verify the play session token sent with audio message uploads.
// "" must read as unset.
const SECRET_KEY = process.env.SECRET_KEY || undefined;

const UPLOADER_URL = process.env.UPLOADER_URL;
const PLAY_URL = process.env.PLAY_URL;

export const ALLOWED_CORS_ORIGIN = process.env.ALLOWED_CORS_ORIGIN || PLAY_URL || "*";
export const DEBUG_ERROR_MESSAGES = process.env.DEBUG_ERROR_MESSAGES || "";

export const SENTRY_DSN = process.env.SENTRY_DSN_UPLOADER;
// "" must read as unset: the image default is ENV RELEASE_VERSION="", and an empty string
// would otherwise be reported to Sentry as a release name.
export const RELEASE_VERSION = process.env.RELEASE_VERSION || process.env.SENTRY_RELEASE || undefined;
/** @deprecated Kept as an alias for one release; use RELEASE_VERSION. */
export const SENTRY_RELEASE = RELEASE_VERSION;
export const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT;
export const SENTRY_TRACES_SAMPLE_RATE = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1");

export {
    readSwitch,
    readMaxFileSize,
    ENABLE_CHAT_UPLOAD,
    UPLOAD_MAX_FILESIZE,
    ADMIN_API_URL,
    UPLOADER_URL,
    PLAY_URL,

    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION,
    AWS_BUCKET,
    AWS_ENDPOINT,
    UPLOADER_AWS_SIGNED_URL_EXPIRATION,

    REDIS_HOST,
    REDIS_PORT,
    REDIS_DB_NUMBER,
    REDIS_PASSWORD,

    S3_CDN_ACCESS_KEY_ID,
    S3_CDN_SECRET_ACCESS_KEY,
    S3_CDN_USER_REFS_BUCKET,
    S3_CDN_BOT_GENS_BUCKET,
    S3_CDN_ENDPOINT,
    S3_CDN_REGION,
    S3_CDN_USER_REFS_PUBLIC_URL,
    S3_CDN_BOT_GENS_PUBLIC_URL,
    BOT_SERVICE_TOKEN,
    SECRET_KEY,
};
