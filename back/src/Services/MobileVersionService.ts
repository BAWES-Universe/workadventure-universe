import {
    MOBILE_ANDROID_UPDATE_URL,
    MOBILE_IOS_UPDATE_URL,
    MOBILE_LATEST_NATIVE_VERSION,
    MOBILE_MIN_NATIVE_VERSION,
    MOBILE_WEB_VERSION,
} from "../Enum/EnvironmentVariable";

export interface MobileVersionPayload {
    webVersion: string;
    minNativeVersion: string;
    latestNativeVersion: string;
    updateUrl: {
        android: string;
        ios?: string;
    };
}

export function getMobileVersionPayload(): MobileVersionPayload {
    const updateUrl: MobileVersionPayload["updateUrl"] = {
        android: MOBILE_ANDROID_UPDATE_URL,
    };

    if (MOBILE_IOS_UPDATE_URL) {
        updateUrl.ios = MOBILE_IOS_UPDATE_URL;
    }

    return {
        webVersion: MOBILE_WEB_VERSION,
        minNativeVersion: MOBILE_MIN_NATIVE_VERSION,
        latestNativeVersion: MOBILE_LATEST_NATIVE_VERSION,
        updateUrl,
    };
}
