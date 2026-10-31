import { describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const tick = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });

vi.mock("../../fileSystem", () => ({
    fileSystem: {
        exist: (p: string) => Promise.resolve(files.has(p)),
        readFileAsString: async (p: string) => {
            // Yield so that a concurrent read-modify-write really interleaves without a lock.
            await tick();
            return files.get(p) ?? "";
        },
        writeStringAsFile: async (p: string, content: string) => {
            await tick();
            files.set(p, content);
        },
        writeByteArrayAsFile: (p: string) => {
            files.set(p, "bytes");
            return Promise.resolve();
        },
        deleteFiles: (p: string) => {
            files.delete(p);
            return Promise.resolve();
        },
    },
}));

vi.mock("../PathMapper", () => ({
    mapPathUsingDomainWithPrefix: (p: string, hostname: string) => `${hostname}/${p}`,
}));

import { CustomEntityCollectionService } from "../CustomEntityCollectionService";

function prefab(id: string) {
    return {
        id,
        name: id,
        tags: [],
        imagePath: `${id}.png`,
        direction: "Down",
        color: "",
        collisionGrid: undefined,
        depthOffset: 0,
    };
}

// What the service builds from hostname "host" and universe/world path "universe/world": the same path the browser
// asks for, with no "//" that a proxy would merge (#1636).
const COLLECTION_FILE = "host/universe/world/assets/entities/entities.json";

function collection(): { id: string; name: string }[] {
    const raw = files.get(COLLECTION_FILE);
    return raw ? (JSON.parse(raw) as { collection: { id: string; name: string }[] }).collection : [];
}

describe("CustomEntityCollectionService", () => {
    it("serialises writes to the shared entities file across service instances", async () => {
        files.clear();
        files.set(
            COLLECTION_FILE,
            JSON.stringify({
                version: "1.0",
                collectionName: "custom entities",
                tags: [],
                collection: [prefab("a"), prefab("b"), prefab("c")],
            })
        );
        // One service per command, as map-storage creates them: two maps of the same world editing at once.
        const fromMapOne = new CustomEntityCollectionService("host", "universe/world");
        const fromMapTwo = new CustomEntityCollectionService("host", "universe/world");

        await Promise.all([
            fromMapOne.deleteEntity({ id: "a" }),
            fromMapTwo.deleteEntity({ id: "b" }),
            fromMapOne.modifyEntity({ id: "c", name: "renamed", tags: ["t"], depthOffset: 1 }),
        ]);

        expect(collection().map((e) => e.id)).toEqual(["c"]);
        expect(collection()[0].name).toBe("renamed");
    });

    it("saves an upload's picture where the browser asks for it, with no double slash", async () => {
        files.clear();
        const upload = {
            ...prefab("arcade"),
            imagePath: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0-arcade.png",
            direction: 2, // Down
            file: new Uint8Array([1]),
        };
        // The world path as the map's address gives it, with or without its last slash.
        await new CustomEntityCollectionService("host", "universe/world").uploadEntity(upload);
        await new CustomEntityCollectionService("host", "universe/world/").uploadEntity(upload);

        expect(files.has("host/universe/world/assets/entities/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0-arcade.png")).toBe(
            true
        );
        expect([...files.keys()].some((key) => key.includes("//"))).toBe(false);
        expect(collection().map((e) => e.id)).toEqual(["arcade", "arcade"]);
    });
    it("finds every picture of an upload from any of them, and whether a new picture would replace one (#1628)", async () => {
        files.clear();
        files.set(
            COLLECTION_FILE,
            JSON.stringify({
                version: "1.0",
                collectionName: "custom entities",
                tags: [],
                collection: [
                    prefab("lamp"),
                    { ...prefab("lamp-left"), variantOf: "lamp" },
                    { ...prefab("lamp-red"), variantOf: "lamp" },
                    prefab("sign"),
                ],
            })
        );
        const service = new CustomEntityCollectionService("host", "universe/world");

        const ids = async (id: string) => (await service.getUploadPictures(id)).map((picture) => picture.id).sort();
        expect(await ids("lamp")).toEqual(["lamp", "lamp-left", "lamp-red"]);
        expect(await ids("lamp-left")).toEqual(["lamp", "lamp-left", "lamp-red"]);
        expect(await ids("sign")).toEqual(["sign"]);
        expect(await ids("missing")).toEqual([]);

        expect(await service.isTaken("sign", "new.png")).toBe(true);
        expect(await service.isTaken("new", "sign.png")).toBe(true);
        expect(await service.isTaken("new", "some/folder/sign.png")).toBe(true);
        expect(await service.isTaken("new", "new.png")).toBe(false);
        // A file already saved with no picture pointing at it
        files.set("host/universe/world/assets/entities/orphan.png", "bytes");
        expect(await service.isTaken("new", "orphan.png")).toBe(true);
    });
});
