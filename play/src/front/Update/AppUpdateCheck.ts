import { z } from "zod";

/** Endpoint exposed by the backend reporting minimum and latest mobile shell versions. */
export const VERSION_API_ENDPOINT = "/api/version";

/** Schema validating the server version policy payload returned by `GET /api/version`. */
export const VersionPolicySchema = z.object({
    webVersion: z.string().min(1),
    minNativeVersion: z.string().min(1),
    latestNativeVersion: z.string().min(1),
    updateUrl: z.object({
        android: z.string().url(),
        ios: z.string().url(),
    }),
});

export type VersionPolicy = z.infer<typeof VersionPolicySchema>;

export type NativePlatform = "android" | "ios";

/** Installed native shell metadata read from Capacitor's `App.getInfo()`. */
export interface NativeShellInfo {
    version: string;
    build?: string;
    platform: NativePlatform;
}

/** Result of comparing the installed Capacitor shell against the server's version gates. */
export interface NativeUpdateDecision {
    kind: "up-to-date" | "optional" | "forced";
    currentVersion: string;
    targetVersion: string;
    storeUrl: string;
}

/** Minimal Capacitor bridge shape injected into the WebView global scope at runtime. */
export interface CapacitorBridgeWindow {
    Capacitor?: {
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
        Plugins?: {
            App?: {
                getInfo?: () => Promise<{ version?: string; build?: string }>;
            };
        };
    };
    navigator?: {
        userAgent?: string;
    };
}

function parseSemverParts(rawVersion: string): [number, number, number] {
    const cleaned = rawVersion.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "";
    const parts = cleaned.split(".").map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    });
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Compares two semantic version strings (`major.minor.patch`).
 * Returns `-1` when `current < target`, `0` when equal, and `1` when `current > target`.
 */
export function compareSemver(current: string, target: string): -1 | 0 | 1 {
    const currentParts = parseSemverParts(current);
    const targetParts = parseSemverParts(target);
    for (let i = 0; i < 3; i++) {
        const left = currentParts[i] ?? 0;
        const right = targetParts[i] ?? 0;
        if (left < right) return -1;
        if (left > right) return 1;
    }
    return 0;
}

/** True when `installedVersion` is strictly older than `requiredVersion`. */
export function isVersionBelow(installedVersion: string, requiredVersion: string): boolean {
    return compareSemver(installedVersion, requiredVersion) === -1;
}

function resolveNativePlatform(win: CapacitorBridgeWindow): NativePlatform {
    const bridgePlatform = win.Capacitor?.getPlatform?.()?.toLowerCase();
    if (bridgePlatform === "ios") return "ios";
    if (bridgePlatform === "android") return "android";
    const ua = win.navigator?.userAgent ?? "";
    return /iPhone|iPad|iPod/i.test(ua) ? "ios" : "android";
}

/**
 * Reads the installed native shell version via Capacitor's `App.getInfo()`.
 * Returns `undefined` in standard web browsers so store prompts only run inside the native shell.
 */
export async function readCapacitorShellInfo(
    win: CapacitorBridgeWindow | undefined = typeof window !== "undefined"
        ? (window as unknown as CapacitorBridgeWindow)
        : undefined
): Promise<NativeShellInfo | undefined> {
    if (!win?.Capacitor?.isNativePlatform?.()) {
        return undefined;
    }
    const getInfo = win.Capacitor.Plugins?.App?.getInfo;
    if (!getInfo) {
        return undefined;
    }
    try {
        const info = await getInfo();
        const version = info?.version?.trim();
        if (!version) return undefined;
        return {
            version,
            build: info.build?.trim(),
            platform: resolveNativePlatform(win),
        };
    } catch {
        return undefined;
    }
}

/**
 * Evaluates whether the installed native shell must show a blocking store modal (`forced`),
 * a dismissible banner (`optional`), or continue without interruption (`up-to-date`).
 */
export function evaluateNativeUpdate(shell: NativeShellInfo, policy: VersionPolicy): NativeUpdateDecision {
    const storeUrl = shell.platform === "ios" ? policy.updateUrl.ios : policy.updateUrl.android;
    if (isVersionBelow(shell.version, policy.minNativeVersion)) {
        return {
            kind: "forced",
            currentVersion: shell.version,
            targetVersion: policy.minNativeVersion,
            storeUrl,
        };
    }
    if (isVersionBelow(shell.version, policy.latestNativeVersion)) {
        return {
            kind: "optional",
            currentVersion: shell.version,
            targetVersion: policy.latestNativeVersion,
            storeUrl,
        };
    }
    return {
        kind: "up-to-date",
        currentVersion: shell.version,
        targetVersion: policy.latestNativeVersion,
        storeUrl,
    };
}
