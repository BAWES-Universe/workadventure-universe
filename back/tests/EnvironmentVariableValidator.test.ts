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

    it("should validate native app version variables", () => {
        const validResult = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
            UNIVERSE_MIN_NATIVE_VERSION: "1.2.3",
            UNIVERSE_LATEST_NATIVE_VERSION: "1.3.0-beta.1",
        });
        expect(validResult.success).toBe(true);

        const invalidResult = EnvironmentVariables.safeParse({
            PLAY_URL: "https://example.com",
            UNIVERSE_MIN_NATIVE_VERSION: "not-a-version",
        });
        expect(invalidResult.success).toBe(false);
    });
});
