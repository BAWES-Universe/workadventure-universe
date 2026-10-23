import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { MAX_UNPACKED_BYTES, assertUnpackedWithin, zipUnpackedSize } from "../zipSize";

async function zipOf(files: Record<string, string>): Promise<ArrayBuffer> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/** Makes the list at the end of the zip claim a size for its first file, as a hostile file would. */
function claimSize(bytes: ArrayBuffer, size: number): ArrayBuffer {
    const copy = bytes.slice(0);
    const view = new DataView(copy);
    for (let at = 0; at < copy.byteLength - 46; at++) {
        if (view.getUint32(at, true) === 0x02014b50) {
            view.setUint32(at + 24, size, true);
            return copy;
        }
    }
    throw new Error("no list in the zip");
}

describe("measuring a zip before it is unpacked", () => {
    it("adds up the size of every file inside", async () => {
        const bytes = await zipOf({ "a.txt": "x".repeat(1000), "dir/b.txt": "y".repeat(234) });
        expect(zipUnpackedSize(bytes)).toBe(1234);
    });

    it("sees the size a file claims, however small the zip itself is", async () => {
        const bytes = claimSize(await zipOf({ "a.txt": "hello" }), 400 * 1024 * 1024);
        expect(bytes.byteLength).toBeLessThan(1000);
        expect(zipUnpackedSize(bytes)).toBeGreaterThan(MAX_UNPACKED_BYTES);
    });

    it("gives up on a size it cannot read, and on bytes that are not a zip", async () => {
        expect(zipUnpackedSize(claimSize(await zipOf({ "a.txt": "hello" }), 0xffffffff))).toBe(Infinity);
        expect(zipUnpackedSize(new TextEncoder().encode("not a zip at all, just text").buffer as ArrayBuffer)).toBe(
            undefined
        );
        expect(zipUnpackedSize(new ArrayBuffer(0))).toBe(undefined);
    });
});

describe("counting what a zip really holds", () => {
    it("lets a zip within the limit through", async () => {
        const bytes = await zipOf({ "a.txt": "x".repeat(1000), "dir/b.txt": "y".repeat(234) });
        await expect(assertUnpackedWithin(bytes, 5000)).resolves.toBeUndefined();
    });

    it("stops a zip that claims a few bytes and holds far more, which the list of sizes cannot tell", async () => {
        const bomb = claimSize(await zipOf({ "a.txt": "\0".repeat(5 * 1024 * 1024) }), 10);
        expect(zipUnpackedSize(bomb)).toBe(10);
        await expect(assertUnpackedWithin(bomb, 1024 * 1024)).rejects.toThrow("too big");
    });

    it("counts the files together, not one by one", async () => {
        const bytes = await zipOf({ "a.txt": "x".repeat(600), "b.txt": "y".repeat(600) });
        await expect(assertUnpackedWithin(bytes, 1000)).rejects.toThrow("too big");
    });

    it("refuses a file whose attributes mark it as a folder though its name is a file's", async () => {
        const bytes = (await zipOf({ "a.txt": "\0".repeat(5 * 1024 * 1024) })).slice(0);
        const view = new DataView(bytes);
        for (let at = 0; at < bytes.byteLength - 46; at++) {
            if (view.getUint32(at, true) === 0x02014b50) {
                // The DOS "folder" attribute, which JSZip trusts and then drops the file's data for.
                view.setUint32(at + 38, 0x10, true);
                break;
            }
        }
        await expect(assertUnpackedWithin(bytes, 1024 * 1024)).rejects.toThrow("cannot be read");
    });

    it("lets a zip with real, empty folders through, even when a folder carries an empty compressed stream", async () => {
        const zip = new JSZip();
        zip.folder("word")?.file("document.xml", "x".repeat(100));
        zip.folder("empty");
        const bytes = (await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })).slice(0);
        await expect(assertUnpackedWithin(bytes, 5000)).resolves.toBeUndefined();
        // Some zip tools (Java's) write 2 bytes of empty deflate stream for a folder.
        const view = new DataView(bytes);
        for (let at = 0; at < bytes.byteLength - 46; at++) {
            if (
                view.getUint32(at, true) === 0x02014b50 &&
                view.getUint8(at + 46 + view.getUint16(at + 28, true) - 1) === 0x2f
            ) {
                view.setUint32(at + 20, 2, true);
            }
        }
        await expect(assertUnpackedWithin(bytes, 5000)).resolves.toBeUndefined();
    });

    it("refuses a list whose records and number do not agree", async () => {
        const bytes = (await zipOf({ "a.txt": "x".repeat(100), "b.txt": "y".repeat(100) })).slice(0);
        const view = new DataView(bytes);
        for (let at = bytes.byteLength - 22; at >= 0; at--) {
            if (view.getUint32(at, true) === 0x06054b50) {
                view.setUint16(at + 10, 1, true);
                break;
            }
        }
        await expect(assertUnpackedWithin(bytes, 5000)).rejects.toThrow("cannot be read");
    });

    it("refuses bytes that are not a zip", async () => {
        await expect(
            assertUnpackedWithin(new TextEncoder().encode("hello").buffer as ArrayBuffer, 10)
        ).rejects.toThrow();
    });
});
