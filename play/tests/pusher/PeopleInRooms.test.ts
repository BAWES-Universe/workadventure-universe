import { describe, expect, it, vi } from "vitest";

// The pusher's environment is checked when its services are imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

const { getAllClients } = vi.hoisted(() => ({ getAllClients: vi.fn() }));
vi.mock("../../src/pusher/services/ApiClientRepository", () => ({ apiClientRepository: { getAllClients } }));

import { getPeopleInRooms } from "../../src/pusher/services/PeopleInRooms";

/** A back server answering getRooms with these rooms, or failing. */
const back = (rooms: { roomId: string; nbUsers: number; nbBots: number }[] | Error) => ({
    getRooms: (
        _request: unknown,
        _metadata: unknown,
        _options: unknown,
        callback: (error: unknown, result?: unknown) => void
    ) =>
        rooms instanceof Error
            ? callback(rooms)
            : callback(null, { roomDescription: rooms.map((room) => ({ ...room, peopleNames: [] })) }),
});

describe("getPeopleInRooms", () => {
    it("counts the people in each room, bots left out, across back servers (#1396)", async () => {
        getAllClients.mockResolvedValue([
            back([
                { roomId: "hq", nbUsers: 27, nbBots: 21 },
                { roomId: "cafe", nbUsers: 7, nbBots: 4 },
            ]),
            back([{ roomId: "hq", nbUsers: 2, nbBots: 0 }]),
            back(new Error("down")),
        ]);
        const people = await getPeopleInRooms();
        expect(Object.fromEntries(people)).toEqual({ hq: 8, cafe: 3 });
    });

    it("counts everyone from a back too old to count bots", async () => {
        getAllClients.mockResolvedValue([back([{ roomId: "hq", nbUsers: 27, nbBots: 0 }])]);
        expect((await getPeopleInRooms()).get("hq")).toBe(27);
    });
});
