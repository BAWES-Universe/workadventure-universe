import { writable } from "svelte/store";

interface CapacitorAppInfo {
    version?: string;
    build?: string;
}

interface CapacitorBridge {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
    Plugins?: {
        App?: {
            getInfo?: () => Promise<CapacitorAppInfo>;
        };
    };
}

interface CapacitorWindow extends Window {
    Capacitor?: CapacitorBridge;
}

interface AppVersionResponse {
    native?: {
        minVersion?: string;
        latestVersion?: string;
        updateUrls?: {
            android?: string;
            ios?: string;
        };
    };
}

export interface NativeAppUpdateState {
    checked: boolean;
    blocking: boolean;
    available: boolean;
    dismissed: boolean;
    currentVersion?: string;
    minVersion?: string;
    latestVersion?: string;
    platform?: string;
    updateUrl?: string;
    error?: string;
}

interface AppUpdateState {
    serviceWorkerUpdateAvailable: boolean;
    native: NativeAppUpdateState;
}

const initialState: AppUpdateState = {
    serviceWorkerUpdateAvailable: false,
    native: {
        checked: false,
        blocking: false,
        available: false,
        dismissed: false,
    },
};

const { subscribe, update } = writable<AppUpdateState>(initialState);

let pendingServiceWorkerRegistration: ServiceWorkerRegistration | undefined;
let reloadingForServiceWorkerUpdate = false;

export const appUpdateStore = {
    subscribe,
};

export function notifyServiceWorkerUpdate(registration: ServiceWorkerRegistration): void {
    pendingServiceWorkerRegistration = registration;
    update((state) => ({
        ...state,
        serviceWorkerUpdateAvailable: true,
    }));
}

export function dismissServiceWorkerUpdate(): void {
    update((state) => ({
        ...state,
        serviceWorkerUpdateAvailable: false,
    }));
}

export function applyServiceWorkerUpdate(): void {
    const waitingWorker = pendingServiceWorkerRegistration?.waiting;

    if (!waitingWorker) {
        window.location.reload();
        return;
    }

    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadingForServiceWorkerUpdate) {
            return;
        }
        reloadingForServiceWorkerUpdate = true;
        window.location.reload();
    });

    waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

function getCapacitorBridge(): CapacitorBridge | undefined {
    return (window as CapacitorWindow).Capacitor;
}

function getNumericVersionParts(version: string): number[] {
    const parts = version.match(/\d+/g)?.map((part) => Number.parseInt(part, 10)) ?? [];
    return parts.length > 0 ? parts : [0];
}

export function compareNativeVersions(left: string, right: string): number {
    const leftParts = getNumericVersionParts(left);
    const rightParts = getNumericVersionParts(right);
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index++) {
        const leftPart = leftParts[index] ?? 0;
        const rightPart = rightParts[index] ?? 0;

        if (leftPart !== rightPart) {
            return leftPart > rightPart ? 1 : -1;
        }
    }

    return 0;
}

export function isNativeVersionBelowMinimum(currentVersion: string, minVersion: string): boolean {
    return compareNativeVersions(currentVersion, minVersion) < 0;
}

export function isNativeUpdateAvailable(
    currentVersion: string | undefined,
    latestVersion: string | undefined,
    blocking: boolean
): boolean {
    return Boolean(
        currentVersion && latestVersion && !blocking && compareNativeVersions(currentVersion, latestVersion) < 0
    );
}

export async function checkNativeAppVersion(): Promise<void> {
    const capacitor = getCapacitorBridge();

    if (!capacitor?.isNativePlatform?.()) {
        return;
    }

    const platform = capacitor.getPlatform?.() ?? "unknown";
    let appInfo: CapacitorAppInfo | undefined;

    try {
        appInfo = await capacitor.Plugins?.App?.getInfo?.();

        if (!appInfo?.version) {
            update((state) => ({
                ...state,
                native: {
                    ...state.native,
                    checked: true,
                    blocking: false,
                    available: false,
                    platform,
                    error: "Native app version is unavailable.",
                },
            }));
            return;
        }

        const response = await fetch("/api/version", {
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(`Version endpoint returned ${response.status}`);
        }

        const versionResponse = (await response.json()) as AppVersionResponse;
        const minVersion = versionResponse.native?.minVersion;
        const latestVersion = versionResponse.native?.latestVersion;
        const updateUrl =
            platform === "ios" ? versionResponse.native?.updateUrls?.ios : versionResponse.native?.updateUrls?.android;
        const blocking = minVersion ? isNativeVersionBelowMinimum(appInfo.version, minVersion) : false;
        const available = isNativeUpdateAvailable(appInfo.version, latestVersion, blocking);

        update((state) => ({
            ...state,
            native: {
                checked: true,
                blocking,
                available,
                dismissed: state.native.latestVersion === latestVersion ? state.native.dismissed : false,
                currentVersion: appInfo.version,
                minVersion,
                latestVersion,
                platform,
                updateUrl,
            },
        }));
    } catch (error) {
        console.warn("Unable to check native app version", error);
        update((state) => ({
            ...state,
            native: {
                ...state.native,
                checked: true,
                blocking: false,
                available: false,
                currentVersion: appInfo?.version,
                platform,
                error: error instanceof Error ? error.message : "Unable to check native app version.",
            },
        }));
    }
}

export function openNativeUpdateUrl(updateUrl: string | undefined): void {
    if (!updateUrl) {
        return;
    }

    window.location.href = updateUrl;
}

export function dismissNativeUpdate(): void {
    update((state) => ({
        ...state,
        native: {
            ...state.native,
            dismissed: true,
        },
    }));
}
