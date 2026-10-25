import { describe, expect, it } from "vitest";
import { peopleAmongPlayers } from "./PlayersStore";

describe("peopleAmongPlayers", () => {
    it("counts the people and leaves the bots out (#1396)", () => {
        const players = [
            { userUuid: "uuid-sara" },
            { userUuid: "bot-guide" },
            { userUuid: "guest-1" },
            { userUuid: "bot-echo" },
        ];
        expect(peopleAmongPlayers(players)).toBe(2);
    });

    it("is 0 with only bots, or nobody", () => {
        expect(peopleAmongPlayers([{ userUuid: "bot-guide" }])).toBe(0);
        expect(peopleAmongPlayers([])).toBe(0);
    });
});
