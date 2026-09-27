import { describe, expect, it } from "vitest";
import { avatarIdOf, resolvePersonTarget, userIdOnThisMap } from "./PersonTarget";

const HERE = "http://play.test/_/global/maps/here.json";
const ELSEWHERE = "http://play.test/_/global/maps/elsewhere.json";

describe("userIdOnThisMap", () => {
    it("reads the avatar id from the space user id of someone on this map", () => {
        expect(userIdOnThisMap({ spaceUserId: `${HERE}_42`, playUri: HERE }, HERE)).toBe(42);
    });

    it("tells two tabs of the same account apart", () => {
        const tabA = userIdOnThisMap({ spaceUserId: `${HERE}_7`, uuid: "same", playUri: HERE }, HERE);
        const tabB = userIdOnThisMap({ spaceUserId: `${HERE}_8`, uuid: "same", playUri: HERE }, HERE);
        expect(tabA).toBe(7);
        expect(tabB).toBe(8);
    });

    it("is undefined for someone on another map (avatar ids only mean something on one map)", () => {
        expect(userIdOnThisMap({ spaceUserId: `${ELSEWHERE}_42`, playUri: ELSEWHERE }, HERE)).toBeUndefined();
    });

    it("is undefined without a usable space user id or room", () => {
        expect(userIdOnThisMap({ playUri: HERE }, HERE)).toBeUndefined();
        expect(userIdOnThisMap({ spaceUserId: "no-number", playUri: HERE }, HERE)).toBeUndefined();
        expect(userIdOnThisMap({ spaceUserId: `${HERE}_`, playUri: HERE }, HERE)).toBeUndefined();
        expect(userIdOnThisMap({ spaceUserId: `${HERE}_42`, playUri: HERE }, undefined)).toBeUndefined();
    });
});

describe("avatarIdOf", () => {
    it("reads the avatar id of a session in another room, so that room can walk to that exact session", () => {
        expect(avatarIdOf({ spaceUserId: `${ELSEWHERE}_7` })).toBe(7);
    });

    it("is undefined without a usable space user id", () => {
        expect(avatarIdOf({})).toBeUndefined();
        expect(avatarIdOf({ spaceUserId: "no-number" })).toBeUndefined();
        expect(avatarIdOf({ spaceUserId: `${ELSEWHERE}_` })).toBeUndefined();
    });
});

describe("resolvePersonTarget", () => {
    const known = new Set([7, 8]);
    const isKnown = (userId: number) => known.has(userId);

    it("targets the exact avatar when it is known locally", () => {
        expect(resolvePersonTarget({ spaceUserId: `${HERE}_8`, uuid: "same", playUri: HERE }, HERE, isKnown)).toEqual({
            kind: "avatar",
            userId: 8,
        });
    });

    it("asks the server for that exact avatar when it is on this map but not known locally", () => {
        // Out of view: the server is asked by uuid and avatar id, so another tab of the same account is not picked.
        expect(resolvePersonTarget({ spaceUserId: `${HERE}_9`, uuid: "same", playUri: HERE }, HERE, isKnown)).toEqual({
            kind: "account",
            uuid: "same",
            playUri: HERE,
            avatarOnThisMap: true,
            userId: 9,
        });
    });

    it("asks the server by uuid for someone on another map", () => {
        expect(
            resolvePersonTarget({ spaceUserId: `${ELSEWHERE}_7`, uuid: "bob", playUri: ELSEWHERE }, HERE, isKnown)
        ).toEqual({ kind: "account", uuid: "bob", playUri: ELSEWHERE, avatarOnThisMap: false });
    });

    it("does not match an avatar id from another map against local avatars", () => {
        const target = resolvePersonTarget(
            { spaceUserId: `${ELSEWHERE}_7`, uuid: "bob", playUri: ELSEWHERE },
            HERE,
            isKnown
        );
        expect(target.kind).toBe("account");
    });

    it("falls back to the account without a space user id", () => {
        expect(resolvePersonTarget({ uuid: "bob", playUri: HERE }, HERE, isKnown)).toEqual({
            kind: "account",
            uuid: "bob",
            playUri: HERE,
            avatarOnThisMap: false,
        });
    });

    it("has no target without a uuid or a local avatar", () => {
        expect(resolvePersonTarget({ playUri: HERE }, HERE, isKnown)).toEqual({ kind: "none" });
        expect(resolvePersonTarget({ spaceUserId: `${HERE}_9`, playUri: HERE }, HERE, isKnown)).toEqual({
            kind: "none",
        });
    });
});
