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

// What the service builds from hostname "host" and universe/world path "universe/world".
const COLLECTION_FILE = "host/universe/world//assets/entities/entities.json";

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
});
