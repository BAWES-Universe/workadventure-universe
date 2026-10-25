import { describe, expect, it } from "vitest";
import { toRoomDetails } from "../../src/pusher/services/RoomDetails";

describe("toRoomDetails", () => {
    it("splits each room's users into people and bots, with the people's names", () => {
        expect(
            toRoomDetails([
                { roomId: "https://play.test/@/u/w/hq", nbUsers: 27, nbBots: 21, peopleNames: ["Ahmad", "Khalid"] },
                { roomId: "https://play.test/@/u/w/lobby", nbUsers: 1, nbBots: 0, peopleNames: ["Omar"] },
            ])
        ).toEqual({
            "https://play.test/@/u/w/hq": { people: 6, bots: 21, names: ["Ahmad", "Khalid"] },
            "https://play.test/@/u/w/lobby": { people: 1, bots: 0, names: ["Omar"] },
        });
    });

    it("reads a back that does not send bots yet as all people", () => {
        expect(toRoomDetails([{ roomId: "r", nbUsers: 3, nbBots: 0, peopleNames: [] }])).toEqual({
            r: { people: 3, bots: 0, names: [] },
        });
    });

    it("never counts fewer than zero people", () => {
        expect(toRoomDetails([{ roomId: "r", nbUsers: 2, nbBots: 5, peopleNames: [] }]).r).toEqual({
            people: 0,
            bots: 2,
            names: [],
        });
    });
});
