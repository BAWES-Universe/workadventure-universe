import { describe, expect, it } from "vitest";
import { buildAppVersionResponse } from "../src/Services/VersionService";

describe("VersionService", () => {
    it("builds the app version payload from explicit configuration", () => {
        expect(
            buildAppVersionResponse({
                webVersion: "2026.05.16",
                minNativeVersion: "1.2.0",
                latestNativeVersion: "1.3.0",
                androidUpdateUrl: "https://play.google.com/store/apps/details?id=net.bawes.universe",
                iosUpdateUrl: "https://apps.apple.com/app/bawes-universe/id123456789",
            })
        ).toEqual({
            webVersion: "2026.05.16",
            native: {
                minVersion: "1.2.0",
                latestVersion: "1.3.0",
                updateUrls: {
                    android: "https://play.google.com/store/apps/details?id=net.bawes.universe",
                    ios: "https://apps.apple.com/app/bawes-universe/id123456789",
                },
            },
        });
    });

    it("defaults the native latest version to the minimum version", () => {
        expect(buildAppVersionResponse({ minNativeVersion: "2.0.0" }).native).toEqual({
            minVersion: "2.0.0",
            latestVersion: "2.0.0",
            updateUrls: {
                android: undefined,
                ios: undefined,
            },
        });
    });
});
