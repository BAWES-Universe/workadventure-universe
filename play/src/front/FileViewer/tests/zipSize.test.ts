import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { MAX_UNPACKED_BYTES, zipUnpackedSize } from "../zipSize";

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
