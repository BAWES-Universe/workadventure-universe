import { describe, expect, it } from "vitest";
import {
    arrivalRule,
    EMPTY_HASH_SNAPSHOT,
    parseHashParameters,
    parseQuestHash,
    parseQuestHostOverride,
    questTargetsForArrival,
} from "../QuestHash";

describe("parseQuestHash", () => {
    it("reads the parameters the arrival rules care about", () => {
        const snapshot = parseQuestHash("#moveTo=12,34&questArea=Big%20Courtyard&questHost=bot%3Abot-42");
        expect(snapshot).toEqual({
            moveTo: true,
            moveToUser: false,
            questArea: "Big Courtyard",
            questHost: { kind: "bot", uuid: "bot-42" },
        });
    });

    it("treats a bare start-position key as nothing", () => {
        expect(parseQuestHash("#entrance")).toEqual(EMPTY_HASH_SNAPSHOT);
        expect(parseHashParameters("#entrance")).toEqual({ entrance: undefined });
    });

    it("ignores empty or broken values", () => {
        expect(parseQuestHash("#moveTo=&questArea=%E0%A4%A").questArea).toBeUndefined();
        expect(parseQuestHash("#moveTo=").moveTo).toBe(false);
    });
});

describe("parseQuestHostOverride", () => {
    it("reads bot, area and none", () => {
        expect(parseQuestHostOverride("none")).toEqual({ kind: "none" });
        expect(parseQuestHostOverride("area%3ALobby")).toEqual({ kind: "area", name: "Lobby" });
        expect(parseQuestHostOverride("bot:bot-1")).toEqual({ kind: "bot", uuid: "bot-1" });
    });

    it("rejects anything else", () => {
        expect(parseQuestHostOverride(undefined)).toBeUndefined();
        expect(parseQuestHostOverride("person:1")).toBeUndefined();
        expect(parseQuestHostOverride("bot:")).toBeUndefined();
        expect(parseQuestHostOverride("Lobby")).toBeUndefined();
    });
});

describe("arrivalRule", () => {
    it("skips the invitation only for a link to a person", () => {
        expect(arrivalRule(parseQuestHash("#moveToUser=abc"))).toBe("skip");
        expect(arrivalRule(parseQuestHash("#moveToUser=abc&moveToAvatar=3"))).toBe("skip");
    });

    it("waits for the spawn walk of an invite link instead of skipping", () => {
        expect(arrivalRule(parseQuestHash("#moveTo=10,20"))).toBe("after-move");
    });

    it("treats a plain arrival, a start key or a chat room link as normal", () => {
        expect(arrivalRule(parseQuestHash(""))).toBe("normal");
        expect(arrivalRule(parseQuestHash("#start"))).toBe("normal");
        expect(arrivalRule(parseQuestHash("#chatRoomId=!x:y"))).toBe("normal");
    });
});

describe("questTargetsForArrival", () => {
    it("prefers the live hash of a later map", () => {
        expect(questTargetsForArrival("#questArea=Garden&questHost=none")).toEqual({
            questArea: "Garden",
            questHost: { kind: "none" },
        });
    });
});
