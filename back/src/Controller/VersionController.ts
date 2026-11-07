import type { Express, Request, Response } from "express";
import { RELEASE_VERSION } from "../Enum/EnvironmentVariable";
import { version as bakedPackageVersion } from "../Services/version";

/** Default calendar release identifier served when no explicit build tag is injected. */
export const DEFAULT_WEB_VERSION = "2026.05.15";

/** Minimum Capacitor shell version required before forcing a store upgrade. */
export const DEFAULT_MIN_NATIVE_VERSION = "1.0.0";

/** Latest published Capacitor shell version advertised for optional upgrade prompts. */
export const DEFAULT_LATEST_NATIVE_VERSION = "1.2.0";

/** Canonical Google Play Store listing for the BAWES Universe Android shell. */
export const DEFAULT_ANDROID_UPDATE_URL = "https://play.google.com/store/apps/details?id=net.bawes.universe";

/** Canonical Apple App Store listing for the BAWES Universe iOS shell. */
export const DEFAULT_IOS_UPDATE_URL = "https://apps.apple.com/app/id6740000000";

export interface StoreUpdateUrls {
    android: string;
    ios: string;
}

export interface VersionPayload {
    webVersion: string;
    minNativeVersion: string;
    latestNativeVersion: string;
    updateUrl: StoreUpdateUrls;
}

export interface VersionConfigInput {
    webVersion?: string;
    releaseVersion?: string;
    packageVersion?: string;
    minNativeVersion?: string;
    latestNativeVersion?: string;
    androidUpdateUrl?: string;
    iosUpdateUrl?: string;
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/**
 * Resolves the active web build version. Ignores the placeholder "dev" string from
 * unbaked local builds so clients always receive a meaningful version identifier.
 */
export function resolveWebVersion(input: VersionConfigInput): string {
    const explicit = nonEmptyTrimmed(input.webVersion) ?? nonEmptyTrimmed(input.releaseVersion);
    if (explicit) {
        return explicit;
    }
    const candidatePkg = nonEmptyTrimmed(input.packageVersion);
    if (candidatePkg && candidatePkg !== "dev") {
        return candidatePkg;
    }
    return DEFAULT_WEB_VERSION;
}

/**
 * Reads runtime environment overrides for native shell version gates and store URLs.
 */
export function readEnvironmentVersionConfig(): VersionConfigInput {
    return {
        webVersion: process.env.WEB_VERSION,
        releaseVersion: RELEASE_VERSION,
        packageVersion: bakedPackageVersion,
        minNativeVersion: process.env.MIN_NATIVE_VERSION,
        latestNativeVersion: process.env.LATEST_NATIVE_VERSION,
        androidUpdateUrl: process.env.ANDROID_UPDATE_URL,
        iosUpdateUrl: process.env.IOS_UPDATE_URL,
    };
}

/**
 * Constructs the version policy payload consumed by Capacitor mobile shells on startup
 * to decide between uninterrupted launch, a dismissible banner, or a blocking store modal.
 */
export function buildVersionPayload(input: VersionConfigInput = readEnvironmentVersionConfig()): VersionPayload {
    return {
        webVersion: resolveWebVersion(input),
        minNativeVersion: nonEmptyTrimmed(input.minNativeVersion) ?? DEFAULT_MIN_NATIVE_VERSION,
        latestNativeVersion: nonEmptyTrimmed(input.latestNativeVersion) ?? DEFAULT_LATEST_NATIVE_VERSION,
        updateUrl: {
            android: nonEmptyTrimmed(input.androidUpdateUrl) ?? DEFAULT_ANDROID_UPDATE_URL,
            ios: nonEmptyTrimmed(input.iosUpdateUrl) ?? DEFAULT_IOS_UPDATE_URL,
        },
    };
}

/**
 * Exposes `GET /api/version` with cache-busting headers so mobile WebViews always
 * evaluate the live minimum native shell policy on launch.
 */
export class VersionController {
    constructor(private app: Express) {
        this.app.get("/api/version", this.getVersion.bind(this));
    }

    private getVersion(_req: Request, res: Response): void {
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json(buildVersionPayload());
    }
}
