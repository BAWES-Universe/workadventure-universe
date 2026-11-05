import { describe, it, vi, expect, beforeEach } from "vitest";
import { GameMap } from "@workadventure/map-editor";
import type { WAMFileFormat } from "@workadventure/map-editor";

const { maps, saved, failSaveFor, queued, collection } = vi.hoisted(() => ({
    maps: new Map<string, unknown>(),
    saved: [] as string[],
    failSaveFor: new Set<string>(),
    queued: [] as { key: string; id: string; message: unknown }[],
    collection: { failDelete: false, deleted: [] as string[][] },
}));

vi.mock("../../MapsManager", () => ({
    mapsManager: {
        readGameMap: (key: string) =>
            maps.has(key) ? Promise.resolve(maps.get(key)) : Promise.reject(new Error(`No map ${key}`)),
        getOrLoadGameMap: (key: string) =>
            maps.has(key) ? Promise.resolve(maps.get(key)) : Promise.reject(new Error(`No map ${key}`)),
        getGameMap: (key: string) => maps.get(key),
        getLoadedMaps: () => [...maps.keys()],
        saveMapNow: (key: string) => {
            if (failSaveFor.has(key)) return Promise.reject(new Error(`Could not write ${key}`));
            saved.push(key);
            return Promise.resolve();
        },
        addCommandToQueue: (key: string, message: { id: string }) => queued.push({ key, id: message.id, message }),
    },
}));
vi.mock("../../fileSystem", () => ({
    fileSystem: { listFiles: () => Promise.resolve(["lounge/map.wam", "attic/map.wam", "empty/map.wam"]) },
}));

import { deleteUploadEverywhere } from "../UploadDeletion";
import { countCopiesByRoom } from "../CustomEntityCopies";
import { editionLocks } from "../EditionLocks";

const OFFICE = "host/universe/world/office/map.wam";
const LOUNGE = "host/universe/world/lounge/map.wam";
const ATTIC = "host/universe/world/attic/map.wam";
const EMPTY = "host/universe/world/empty/map.wam";

function makeMap(copies: Record<string, string>): GameMap {
    const entities: Record<string, unknown> = {};
    for (const [id, prefab] of Object.entries(copies)) {
        entities[id] = { x: 1, y: 1, prefabRef: { id: prefab, collectionName: "custom entities" }, properties: [] };
    }
    return new GameMap(
        { layers: [], tilesets: [], width: 10, height: 10, tilewidth: 32, tileheight: 32 } as never,
        {
            version: "1.0.0",
            mapUrl: "./map.tmj",
            areas: [],
            entities,
            entityCollections: [],
        } as unknown as WAMFileFormat
    );
}

const uploads = {
    deleteEntities: (ids: string[]) => {
        if (collection.failDelete) return Promise.reject(new Error("Could not write the collection"));
        collection.deleted.push(ids);
        return Promise.resolve();
    },
};
const message = { id: "bookcase", wholeUpload: true, pictureIds: [] };
const checkRights = vi.fn(() => Promise.resolve());
const run = () =>
    deleteUploadEverywhere({
        mapKey: OFFICE,
        universeWorldPath: "universe/world",
        pictureIds: ["bookcase", "bookcase-red"],
        commandId: "command",
        message,
        uploads: uploads as never,
        checkRights,
    });
const copiesIn = (key: string) => Object.keys((maps.get(key) as GameMap).getWam()?.entities ?? {});

describe("deleting an upload everywhere (#1690)", () => {
    beforeEach(() => {
        maps.clear();
        saved.length = 0;
        failSaveFor.clear();
        queued.length = 0;
        collection.failDelete = false;
        collection.deleted.length = 0;
        checkRights.mockReset();
        checkRights.mockResolvedValue(undefined);
        maps.set(OFFICE, makeMap({ a: "bookcase", chair: "chair" }));
        maps.set(LOUNGE, makeMap({ b: "bookcase", c: "bookcase-red", d: "chair" }));
        maps.set(ATTIC, makeMap({ e: "chair" }));
        maps.set(EMPTY, makeMap({}));
    });

    it("counts the copies room by room, all pictures together, leaving out rooms with none", async () => {
        const rooms = await countCopiesByRoom(OFFICE, "universe/world", ["bookcase", "bookcase-red"], (key) =>
            Promise.resolve(maps.get(key) as GameMap)
        );
        expect(rooms.map((room) => [room.pathInWorld, room.count])).toEqual([
            ["office/map.wam", 1],
            ["lounge/map.wam", 2],
        ]);
    });

    it("takes every copy out of every room, saves those rooms, then removes the upload", async () => {
        const others = await run();

        expect(copiesIn(OFFICE)).toEqual(["chair"]);
        expect(copiesIn(LOUNGE)).toEqual(["d"]);
        expect(copiesIn(ATTIC)).toEqual(["e"]);
        expect(saved.sort()).toEqual([LOUNGE, OFFICE].sort());
        expect(collection.deleted).toEqual([["bookcase", "bookcase-red"]]);
        // The people in every other room of the world are told, not only those whose room held a copy
        expect(others.sort()).toEqual(["attic/map.wam", "empty/map.wam", "lounge/map.wam"]);
        expect(queued.map((entry) => entry.key).sort()).toEqual([ATTIC, EMPTY, LOUNGE].sort());
    });

    it("waits for an edit that is running in another room, and holds that room until it is done", async () => {
        const order: string[] = [];
        let finishEdit: () => void = () => undefined;
        const edit = editionLocks.waitForLock(
            LOUNGE,
            () =>
                new Promise<void>((resolve) => {
                    finishEdit = () => {
                        order.push("edit done");
                        resolve();
                    };
                })
        );
        const deleting = run().then(() => order.push("delete done"));
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
        });
        expect(copiesIn(LOUNGE).sort()).toEqual(["b", "c", "d"]);
        finishEdit();
        await Promise.all([edit, deleting]);
        expect(order).toEqual(["edit done", "delete done"]);
        expect(copiesIn(LOUNGE)).toEqual(["d"]);
    });

    it("asks again whether this person may delete once the other rooms are locked, and refuses if a copy appeared where they can't edit", async () => {
        // The first check passed. While the delete waits for the lock of the attic, an edit there puts a copy down.
        let finishEdit: () => void = () => undefined;
        const edit = editionLocks.waitForLock(
            ATTIC,
            () =>
                new Promise<void>((resolve) => {
                    finishEdit = () => {
                        (maps.get(ATTIC) as GameMap).getGameMapEntities()?.addEntity("late", {
                            x: 1,
                            y: 1,
                            prefabRef: { id: "bookcase", collectionName: "custom entities" },
                            properties: [],
                        });
                        resolve();
                    };
                })
        );
        checkRights.mockImplementation(() =>
            Object.keys((maps.get(ATTIC) as GameMap).getWam()?.entities ?? {}).includes("late")
                ? Promise.reject(new Error("User uploader is not allowed to delete the object bookcase"))
                : Promise.resolve()
        );
        const deleting = run();
        const refused = expect(deleting).rejects.toThrow("not allowed to delete");
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
        });
        expect(checkRights).not.toHaveBeenCalled();
        finishEdit();
        await Promise.all([edit, refused]);

        expect(checkRights).toHaveBeenCalledTimes(1);
        // Nothing was removed or saved anywhere, and the copy that appeared is still there
        expect(copiesIn(ATTIC).sort()).toEqual(["e", "late"]);
        expect(copiesIn(OFFICE).sort()).toEqual(["a", "chair"]);
        expect(copiesIn(LOUNGE).sort()).toEqual(["b", "c", "d"]);
        expect(saved).toEqual([]);
        expect(collection.deleted).toEqual([]);
        expect(queued).toEqual([]);
    });

    it("deletes nothing when a room can't be read", async () => {
        maps.delete(LOUNGE);
        await expect(run()).rejects.toThrow();
        expect(copiesIn(OFFICE).sort()).toEqual(["a", "chair"]);
        expect(saved).toEqual([]);
        expect(collection.deleted).toEqual([]);
        expect(queued).toEqual([]);
    });

    it("puts every copy back when a room can't be saved", async () => {
        failSaveFor.add(LOUNGE);
        await expect(run()).rejects.toThrow("Could not write");
        expect(copiesIn(OFFICE).sort()).toEqual(["a", "chair"]);
        expect(copiesIn(LOUNGE).sort()).toEqual(["b", "c", "d"]);
        expect(collection.deleted).toEqual([]);
        expect(queued).toEqual([]);
    });

    it("puts every copy back, in memory and in the files, when the upload can't be removed", async () => {
        collection.failDelete = true;
        await expect(run()).rejects.toThrow("collection");
        expect(copiesIn(OFFICE).sort()).toEqual(["a", "chair"]);
        expect(copiesIn(LOUNGE).sort()).toEqual(["b", "c", "d"]);
        // Saved with the change, then saved again without it
        expect(saved.filter((key) => key === LOUNGE)).toHaveLength(2);
        expect(queued).toEqual([]);
    });
});
