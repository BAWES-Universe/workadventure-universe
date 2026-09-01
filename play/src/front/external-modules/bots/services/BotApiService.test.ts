import { describe, expect, it } from "vitest";
import { isOrbitSessionResponse } from "./BotApiService";

describe("BotApiService Orbit session contract", () => {
    it("accepts only the exact opaque v2 response", () => {
        expect(isOrbitSessionResponse({ version: 2, sessionId: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })).toBe(
            true
        );
        expect(
            isOrbitSessionResponse({ version: 2, sessionToken: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })
        ).toBe(false);
        expect(isOrbitSessionResponse({ version: 2, sessionId: "eyJ1c2VySWQiOiJmb3JnZWQifQ==", expiresAt: 123 })).toBe(
            false
        );
        expect(isOrbitSessionResponse({ version: 1, sessionId: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })).toBe(
            false
        );
    });
});
