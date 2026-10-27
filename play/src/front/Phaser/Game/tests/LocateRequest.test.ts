import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import {
    LOCATE_REQUEST_TTL_MS,
    cancelLocateRequest,
    locateRequestName,
    rememberLocateRequest,
    takeLocateRequest,
    isStaleLocateAnswer,
} from "../LocateRequest";

describe("LocateRequest", () => {
    it("gives the name of the person just looked for", () => {
        rememberLocateRequest("Imagine [Music]", undefined, 1000);
        expect(locateRequestName(1500)).toBe("Imagine [Music]");
    });

    it("keeps their Woka with the answer it belongs to", () => {
        const picture = readable<string | undefined>("data:image/png;base64,imagine");
        rememberLocateRequest("Imagine", picture, 1000);
        expect(takeLocateRequest(1100)).toEqual({ name: "Imagine", picture, cancelled: false });
    });

    it("forgets it once too old to be the awaited answer", () => {
        rememberLocateRequest("Imagine", undefined, 1000);
        expect(locateRequestName(1000 + LOCATE_REQUEST_TTL_MS + 1)).toBeUndefined();
    });

    it("forgets it when a request is made without a name", () => {
        rememberLocateRequest("Imagine", undefined, 1000);
        rememberLocateRequest(undefined, undefined, 1100);
        expect(locateRequestName(1200)).toBeUndefined();
    });

    it("marks the awaited answer as no longer wanted once another card opens", () => {
        rememberLocateRequest("Imagine", undefined, 1000);
        cancelLocateRequest();
        expect(locateRequestName(1100)).toBeUndefined();
        expect(takeLocateRequest(1100)).toEqual({ name: "Imagine", cancelled: true });
    });

    it("keeps the request for its own answer when another avatar's answer comes first", () => {
        rememberLocateRequest("First", undefined, 1000, "u-first");
        rememberLocateRequest("Second", undefined, 1100, "u-second");
        expect(takeLocateRequest(1200, "u-first")).toBeUndefined();
        expect(takeLocateRequest(1300, "u-second")).toEqual({ name: "Second", cancelled: false });
    });

    it("tells an answer for a replaced search from one with no search pending", () => {
        rememberLocateRequest("Second", undefined, 1000, "u-second");
        expect(isStaleLocateAnswer(1200, "u-first")).toBe(true);
        expect(isStaleLocateAnswer(1200, "u-second")).toBe(false);
        expect(isStaleLocateAnswer(1200)).toBe(false);
        expect(isStaleLocateAnswer(20_000, "u-first")).toBe(false);
        takeLocateRequest(1300, "u-second");
        expect(isStaleLocateAnswer(1400, "u-first")).toBe(false);
    });

    it("takes another avatar of the same account for the answer awaited, and an unknown account too", () => {
        rememberLocateRequest("Second", undefined, 1000, "u-second");
        expect(isStaleLocateAnswer(1200, "u-second")).toBe(false);
        expect(isStaleLocateAnswer(1200)).toBe(false);
        expect(takeLocateRequest(1300, "u-second")).toEqual({ name: "Second", cancelled: false });
    });

    it("rejects another account's answer even when the avatar asked for is not known", () => {
        rememberLocateRequest("Second", undefined, 1000, "u-second");
        expect(takeLocateRequest(1100, "u-first")).toBeUndefined();
    });

    it("hands the request to any answer when the account asked for is not known", () => {
        rememberLocateRequest("Imagine", undefined, 1000);
        expect(takeLocateRequest(1100, "u-any")).toEqual({ name: "Imagine", cancelled: false });
    });

    it("hands the request to its answer once", () => {
        rememberLocateRequest("Imagine", undefined, 1000);
        expect(takeLocateRequest(1100)).toEqual({ name: "Imagine", cancelled: false });
        expect(takeLocateRequest(1200)).toBeUndefined();
    });

    it("has no request for an answer to a search started elsewhere", () => {
        takeLocateRequest();
        expect(takeLocateRequest(5000)).toBeUndefined();
    });
});
