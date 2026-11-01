import { describe, expect, it } from "vitest";
import { GameMap } from "@workadventure/map-editor";
import type { WAMFileFormat } from "@workadventure/map-editor";
import type { UploadEntityMessage } from "@workadventure/messages";
import { hasCopyHereOutsideViewerRights, uploadOwnerView, withUploader } from "../uploadOwner";
import type { Viewer } from "../uploadOwner";

const lina: Viewer = { uuid: "lina", name: "Lina", canEditMap: false, tags: [] };
const editor: Viewer = { uuid: "sara", name: "Sara", canEditMap: true, tags: [] };

// Lina's desk (0,0 to 100,100) with her lamp on it, and a sign out in the room
function makeGameMap(): GameMap {
    const wam = {
        version: "1.0.0",
        mapUrl: "./map.tmj",
        areas: [
            {
                id: "desk",
                name: "Lina's desk",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                visible: true,
                properties: [
                    {
                        id: "desk-property",
                        type: "personalAreaPropertyData",
                        accessClaimMode: "static",
                        allowedTags: [],
                        ownerId: "lina",
                    },
                ],
            },
        ],
        entities: {
            lampAtDesk: { x: 20, y: 20, prefabRef: { id: "lamp", collectionName: "custom entities" }, properties: [] },
            signInRoom: {
                x: 600,
                y: 600,
                prefabRef: { id: "sign", collectionName: "custom entities" },
                properties: [],
            },
        },
        entityCollections: [],
    } as unknown as WAMFileFormat;
    return new GameMap(
        { layers: [], tilesets: [], width: 10, height: 10, tilewidth: 32, tileheight: 32 } as never,
        wam
    );
}

describe("whose upload it is (#1628)", () => {
    it("says it is ours, and offers the edit links", () => {
        expect(uploadOwnerView({ ownerId: "lina", ownerName: "Lina" }, lina)).toEqual({
            owner: "mine",
            ownerName: "Lina",
            canManage: true,
        });
    });

    it("names someone else's upload and keeps the edit links for its uploader and map editors", () => {
        expect(uploadOwnerView({ ownerId: "sara", ownerName: "Sara" }, lina)).toEqual({
            owner: "someone",
            ownerName: "Sara",
            canManage: false,
        });
        expect(uploadOwnerView({ ownerId: "lina", ownerName: "Lina" }, editor).canManage).toBe(true);
    });

    it("says nothing about an older upload, which stays editors-only", () => {
        expect(uploadOwnerView({}, lina)).toEqual({ owner: "unknown", ownerName: "", canManage: false });
        expect(uploadOwnerView({}, editor).canManage).toBe(true);
    });
});

describe("our own new upload", () => {
    const message = { id: "lamp-left", name: "Lamp", tags: [], imagePath: "x.png" } as unknown as UploadEntityMessage;

    it("carries us as its uploader", () => {
        expect(withUploader(message, [], lina)).toMatchObject({ ownerId: "lina", ownerName: "Lina" });
    });

    it("gives a new side its first picture's uploader", () => {
        const side = { ...message, variantOf: "lamp" };
        expect(withUploader(side, [{ id: "lamp", ownerId: "lina", ownerName: "Lina" }], editor)).toMatchObject({
            ownerId: "lina",
            ownerName: "Lina",
        });
    });
});

describe("deleting an upload whose copies are around the room", () => {
    it("lets the uploader while every copy is at their desk", () => {
        expect(hasCopyHereOutsideViewerRights(["lamp"], makeGameMap(), lina)).toBe(false);
    });

    it("stops the uploader when a copy sits where they can't edit, but not a map editor", () => {
        expect(hasCopyHereOutsideViewerRights(["lamp", "sign"], makeGameMap(), lina)).toBe(true);
        expect(hasCopyHereOutsideViewerRights(["sign"], makeGameMap(), editor)).toBe(false);
    });

    it("lets the uploader delete an upload nobody placed", () => {
        expect(hasCopyHereOutsideViewerRights(["unplaced"], makeGameMap(), lina)).toBe(false);
    });
});
