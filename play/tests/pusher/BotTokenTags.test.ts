import { describe, expect, it } from "vitest";
import { memberTagsFor } from "../../src/pusher/services/BotTokenTags";

describe("memberTagsFor", () => {
    it("keeps the voice-bot tag of a bot's token when Orbit answers no tags", () => {
        expect(memberTagsFor("bot-abc123", false, ["bot", "voice-bot"], [])).toEqual(["bot", "voice-bot"]);
    });

    it("keeps a text-only bot's tag too", () => {
        expect(memberTagsFor("bot-abc123", false, ["bot"], [])).toEqual(["bot"]);
    });

    it("adds to what Orbit answered without repeating it", () => {
        expect(memberTagsFor("bot-abc123", false, ["bot", "voice-bot"], ["bot"])).toEqual(["bot", "voice-bot"]);
    });

    it("trusts no other tag of a bot's token", () => {
        expect(memberTagsFor("bot-abc123", false, ["bot", "admin", "editor"], [])).toEqual(["bot"]);
    });

    it("gives a person nothing from their token", () => {
        expect(memberTagsFor("someone@example.com", false, ["voice-bot"], [])).toEqual([]);
        expect(memberTagsFor("bot-abc123", true, ["voice-bot"], ["member"])).toEqual(["member"]);
    });

    it("leaves a token with no tags alone", () => {
        expect(memberTagsFor("bot-abc123", false, undefined, ["x"])).toEqual(["x"]);
        expect(memberTagsFor(undefined, false, ["voice-bot"], [])).toEqual([]);
    });
});
