import { describe, expect, it } from "vitest";
import { matchesPeopleSearch } from "./PeopleSearch";

const bot = "@bot_2d9e3f40-3333-4444-8555-b66677778888:chat.test";

describe("matchesPeopleSearch", () => {
    it("finds a bot known only by its chat address when searching for Bot or Brick", () => {
        expect(matchesPeopleSearch({ username: "Melody", isBot: false, chatId: bot }, "bot", true)).toBe(true);
    });
    it("finds a bot that is on the map", () => {
        expect(matchesPeopleSearch({ username: "Melody", isBot: true }, "brick", true)).toBe(true);
    });
    it("does not find a person for Bot, and finds them by name", () => {
        const sara = { username: "Sara", isBot: false, chatId: "@sara:chat.test" };
        expect(matchesPeopleSearch(sara, "bot", true)).toBe(false);
        expect(matchesPeopleSearch(sara, "sar", false)).toBe(true);
    });
    it("shows everyone for an empty search", () => {
        expect(matchesPeopleSearch({ username: "Sara" }, "", false)).toBe(true);
    });
});
