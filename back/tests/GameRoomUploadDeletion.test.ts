import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import type { WAMFileFormat } from "@workadventure/map-editor";
import type { EditMapCommandMessage } from "@workadventure/messages";
import { GameRoom } from "../src/Model/GameRoom";

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

const deleteOfUpload: EditMapCommandMessage = {
    id: "delete",
    editMapMessage: {
        message: {
            $case: "deleteCustomEntityMessage",
            deleteCustomEntityMessage: { id: "p", wholeUpload: true, pictureIds: ["p", "p-red"] },
        },
    },
};

describe("GameRoom told that an upload was deleted in another room (#1722)", () => {
    beforeEach(() => {
        vi.spyOn(GameRoom as unknown as { getMapDetails: () => Promise<unknown> }, "getMapDetails").mockResolvedValue({
            group: "acme/office",
            wamUrl: WAM_URL,
            editable: false,
            mapUrl: undefined,
        });
        savedEntities = { jukebox: gong(30, true) };
        vi.spyOn(mapFetcher, "fetchWamFile").mockImplementation(() => Promise.resolve(wam()));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("tells the people in the room the delete, as for an object deleted in their own room", async () => {
        const room = await makeRoom();
        const dispatch = vi.spyOn(room, "dispatchRoomMessage").mockImplementation(() => undefined);

        room.receiveUploadDeletion(deleteOfUpload);

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({
            message: { $case: "editMapCommandMessage", editMapCommandMessage: deleteOfUpload },
        });
    });

    it("reads the saved map again, so the sound of a deleted copy is gone for people who arrive", async () => {
        const room = await makeRoom();
        vi.spyOn(room, "dispatchRoomMessage").mockImplementation(() => undefined);
        await room.clickObjectSound({
            entityId: "jukebox",
            propertyId: "sound",
            loop: true,
            durationSeconds: 1e9,
            waitSeconds: 1e9,
        });
        expect(await room.getObjectSounds()).toHaveLength(1);

        delete savedEntities.jukebox;
        room.receiveUploadDeletion(deleteOfUpload);

        expect(await room.getObjectSounds()).toEqual([]);
    });
});
