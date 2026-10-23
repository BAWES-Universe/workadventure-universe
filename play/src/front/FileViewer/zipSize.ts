/** Anything over this is a zip meant to fill memory, not a document: offered as a download instead. */
export const MAX_UNPACKED_BYTES = 150 * 1024 * 1024;

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const NOT_IN_THIS_FIELD = 0xffffffff;

/**
 * The size of everything inside a zip file (.docx, .xlsx, .ods once unpacked), read from the list of files the zip
 * keeps at its end, without unpacking anything. A reader that unpacks a file lets this list's sizes stand: it stops
 * when the real data does not match them. Returns Infinity for a zip it cannot size (a very large or odd one), and
 * undefined when the bytes are not a zip.
 */
export function zipUnpackedSize(bytes: ArrayBuffer): number | undefined {
    const view = new DataView(bytes);
    // The end-of-list record sits in the last 64 KB, behind an optional comment.
    let end = -1;
    for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === END_OF_DIRECTORY) {
            end = at;
            break;
        }
    }
    if (end < 0) return undefined;
    const entries = view.getUint16(end + 10, true);
    const directoryOffset = view.getUint32(end + 16, true);
    if (entries === 0xffff || directoryOffset === NOT_IN_THIS_FIELD) return Infinity;

    let total = 0;
    let at = directoryOffset;
    for (let entry = 0; entry < entries; entry++) {
        if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== DIRECTORY_ENTRY) return Infinity;
        const size = view.getUint32(at + 24, true);
        if (size === NOT_IN_THIS_FIELD) return Infinity;
        total += size;
        at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return total;
}

/**
 * Whether the zip's list marks a file that holds data as a folder, by its name or by its attributes. JSZip trusts that
 * mark and drops the file's data, so counting through JSZip would miss it, while a reader that unpacks by name (the
 * spreadsheet reader does) would still inflate it. A real folder is empty, so no real document does this.
 */
export function zipHasFolderWithData(bytes: ArrayBuffer): boolean {
    const view = new DataView(bytes);
    let end = -1;
    for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === END_OF_DIRECTORY) {
            end = at;
            break;
        }
    }
    if (end < 0) return false;
    const entries = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    for (let entry = 0; entry < entries; entry++) {
        if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== DIRECTORY_ENTRY) return false;
        const nameLength = view.getUint16(at + 28, true);
        const attributes = view.getUint32(at + 38, true);
        const madeByUnix = view.getUint16(at + 4, true) >> 8 === 3;
        const folder =
            (nameLength > 0 && view.getUint8(at + 46 + nameLength - 1) === 0x2f) ||
            (attributes & 0x10) !== 0 ||
            (madeByUnix && ((attributes >>> 16) & 0x4000) !== 0);
        if (folder && (view.getUint32(at + 20, true) > 0 || view.getUint32(at + 24, true) > 0)) return true;
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return false;
}

/** The part of JSZip's stream of a file that is used here: its types leave it out, though the library ships it. */
interface UnpackStream {
    on(event: "data", listener: (chunk: Uint8Array) => void): UnpackStream;
    on(event: "error", listener: (error: Error) => void): UnpackStream;
    on(event: "end", listener: () => void): UnpackStream;
    pause(): UnpackStream;
    resume(): UnpackStream;
}

/**
 * Unpacks every file inside a zip only to count the bytes that really come out, and stops the moment they pass
 * `limit`. The sizes in the zip's own list are written by whoever made the file, so a zip bomb can claim a few
 * bytes over gigabytes: this is the count that cannot be argued with. Nothing is kept. Throws when the zip holds
 * more than `limit`, or cannot be read.
 */
export async function assertUnpackedWithin(bytes: ArrayBuffer, limit: number): Promise<void> {
    if (zipHasFolderWithData(bytes)) throw new Error("The file cannot be read");
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    let total = 0;
    // Every file is counted into the same total, so the files together are held to the limit. Once it is passed,
    // each file that is still being unpacked stops at its next piece.
    await Promise.all(
        Object.values(zip.files)
            .filter((entry) => !entry.dir)
            .map(
                (entry) =>
                    new Promise<void>((resolve, reject) => {
                        const stream = (
                            entry as unknown as { internalStream(type: "uint8array"): UnpackStream }
                        ).internalStream("uint8array");
                        /* eslint-disable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */
                        stream
                            .on("data", (chunk: Uint8Array) => {
                                total += chunk.length;
                                if (total <= limit) return;
                                stream.pause();
                                reject(new Error("The file is too big to show"));
                            })
                            .on("error", reject)
                            .on("end", () => resolve())
                            .resume();
                        /* eslint-enable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */
                    })
            )
    );
}
