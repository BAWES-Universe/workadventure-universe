import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { MAX_UNPACKED_BYTES, assertUnpackedWithin, zipHeadersAgree, zipUnpackedSize } from "../zipSize";

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

interface RawEntry {
    name: string;
    data: Uint8Array;
    /** What the list at the end says, and what the file's own header says; both default to the real sizes. */
    listed?: { compressed: number; unpacked: number };
    own?: { compressed: number; unpacked: number };
    flags?: number;
    /** The way of packing the list gives, when it differs from the file's own header (deflate, 8). */
    listedMethod?: number;
    ownExtra?: number[];
    listedExtra?: number[];
}

/** Writes a zip by hand, so that the file's own header and the list at the end can say different things. */
function rawZip(entries: RawEntry[]): ArrayBuffer {
    const parts: number[][] = [];
    const list: number[][] = [];
    const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
    const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    let offset = 0;
    for (const entry of entries) {
        const compressed = Array.from(deflateRawSync(entry.data));
        const name = Array.from(new TextEncoder().encode(entry.name));
        const real = { compressed: compressed.length, unpacked: entry.data.length };
        const listed = entry.listed ?? real;
        const own = entry.own ?? real;
        const flags = entry.flags ?? 0;
        const ownExtra = entry.ownExtra ?? [];
        const listedExtra = entry.listedExtra ?? [];
        const header = [
            ...u32(0x04034b50),
            ...u16(20),
            ...u16(flags),
            ...u16(8),
            ...u32(0),
            ...u32(0),
            ...u32(own.compressed),
            ...u32(own.unpacked),
            ...u16(name.length),
            ...u16(ownExtra.length),
            ...name,
            ...ownExtra,
            ...compressed,
        ];
        list.push([
            ...u32(0x02014b50),
            ...u16(20),
            ...u16(20),
            ...u16(flags),
            ...u16(entry.listedMethod ?? 8),
            ...u32(0),
            ...u32(0),
            ...u32(listed.compressed),
            ...u32(listed.unpacked),
            ...u16(name.length),
            ...u16(listedExtra.length),
            ...u16(0),
            ...u16(0),
            ...u16(0),
            ...u32(0),
            ...u32(offset),
            ...name,
            ...listedExtra,
        ]);
        parts.push(header);
        offset += header.length;
    }
    const directory = list.flat();
    const end = [
        ...u32(0x06054b50),
        ...u16(0),
        ...u16(0),
        ...u16(entries.length),
        ...u16(entries.length),
        ...u32(directory.length),
        ...u32(offset),
        ...u16(0),
    ];
    return new Uint8Array([...parts.flat(), ...directory, ...end]).buffer;
}

/** A zip64 extra field: its id, its length, and eight bytes of size. */
const ZIP64_EXTRA = [0x01, 0x00, 0x08, 0x00, 0, 0, 0, 0, 0, 0, 0, 0];

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
        const real = new Uint8Array(5 * 1024 * 1024);
        const compressed = deflateRawSync(real).length;
        const bomb = rawZip([
            {
                name: "a.txt",
                data: real,
                listed: { compressed, unpacked: 10 },
                own: { compressed, unpacked: 10 },
            },
        ]);
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
        const twoBytes = rawZip([
            { name: "empty/", data: new Uint8Array(0) },
            { name: "word/document.xml", data: new TextEncoder().encode("x".repeat(100)) },
        ]);
        expect(zipUnpackedSize(twoBytes)).toBe(100);
        await expect(assertUnpackedWithin(twoBytes, 5000)).resolves.toBeUndefined();
    });

    it("lets a zip with empty files through (Word and Excel files carry some)", async () => {
        const bytes = await zipOf({ "a.txt": "x".repeat(100), "customXml/empty.xml": "" });
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

    it("refuses a zip with data in front of it, which JSZip reads by shifting its offsets", async () => {
        const zip = await zipOf({ "a.txt": "x".repeat(100) });
        const shifted = new Uint8Array(zip.byteLength + 10);
        shifted.set(new Uint8Array(zip), 10);
        await expect(JSZip.loadAsync(shifted.buffer)).resolves.toBeDefined();
        await expect(assertUnpackedWithin(shifted.buffer, 5000)).rejects.toThrow("cannot be read");
    });

    it("refuses a file that is empty in the list but holds a big stream in its own header", async () => {
        const real = new Uint8Array(5 * 1024 * 1024);
        const hidden = rawZip([
            { name: "a.txt", data: real, listed: { compressed: 0, unpacked: 0 } },
            { name: "b.txt", data: new TextEncoder().encode("hello") },
        ]);
        // The list is all that JSZip and every count made from it see: nothing there is big.
        expect(zipUnpackedSize(hidden)).toBe(5);
        await expect(JSZip.loadAsync(hidden)).resolves.toBeDefined();
        await expect(assertUnpackedWithin(hidden, 1024 * 1024)).rejects.toThrow("cannot be read");
    });

    it("refuses a big stream that the list and the file's own header both call empty, with or without a data descriptor", async () => {
        const real = new Uint8Array(5 * 1024 * 1024);
        const none = { compressed: 0, unpacked: 0 };
        // A stream of two bytes in the list is just as empty to JSZip, and the reader unpacks the real one
        const two = { compressed: 2, unpacked: 0 };
        for (const sizes of [none, two]) {
            for (const flags of [0, 0x0008]) {
                const hidden = rawZip([{ name: "a.txt", data: real, listed: sizes, own: sizes, flags }]);
                expect(zipUnpackedSize(hidden)).toBe(0);
                await expect(JSZip.loadAsync(hidden)).resolves.toBeDefined();
                await expect(assertUnpackedWithin(hidden, 1024 * 1024)).rejects.toThrow("cannot be read");
            }
        }
    });

    it("refuses a file whose own header and the list say it is packed in different ways", async () => {
        const real = new Uint8Array(5 * 1024 * 1024);
        const none = { compressed: 0, unpacked: 0 };
        // Stored and empty in the list, deflated in the file's own header, where the spreadsheet reader looks
        const hidden = rawZip([{ name: "a.txt", data: real, listed: none, own: none, listedMethod: 0 }]);
        expect(zipUnpackedSize(hidden)).toBe(0);
        await expect(assertUnpackedWithin(hidden, 1024 * 1024)).rejects.toThrow("cannot be read");
        const plain = new TextEncoder().encode("hello".repeat(100));
        expect(zipHeadersAgree(rawZip([{ name: "a.txt", data: plain, listedMethod: 0 }]))).toBe(false);
    });

    it("lets an empty file through, however a writer spells it", async () => {
        const empty = new Uint8Array(0);
        expect(zipHeadersAgree(rawZip([{ name: "empty.txt", data: empty }]))).toBe(true);
        const zip = new JSZip();
        zip.file("empty.txt", "");
        zip.folder("folder");
        zip.file("a.txt", "hello");
        for (const streamFiles of [false, true]) {
            const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", streamFiles });
            await expect(assertUnpackedWithin(bytes, 5000)).resolves.toBeUndefined();
        }
    });

    it("refuses a file whose own header and the list disagree about either size", async () => {
        const data = new TextEncoder().encode("hello".repeat(100));
        const compressed = deflateRawSync(data).length;
        for (const own of [
            { compressed: compressed + 1, unpacked: data.length },
            { compressed, unpacked: data.length + 1 },
            { compressed: 0, unpacked: 0 },
        ]) {
            expect(zipHeadersAgree(rawZip([{ name: "a.txt", data, own }]))).toBe(false);
        }
    });

    it("refuses 64-bit size fields, in the list or in a file's own header", async () => {
        const data = new TextEncoder().encode("hello".repeat(100));
        expect(zipHeadersAgree(rawZip([{ name: "a.txt", data }]))).toBe(true);
        expect(zipHeadersAgree(rawZip([{ name: "a.txt", data, ownExtra: ZIP64_EXTRA }]))).toBe(false);
        expect(zipHeadersAgree(rawZip([{ name: "a.txt", data, listedExtra: ZIP64_EXTRA }]))).toBe(false);
        // Other extra fields (timestamps, for one) are harmless.
        const timestamp = [0x55, 0x54, 0x05, 0x00, 0x01, 0, 0, 0, 0];
        expect(zipHeadersAgree(rawZip([{ name: "a.txt", data, ownExtra: timestamp, listedExtra: timestamp }]))).toBe(
            true
        );
    });

    it("lets a file through that was written with a data descriptor, whose own header has no sizes", async () => {
        const data = new TextEncoder().encode("hello".repeat(100));
        const bytes = rawZip([{ name: "a.txt", data, flags: 0x0008, own: { compressed: 0, unpacked: 0 } }]);
        expect(zipHeadersAgree(bytes)).toBe(true);
        const zip = new JSZip();
        zip.file("a.txt", "hello".repeat(100));
        const streamed = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", streamFiles: true });
        await expect(assertUnpackedWithin(streamed, 5000)).resolves.toBeUndefined();
    });

    it("refuses a list that points at something that is not a file's header", async () => {
        const bytes = rawZip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]).slice(0);
        new DataView(bytes).setUint32(0, 0, true);
        expect(zipHeadersAgree(bytes)).toBe(false);
    });

    it("refuses bytes that are not a zip", async () => {
        await expect(
            assertUnpackedWithin(new TextEncoder().encode("hello").buffer as ArrayBuffer, 10)
        ).rejects.toThrow();
    });
});
