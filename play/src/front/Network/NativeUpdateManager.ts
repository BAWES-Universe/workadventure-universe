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
    const leftParts = left.split(/[.-]/);
    const rightParts = right.split(/[.-]/);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index++) {
        const leftPart = leftParts[index];
        const rightPart = rightParts[index];

        if (leftPart === undefined || rightPart === undefined) {
            const presentPart = leftPart ?? rightPart ?? "0";
            const presentNumber = Number(presentPart);
            if (Number.isInteger(presentNumber)) {
                const comparison =
                    (leftPart === undefined ? 0 : presentNumber) - (rightPart === undefined ? 0 : presentNumber);
                if (comparison !== 0) {
                    return comparison > 0 ? 1 : -1;
                }
                continue;
            }
            return leftPart === undefined ? 1 : -1;
        }

        const leftNumber = Number(leftPart);
        const rightNumber = Number(rightPart);

        if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
            if (leftNumber !== rightNumber) {
                return leftNumber > rightNumber ? 1 : -1;
            }
            continue;
        }

        const comparison = leftPart.localeCompare(rightPart);
        if (comparison !== 0) {
            return comparison > 0 ? 1 : -1;
        }
    }

    return 0;
}
