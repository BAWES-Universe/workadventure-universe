import { describe, expect, it } from "vitest";
import { compareNativeVersions, isNativeVersionBelowMinimum } from "./AppUpdateStore";

describe("AppUpdateStore", () => {
    it("compares native versions segment by segment", () => {
        expect(compareNativeVersions("1.2.0", "1.1.9")).toBe(1);
        expect(compareNativeVersions("1.0", "1.0.0")).toBe(0);
        expect(compareNativeVersions("2", "1.99.99")).toBe(1);
        expect(compareNativeVersions("1.0.0", "1.0.1")).toBe(-1);
    });

    it("detects native versions below the server minimum", () => {
        expect(isNativeVersionBelowMinimum("1.0.0", "1.0.1")).toBe(true);
        expect(isNativeVersionBelowMinimum("1.2.0", "1.0.1")).toBe(false);
    });
});
