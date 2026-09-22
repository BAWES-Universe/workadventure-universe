import { describe, expect, it } from "vitest";
import { EnvironmentVariables } from "../src/Enum/EnvironmentVariableValidator";

describe("EnvironmentVariable", () => {
    it("should validate properly URLs", () => {
        let result = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
        });
        expect(result.success).toBe(true);

        result = EnvironmentVariables.safeParse({
            PLAY_URL: "https://12.12.12.12",
        });
        expect(result.success).toBe(true);

        result = EnvironmentVariables.safeParse({
            PLAY_URL: "https://12.12.12.12",
            ADMIN_API_URL: "",
        });
        expect(result.success).toBe(true);
    });

    it("should accept a release identity, preferring RELEASE_VERSION and still accepting SENTRY_RELEASE", () => {
        // The images bake RELEASE_VERSION; SENTRY_RELEASE stays accepted as a fallback for one release.
        const withLegacyOnly = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
            SENTRY_RELEASE: "v1.2.3",
        });
        expect(withLegacyOnly.success).toBe(true);
        expect(withLegacyOnly.success && withLegacyOnly.data.SENTRY_RELEASE).toBe("v1.2.3");
        expect(withLegacyOnly.success && withLegacyOnly.data.RELEASE_VERSION).toBeUndefined();

        const withBoth = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
            RELEASE_VERSION: "v1.3.0",
            SENTRY_RELEASE: "v1.2.3",
        });
        expect(withBoth.success).toBe(true);
        expect(withBoth.success && withBoth.data.RELEASE_VERSION).toBe("v1.3.0");

        // The Dockerfile default (ENV RELEASE_VERSION="") must read as "not set": an empty string
        // would otherwise be reported to Sentry as a release name.
        const withEmptyDefaults = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
            RELEASE_VERSION: "",
            SENTRY_RELEASE: "",
        });
        expect(withEmptyDefaults.success).toBe(true);
        expect(withEmptyDefaults.success && withEmptyDefaults.data.RELEASE_VERSION).toBeUndefined();
        expect(withEmptyDefaults.success && withEmptyDefaults.data.SENTRY_RELEASE).toBeUndefined();
    });
});
