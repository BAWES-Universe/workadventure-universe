import { version } from "./version";
import {
    UNIVERSE_ANDROID_UPDATE_URL,
    UNIVERSE_IOS_UPDATE_URL,
    UNIVERSE_LATEST_NATIVE_VERSION,
    UNIVERSE_MIN_NATIVE_VERSION,
    UNIVERSE_WEB_VERSION,
} from "../Enum/EnvironmentVariable";

const DEFAULT_NATIVE_VERSION = "1.0.0";

export interface AppVersionConfig {
    webVersion?: string;
    minNativeVersion?: string;
    latestNativeVersion?: string;
    androidUpdateUrl?: string;
    iosUpdateUrl?: string;
}

export interface AppVersionResponse {
    webVersion: string;
    native: {
        minVersion: string;
        latestVersion: string;
        updateUrls: {
            android?: string;
            ios?: string;
        };
    };
}

export function buildAppVersionResponse(config: AppVersionConfig = {}): AppVersionResponse {
    const minNativeVersion = config.minNativeVersion || DEFAULT_NATIVE_VERSION;

    return {
        webVersion: config.webVersion || version,
        native: {
            minVersion: minNativeVersion,
            latestVersion: config.latestNativeVersion || minNativeVersion,
            updateUrls: {
                android: config.androidUpdateUrl,
                ios: config.iosUpdateUrl,
            },
        },
    };
}

export function getAppVersionResponse(): AppVersionResponse {
    return buildAppVersionResponse({
        webVersion: UNIVERSE_WEB_VERSION,
        minNativeVersion: UNIVERSE_MIN_NATIVE_VERSION,
        latestNativeVersion: UNIVERSE_LATEST_NATIVE_VERSION,
        androidUpdateUrl: UNIVERSE_ANDROID_UPDATE_URL,
        iosUpdateUrl: UNIVERSE_IOS_UPDATE_URL,
    });
}
