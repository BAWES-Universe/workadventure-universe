import { describe, expect, it } from "vitest";
import { isBotUser } from "./ChatUserMapper";

describe("isBotUser", () => {
    it("is true for the bot tag", () => {
        expect(isBotUser({ tags: ["bot"], uuid: "3f2a" })).toBe(true);
    });

    it("is true for a bot- id without the tag", () => {
        expect(isBotUser({ tags: [], uuid: "bot-17" })).toBe(true);
    });

    it("is false for people, admins and guests", () => {
        expect(isBotUser({ tags: ["admin", "member"], uuid: "uuid-bob" })).toBe(false);
        expect(isBotUser({ tags: [], uuid: undefined })).toBe(false);
        expect(isBotUser({})).toBe(false);
    });
});
