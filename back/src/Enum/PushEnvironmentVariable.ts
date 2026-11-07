/**
 * Push notification environment configuration for Web Push (VAPID), Android (FCM),
 * and iOS (APNs) dispatch channels. Empty strings are normalized to undefined so
 * unconfigured providers cleanly fall back without partial credential errors.
 */

export interface PushEnvironmentConfig {
    serviceToken: string | undefined;
    vapidPublicKey: string | undefined;
    vapidPrivateKey: string | undefined;
    vapidSubject: string | undefined;
    fcmServerKey: string | undefined;
    fcmApiUrl: string;
    apnsAuthToken: string | undefined;
    apnsBundleId: string | undefined;
    apnsHost: string;
    dryRun: boolean;
}

const DEFAULT_FCM_API_URL = "https://fcm.googleapis.com/fcm/send";
const DEFAULT_APNS_HOST = "https://api.push.apple.com";

/**
 * Trims an environment variable value and converts blank strings to undefined
 * so optional secrets in `.env` files are never treated as active credentials.
 */
export function readOptionalEnv(rawValue: string | undefined): string | undefined {
    const trimmed = rawValue?.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed;
}

/**
 * Parses a boolean environment flag while preserving a deterministic default
 * when the variable is omitted or blank.
 */
export function readBooleanEnv(rawValue: string | undefined, defaultValue: boolean): boolean {
    const normalized = rawValue?.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
        return true;
    }
    if (normalized === "false" || normalized === "0") {
        return false;
    }
    return defaultValue;
}

/**
 * Resolves the complete push notification runtime configuration from a process
 * environment dictionary.
 */
export function resolvePushEnvironment(envSource: NodeJS.ProcessEnv = process.env): PushEnvironmentConfig {
    return {
        serviceToken: readOptionalEnv(envSource.PUSH_SERVICE_TOKEN),
        vapidPublicKey: readOptionalEnv(envSource.PUSH_VAPID_PUBLIC_KEY),
        vapidPrivateKey: readOptionalEnv(envSource.PUSH_VAPID_PRIVATE_KEY),
        vapidSubject: readOptionalEnv(envSource.PUSH_VAPID_SUBJECT),
        fcmServerKey: readOptionalEnv(envSource.FCM_SERVER_KEY),
        fcmApiUrl: readOptionalEnv(envSource.FCM_API_URL) ?? DEFAULT_FCM_API_URL,
        apnsAuthToken: readOptionalEnv(envSource.APNS_AUTH_TOKEN),
        apnsBundleId: readOptionalEnv(envSource.APNS_BUNDLE_ID),
        apnsHost: readOptionalEnv(envSource.APNS_HOST) ?? DEFAULT_APNS_HOST,
        dryRun: readBooleanEnv(envSource.PUSH_NOTIFICATIONS_DRY_RUN, false),
    };
}

const resolvedPushEnv = resolvePushEnvironment(process.env);

export const PUSH_SERVICE_TOKEN = resolvedPushEnv.serviceToken;
export const PUSH_VAPID_PUBLIC_KEY = resolvedPushEnv.vapidPublicKey;
export const PUSH_VAPID_PRIVATE_KEY = resolvedPushEnv.vapidPrivateKey;
export const PUSH_VAPID_SUBJECT = resolvedPushEnv.vapidSubject;
export const FCM_SERVER_KEY = resolvedPushEnv.fcmServerKey;
export const FCM_API_URL = resolvedPushEnv.fcmApiUrl;
export const APNS_AUTH_TOKEN = resolvedPushEnv.apnsAuthToken;
export const APNS_BUNDLE_ID = resolvedPushEnv.apnsBundleId;
export const APNS_HOST = resolvedPushEnv.apnsHost;
export const PUSH_NOTIFICATIONS_DRY_RUN = resolvedPushEnv.dryRun;
