import * as semver from "semver";
import { nativeUpdateStore } from "../Stores/NativeUpdateStore";

interface NativeAppInfo {
    version?: string;
}

interface CapacitorBridge {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
    Plugins?: {
        App?: {
            getInfo: () => Promise<NativeAppInfo>;
        };
    };
}

interface VersionPayload {
    minNativeVersion: string;
    latestNativeVersion: string;
    updateUrl: {
        android?: string;
        ios?: string;
    };
}

declare global {
    interface Window {
        Capacitor?: CapacitorBridge;
    }
}

export async function initNativeUpdateCheck(): Promise<void> {
    const capacitor = window.Capacitor;
    if (!capacitor?.Plugins?.App || capacitor.isNativePlatform?.() !== true) {
        return;
    }

    try {
        const [appInfo, versionPayload] = await Promise.all([
            capacitor.Plugins.App.getInfo(),
            fetch("/api/version", { cache: "no-store" }).then((response) => {
                if (!response.ok) {
                    throw new Error(`Version endpoint returned ${response.status}`);
                }
                return response.json() as Promise<VersionPayload>;
            }),
        ]);
        const currentVersion = appInfo.version ?? "0.0.0";
        const platform = capacitor.getPlatform?.();
        const updateUrl = platform === "ios" ? versionPayload.updateUrl.ios : versionPayload.updateUrl.android;

        if (compareVersions(currentVersion, versionPayload.minNativeVersion) < 0) {
            nativeUpdateStore.set({
                blocking: true,
                currentVersion,
                requiredVersion: versionPayload.minNativeVersion,
                latestVersion: versionPayload.latestNativeVersion,
                updateUrl,
            });
            return;
        }

        if (compareVersions(currentVersion, versionPayload.latestNativeVersion) < 0) {
            nativeUpdateStore.set({
                blocking: false,
                currentVersion,
                requiredVersion: versionPayload.minNativeVersion,
                latestVersion: versionPayload.latestNativeVersion,
                updateUrl,
            });
        }
    } catch (error) {
        console.warn("Unable to check native app version", error);
    }
}

function compareVersions(left: string, right: string): number {
    const leftVersion = semver.valid(left) ?? semver.coerce(left)?.version;
    const rightVersion = semver.valid(right) ?? semver.coerce(right)?.version;

    if (leftVersion && rightVersion) {
        return semver.compare(leftVersion, rightVersion);
    }

    return left.localeCompare(right);
}
