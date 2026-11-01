import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import type { WAMFileFormat } from "@workadventure/map-editor";
import type { EditMapCommandMessage } from "@workadventure/messages";
import { GameRoom } from "../src/Model/GameRoom";
import type { User, UserSocket } from "../src/Model/User";

// map-storage saves every edit it is sent
vi.mock("../src/Services/MapStorageClient", () => ({
    getMapStorageClient: () => ({
        handleEditMapCommandWithKeyMessage: (
            request: { editMapCommandMessage: EditMapCommandMessage },
            callback: (err: Error | null, answer: EditMapCommandMessage) => void
        ) => callback(null, request.editMapCommandMessage),
    }),
}));

const ROOM = "https://play.example.test/@/acme/office/lobby";
const WAM_URL = "https://maps.example.test/acme/office/lobby/map.wam";

const gong = (durationSeconds?: number, loop = false) => ({
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
            loop,
            ...(durationSeconds === undefined ? {} : { durationSeconds }),
        },
    ],
});

/** The room's saved map, as map-storage serves it now */
let savedEntities: Record<string, ReturnType<typeof gong>>;

function wam(): WAMFileFormat {
    return {
        version: "1.0.0",
        mapUrl: "./map.tmj",
        areas: [],
        entities: { ...savedEntities },
        entityCollections: [],
    } as unknown as WAMFileFormat;
}

const editor = {
    tags: [],
    canEdit: true,
    uuid: "editor",
    socket: { write: vi.fn() } as unknown as UserSocket,
} as unknown as User;

/** An editor's edit, saved and then sent to the room */
async function edit(room: GameRoom, message: NonNullable<EditMapCommandMessage["editMapMessage"]>["message"]) {
    room.forwardEditMapCommandMessage(editor, { id: "edit", editMapMessage: { message } });
    await (room as unknown as { mapStorageLock: Promise<void> }).mapStorageLock;
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
        savedEntities = { measured: gong(12), old: gong(), jukebox: gong(30, true) };
        vi.spyOn(mapFetcher, "fetchWamFile").mockImplementation(() => Promise.resolve(wam()));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("plays a sound for its saved length, whatever length the clicker claims", async () => {
        const room = await makeRoom();
        await room.clickObjectSound(forgedClick("measured"));
        expect(await room.getObjectSounds()).toEqual([
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
        expect(await room.getObjectSounds()).toEqual([]);
    });

    it("forgets a looping sound when its object is deleted", async () => {
        const room = await makeRoom();
        await room.clickObjectSound(forgedClick("jukebox"));
        expect(await room.getObjectSounds()).toEqual([expect.objectContaining({ entityId: "jukebox", loop: true })]);

        delete savedEntities.jukebox;
        await edit(room, { $case: "deleteEntityMessage", deleteEntityMessage: { id: "jukebox" } });

        expect(await room.getObjectSounds()).toEqual([]);
        // Forgotten, not only left out: nothing is remembered for it any more
        const remembered = (room as unknown as { objectSounds: { getMessages: () => unknown[] } }).objectSounds;
        expect(remembered.getMessages()).toEqual([]);
    });

    it("plays a click once Loop is switched off, instead of reading it as stopping the loop", async () => {
        const room = await makeRoom();
        await room.clickObjectSound(forgedClick("jukebox"));

        savedEntities.jukebox = gong(30, false);
        await edit(room, {
            $case: "modifyEntityMessage",
            modifyEntityMessage: { id: "jukebox", properties: savedEntities.jukebox.properties },
        } as never);
        // Someone who arrives now isn't told the loop still plays
        expect(await room.getObjectSounds()).toEqual([]);

        await room.clickObjectSound(forgedClick("jukebox"));
        expect(await room.getObjectSounds()).toEqual([
            expect.objectContaining({ entityId: "jukebox", playing: true, loop: false, durationSeconds: 30 }),
        ]);
    });

    it("tells nobody who arrives about a loop whose upload was deleted", async () => {
        const room = await makeRoom();
        await room.clickObjectSound(forgedClick("jukebox"));
        expect(await room.getObjectSounds()).toHaveLength(1);

        // Deleting the upload takes every placed copy of it off the map
        delete savedEntities.jukebox;
        await edit(room, {
            $case: "deleteCustomEntityMessage",
            deleteCustomEntityMessage: { id: "p", wholeUpload: true, pictureIds: [], otherRoomWamUrls: [] },
        });

        expect(await room.getObjectSounds()).toEqual([]);
    });
});
