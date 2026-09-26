import { describe, expect, it } from "vitest";
import { LOCATE_REQUEST_TTL_MS, locateRequestName, rememberLocateRequest } from "../LocateRequest";

describe("LocateRequest", () => {
    it("gives the name of the person just looked for", () => {
        rememberLocateRequest("Imagine [Music]", 1000);
        expect(locateRequestName(1500)).toBe("Imagine [Music]");
    });

    it("forgets it once too old to be the awaited answer", () => {
        rememberLocateRequest("Imagine", 1000);
        expect(locateRequestName(1000 + LOCATE_REQUEST_TTL_MS + 1)).toBeUndefined();
    });

    it("forgets it when a request is made without a name", () => {
        rememberLocateRequest("Imagine", 1000);
        rememberLocateRequest(undefined, 1100);
        expect(locateRequestName(1200)).toBeUndefined();
    });
});
