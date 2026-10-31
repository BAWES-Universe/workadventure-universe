import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import type { WAMFileFormat } from "@workadventure/map-editor";
import { GameRoom } from "../src/Model/GameRoom";

const ROOM = "https://play.example.test/@/acme/office/lobby";
const WAM_URL = "https://maps.example.test/acme/office/lobby/map.wam";

const gong = (durationSeconds?: number) => ({
    x: 0,
    y: 0,
    prefabRef: { collectionName: "c", id: "p" },
    properties: [
        {
            id: "sound",
            type: "playAudio",
            audioLink: "https://example.com/gong.mp3",
            startsOn: "click",
            heardBy: "map",
            loop: false,
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
        },
    ],
});

function wam(): WAMFileFormat {
    return {
        version: "1.0.0",
        mapUrl: "./map.tmj",
        areas: [],
        entities: { measured: gong(12), old: gong() },
        entityCollections: [],
    } as unknown as WAMFileFormat;
}

async function makeRoom() {
    return GameRoom.create(
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
}

// A player claims the sound lasts for ever, to keep everyone else from clicking it again
const forgedClick = (entityId: string) => ({
    entityId,
    propertyId: "sound",
    loop: true,
    durationSeconds: 1e9,
    waitSeconds: 1e9,
});

describe("GameRoom object sounds (#1627)", () => {
    beforeEach(() => {
        vi.spyOn(GameRoom as unknown as { getMapDetails: () => Promise<unknown> }, "getMapDetails").mockResolvedValue({
            group: "acme/office",
            wamUrl: WAM_URL,
            editable: false,
            mapUrl: undefined,
        });
        vi.spyOn(mapFetcher, "fetchWamFile").mockResolvedValue(wam());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("plays a sound for its saved length, whatever length the clicker claims", async () => {
        const room = await makeRoom();
        await room.clickObjectSound(forgedClick("measured"));
        expect(room.getObjectSounds()).toEqual([
            expect.objectContaining({ entityId: "measured", loop: false, durationSeconds: 12 }),
        ]);
    });

    it("counts a sound without a saved length as unknown, so a claimed length can't hold the object", async () => {
        const room = await makeRoom();
        const click = vi.spyOn((room as unknown as { objectSounds: { click: () => void } }).objectSounds, "click");
        await room.clickObjectSound(forgedClick("old"));
        await room.clickObjectSound(forgedClick("old"));
        expect(click).toHaveBeenCalledTimes(2);
        expect(click).toHaveBeenLastCalledWith(
            expect.objectContaining({ entityId: "old", loop: false, durationSeconds: 0, waitSeconds: 0 })
        );
        // Nobody who arrives is told about a sound whose end is unknown
        expect(room.getObjectSounds()).toEqual([]);
    });
});
