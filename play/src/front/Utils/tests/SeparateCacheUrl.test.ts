import { describe, expect, it } from "vitest";
import { SEPARATE_CACHE_PARAM, withSeparateCache } from "../SeparateCacheUrl";

const ORBIT_PICTURE = "https://nbg1.your-objectstorage.com/map-templates/avatar-textures/linear-sh.png?t=1761600000";

describe("withSeparateCache", () => {
    it("adds wa_cors to a picture from another site, keeping its own query", () => {
        expect(withSeparateCache(ORBIT_PICTURE)).toBe(`${ORBIT_PICTURE}&${SEPARATE_CACHE_PARAM}=1`);
    });

    it("leaves a picture from this site, one already asked again, and a data picture alone", () => {
        expect(withSeparateCache(`${window.location.origin}/resources/characters/pipoya/Female 01-1.png`)).toBe(
            undefined
        );
        expect(withSeparateCache("/resources/characters/pipoya/Female 01-1.png")).toBe(undefined);
        expect(withSeparateCache(`${ORBIT_PICTURE}&${SEPARATE_CACHE_PARAM}=1`)).toBe(undefined);
        expect(withSeparateCache("data:image/png;base64,AAAA")).toBe(undefined);
    });
});
