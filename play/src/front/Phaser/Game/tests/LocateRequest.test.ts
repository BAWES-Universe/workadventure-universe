import { describe, expect, it } from "vitest";
import { readable } from "svelte/store";
import {
    LOCATE_REQUEST_TTL_MS,
    cancelLocateRequest,
    locateRequestName,
    rememberLocateRequest,
    takeLocateRequest,
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
        rememberLocateRequest("First", undefined, 1000, 5);
        rememberLocateRequest("Second", undefined, 1100, 7);
        expect(takeLocateRequest(1200, 5)).toBeUndefined();
        expect(takeLocateRequest(1300, 7)).toEqual({ name: "Second", cancelled: false });
    });

    it("hands the request to any answer when the avatar asked for is not known", () => {
        rememberLocateRequest("Imagine", undefined, 1000);
        expect(takeLocateRequest(1100, 9)).toEqual({ name: "Imagine", cancelled: false });
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
