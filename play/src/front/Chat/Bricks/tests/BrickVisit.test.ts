import { describe, expect, it } from "vitest";
import { canOfferBringAlong, parseBrickVisit, visitingWith } from "../BrickVisit";

describe("what Orbit says about a Brick's visit (#2005)", () => {
    it("reads the three answers, with the place trimmed", () => {
        expect(parseBrickVisit({ state: "none", place: "Universe" })).toEqual({ state: "none", place: "Universe" });
        expect(parseBrickVisit({ state: "none", place: null })).toEqual({ state: "none", place: null });
        expect(parseBrickVisit({ state: "visiting", place: "  Studio  " })).toEqual({
            state: "visiting",
            place: "Studio",
        });
        expect(parseBrickVisit({ state: "blocked", place: "Lobby" })).toEqual({ state: "blocked", place: "Lobby" });
    });

    it("does not make up a place: a visit without one still shows, a blocked place without a name does not", () => {
        expect(parseBrickVisit({ state: "visiting" })).toEqual({ state: "visiting", place: "" });
        expect(parseBrickVisit({ state: "blocked", place: " " })).toBeUndefined();
        expect(parseBrickVisit({ state: "none", place: 4 })).toEqual({ state: "none", place: null });
    });

    it("keeps a long place name short", () => {
        const answer = parseBrickVisit({ state: "visiting", place: "x".repeat(300) });
        expect(answer?.place).toHaveLength(100);
    });

    it("ignores anything that is not an answer", () => {
        expect(parseBrickVisit(undefined)).toBeUndefined();
        expect(parseBrickVisit(null)).toBeUndefined();
        expect(parseBrickVisit("visiting")).toBeUndefined();
        expect(parseBrickVisit({ state: "walking", place: "Universe" })).toBeUndefined();
        expect(parseBrickVisit({ place: "Universe" })).toBeUndefined();
    });
});

describe("when a Brick can be brought along (#2005)", () => {
    it("only a Brick that is on, in a room where nothing walks with the person yet", () => {
        const none = { state: "none", place: "Universe" } as const;
        expect(canOfferBringAlong({ enabled: true }, none)).toBe(true);
        expect(canOfferBringAlong({ enabled: false }, none)).toBe(false);
        expect(canOfferBringAlong({ enabled: true }, undefined)).toBe(false);
        expect(canOfferBringAlong({ enabled: true }, { state: "visiting", place: "Universe" })).toBe(false);
        expect(canOfferBringAlong({ enabled: true }, { state: "blocked", place: "Universe" })).toBe(false);
    });
});

describe("who a visiting Brick walks with, read from its tags (#2005)", () => {
    it("names the person", () => {
        expect(visitingWith(["bot", "visiting:Khalid"])).toBe("Khalid");
        expect(visitingWith(["visiting:  Dana Lee "])).toBe("Dana Lee");
    });

    it("is nobody for any other player", () => {
        expect(visitingWith(undefined)).toBeUndefined();
        expect(visitingWith([])).toBeUndefined();
        expect(visitingWith(["bot", "admin"])).toBeUndefined();
        expect(visitingWith(["visiting:"])).toBeUndefined();
        expect(visitingWith(["visiting:   "])).toBeUndefined();
    });
});
