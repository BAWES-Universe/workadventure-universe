import { describe, expect, it } from "vitest";
import type { CapacitorBridgeWindow, VersionPolicy } from "../AppUpdateCheck";
import {
    VersionPolicySchema,
    compareSemver,
    evaluateNativeUpdate,
    isVersionBelow,
    readCapacitorShellInfo,
} from "../AppUpdateCheck";

const SAMPLE_POLICY: VersionPolicy = {
    webVersion: "2026.05.15",
    minNativeVersion: "1.1.0",
    latestNativeVersion: "1.3.0",
    updateUrl: {
        android: "https://play.google.com/store/apps/details?id=net.bawes.universe",
        ios: "https://apps.apple.com/app/id6740000000",
    },
};

describe("AppUpdateCheck", () => {
    it("compares semantic version strings across major, minor, and patch segments", () => {
        expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
        expect(compareSemver("v1.0.0", "1.0.0-beta.1")).toBe(0);
        expect(compareSemver("1.0.9", "1.1.0")).toBe(-1);
        expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
        expect(isVersionBelow("1.0.0", "1.1.0")).toBe(true);
        expect(isVersionBelow("1.1.0", "1.1.0")).toBe(false);
    });

    it("validates GET /api/version payloads with VersionPolicySchema", () => {
        expect(VersionPolicySchema.safeParse(SAMPLE_POLICY).success).toBe(true);
        expect(VersionPolicySchema.safeParse({ webVersion: "" }).success).toBe(false);
    });

    it("returns forced decision when installed native version is below minNativeVersion", () => {
        const decision = evaluateNativeUpdate(
            { version: "1.0.0", platform: "android" },
            SAMPLE_POLICY
        );
        expect(decision).toEqual({
            kind: "forced",
            currentVersion: "1.0.0",
            targetVersion: "1.1.0",
            storeUrl: SAMPLE_POLICY.updateUrl.android,
        });
    });

    it("returns optional decision when installed version is between minNativeVersion and latestNativeVersion", () => {
        const decision = evaluateNativeUpdate(
            { version: "1.2.0", platform: "ios" },
            SAMPLE_POLICY
        );
        expect(decision).toEqual({
            kind: "optional",
            currentVersion: "1.2.0",
            targetVersion: "1.3.0",
            storeUrl: SAMPLE_POLICY.updateUrl.ios,
        });
    });

    it("returns up-to-date decision when installed version meets or exceeds latestNativeVersion", () => {
        const decision = evaluateNativeUpdate(
            { version: "1.3.0", platform: "android" },
            SAMPLE_POLICY
        );
        expect(decision.kind).toBe("up-to-date");
    });

    it("reads Capacitor App.getInfo() in native shells and returns undefined in web browsers", async () => {
        expect(await readCapacitorShellInfo(undefined)).toBeUndefined();
        expect(await readCapacitorShellInfo({ Capacitor: { isNativePlatform: () => false } })).toBeUndefined();

        const iosShell: CapacitorBridgeWindow = {
            Capacitor: {
                isNativePlatform: () => true,
                getPlatform: () => "ios",
                Plugins: {
                    App: {
                        getInfo: () => Promise.resolve({ version: "1.1.5", build: "42" }),
                    },
                },
            },
        };
        expect(await readCapacitorShellInfo(iosShell)).toEqual({
            version: "1.1.5",
            build: "42",
            platform: "ios",
        });
    });
});
