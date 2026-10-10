import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import type { WAMFileFormat } from "@workadventure/map-editor";
import { GameRoom } from "../src/Model/GameRoom";

const ROOM = "https://play.example.test/@/acme/office/lobby";
const WAM_URL = "https://maps.example.test/acme/office/lobby/map.wam";

function wamWith(restricted: boolean): WAMFileFormat {
    return {
        version: "1.0.0",
        mapUrl: "./map.tmj",
        areas: [
            {
                id: "board",
                name: "Board",
                x: 0,
                y: 0,
                width: 32,
                height: 32,
                visible: true,
                properties: [
                    { id: "lk", type: "livekitRoomProperty", roomName: "Board", livekitRoomConfig: {} },
                    ...(restricted
                        ? [{ id: "r", type: "restrictedRightsPropertyData", readTags: ["staff"], writeTags: [] }]
                        : []),
                ],
            },
        ],
        entities: {},
        entityCollections: [],
    } as unknown as WAMFileFormat;
}

const player = { tags: [] as string[], uuid: "user-1", canEdit: false };
const board = areaSpaceName("Board", ROOM);

async function makeRoom() {
    const room = await GameRoom.create(
        ROOM,
        () => undefined,
        () => undefined,
        160,
        160,
        () => undefined,
        () => undefined,
        () => undefined,
        () => undefined,
        () => undefined,
        () => undefined,
        () => undefined
    );
    return room;
}

describe("GameRoom area policy when the room's areas cannot be read", () => {
    let fetchWam: MockInstance<typeof mapFetcher.fetchWamFile>;

    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(GameRoom as unknown as { getMapDetails: () => Promise<unknown> }, "getMapDetails").mockResolvedValue({
            group: "acme/office",
            wamUrl: WAM_URL,
            editable: false,
            mapUrl: undefined,
        });
        fetchWam = vi.spyOn(mapFetcher, "fetchWamFile");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("keeps refusing a closed area with the rules from the last good read when the map cannot be read", async () => {
        fetchWam.mockResolvedValueOnce(wamWith(true)); // read when the room is created
        const room = await makeRoom();
        fetchWam.mockRejectedValue(new Error("storage down"));

        const policy = await room.getAreaSpacePolicyFor(player);

        expect(policy.areaSpacesUnknown).toBe(false);
        expect(policy.refusedAreaSpaces).toEqual([board]);
    });

    it("never replaces a closed area with an open one because a refresh failed", async () => {
        fetchWam.mockResolvedValueOnce(wamWith(true));
        const room = await makeRoom();
        // An area edit makes the room read the map again; that read fails
        (room as unknown as { wamPromise: undefined }).wamPromise = undefined;
        fetchWam.mockRejectedValue(new Error("timeout"));

        expect((await room.getAreaSpacePolicyFor(player)).refusedAreaSpaces).toEqual([board]);
    });

    it("says it does not know, instead of nothing being refused, when the areas have never been read", async () => {
        fetchWam.mockResolvedValueOnce(wamWith(true));
        const room = await makeRoom();
        (room as unknown as { lastGoodWam: undefined }).lastGoodWam = undefined;
        fetchWam.mockRejectedValue(new Error("storage down"));

        const policy = await room.getAreaSpacePolicyFor(player);

        expect(policy.areaSpacesUnknown).toBe(true);
        expect(policy.refusedAreaSpaces).toEqual([]);
    });

    it("answers properly again once the map can be read, and tightened rules replace the old ones", async () => {
        fetchWam.mockResolvedValueOnce(wamWith(false));
        const room = await makeRoom();
        expect((await room.getAreaSpacePolicyFor(player)).refusedAreaSpaces).toEqual([]);

        (room as unknown as { wamPromise: undefined }).wamPromise = undefined;
        fetchWam.mockResolvedValue(wamWith(true));
        const policy = await room.getAreaSpacePolicyFor(player);
        expect(policy.areaSpacesUnknown).toBe(false);
        expect(policy.refusedAreaSpaces).toEqual([board]);
    });

    it("does not refuse people who may edit the room, or bots, whatever happens to the map", async () => {
        fetchWam.mockResolvedValueOnce(wamWith(true));
        const room = await makeRoom();
        (room as unknown as { lastGoodWam: undefined }).lastGoodWam = undefined;
        fetchWam.mockRejectedValue(new Error("storage down"));

        const editor = await room.getAreaSpacePolicyFor({ ...player, canEdit: true });
        const bot = await room.getAreaSpacePolicyFor({ tags: ["bot"], uuid: "bot-1", canEdit: false });
        expect(editor).toEqual({ refusedAreaSpaces: [], listenOnlyAreaSpaces: [], areaSpacesUnknown: false });
        expect(bot).toEqual({ refusedAreaSpaces: [], listenOnlyAreaSpaces: [], areaSpacesUnknown: false });
    });

    it("asks again shortly after saying it does not know, and tells the users once it can read the map", async () => {
        vi.useFakeTimers();
        fetchWam.mockResolvedValueOnce(wamWith(true));
        const room = await makeRoom();
        (room as unknown as { lastGoodWam: undefined }).lastGoodWam = undefined;
        fetchWam.mockRejectedValueOnce(new Error("storage down"));
        const written: unknown[] = [];
        const user = { ...player, socket: { write: (message: unknown) => written.push(message) } };
        vi.spyOn(room, "getUsers").mockReturnValue(new Map([[1, user as never]]));

        expect((await room.getAreaSpacePolicyFor(player)).areaSpacesUnknown).toBe(true);
        fetchWam.mockResolvedValue(wamWith(true));
        await vi.advanceTimersByTimeAsync(2500);

        const sent = JSON.stringify(written);
        expect(sent).toContain(board);
        expect(sent).toContain('"areaSpacesUnknown":false');
    });
});
