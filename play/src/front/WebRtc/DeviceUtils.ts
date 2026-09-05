export function isIOS(): boolean {
    return (
        ["iPad Simulator", "iPhone Simulator", "iPod Simulator", "iPad", "iPhone", "iPod"].includes(
            navigator.platform
        ) ||
        // iPad on iOS 13 detection
        (navigator.userAgent.includes("Mac") && "ontouchend" in document)
    );
}

export enum NavigatorType {
    firefox = 1,
    chrome,
    safari,
}

export function getNavigatorType(): NavigatorType {
    if (window.navigator.userAgent.includes("Firefox")) {
        return NavigatorType.firefox;
    } else if (window.navigator.userAgent.includes("Chrome")) {
        return NavigatorType.chrome;
    } else if (window.navigator.userAgent.includes("Safari")) {
        return NavigatorType.safari;
    }
    throw new Error("Couldn't detect navigator type");
}
export function isAndroid(): boolean {
    return window.navigator.userAgent.includes("Android");
}

type CapacitorPlatform = "android" | "ios" | "web";

type CapacitorGlobal = {
    Capacitor?: {
        getPlatform?: () => CapacitorPlatform;
        isNativePlatform?: () => boolean;
    };
};

function getCapacitorBridge() {
    return (window as typeof window & CapacitorGlobal).Capacitor;
}

export function getNativeAppPlatform(): Exclude<CapacitorPlatform, "web"> | undefined {
    const capacitor = getCapacitorBridge();
    const platform = capacitor?.getPlatform?.();

    if (!platform || platform === "web") {
        return undefined;
    }

    return platform;
}

export function isNativeMobileApp(): boolean {
    const capacitor = getCapacitorBridge();
    const nativePlatform = getNativeAppPlatform();

    if (nativePlatform) {
        return capacitor?.isNativePlatform?.() ?? true;
    }

    return false;
}

export function isFirefox(): boolean {
    return window.navigator.userAgent.toLowerCase().indexOf("firefox") !== -1;
}

export function isSafari(): boolean {
    return getNavigatorType() === NavigatorType.safari;
}
