/** Anything over this is a zip meant to fill memory, not a document: offered as a download instead. */
export const MAX_UNPACKED_BYTES = 150 * 1024 * 1024;

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
/** The extra field that carries 64-bit sizes, which the spreadsheet reader lets override the 32-bit ones. */
const ZIP64_FIELD = 0x0001;
const HAS_DATA_DESCRIPTOR = 0x0008;
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

/** An empty file or folder can still carry a few bytes of compressed stream (an empty deflate stream is 2). */
const EMPTY_STREAM_BYTES = 16;

/**
 * How many entries in the zip's own list hold data, whatever they are named or marked as. JSZip may read an entry as a
 * folder from its attributes or from an extra name field and then drop its data, while a reader that unpacks by name
 * (the spreadsheet reader does) would still inflate it; comparing this count with what JSZip kept catches any such
 * entry without having to guess how it was disguised. Returns undefined when the list cannot be read.
 */
export function zipDataEntryCount(bytes: ArrayBuffer): number | undefined {
    const view = new DataView(bytes);
    let end = -1;
    for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === END_OF_DIRECTORY) {
            end = at;
            break;
        }
    }
    if (end < 0) return undefined;
    const entries = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    let listed = 0;
    let count = 0;
    // JSZip reads every record it finds in a row, whatever number the end record gives, so this does too, and a list
    // whose records and number disagree (no real zip has one) is refused.
    while (at + 46 <= end && view.getUint32(at, true) === DIRECTORY_ENTRY) {
        listed++;
        if (view.getUint32(at + 20, true) > EMPTY_STREAM_BYTES || view.getUint32(at + 24, true) > 0) count++;
        at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    if (listed !== entries) return undefined;
    return count;
}

/** Whether the extra fields of a header (a run of id, length, data) include `id`. Fields that run past `end` count as present. */
function hasExtraField(view: DataView, from: number, length: number, end: number, id: number): boolean {
    if (from + length > end) return true;
    for (let at = from; at + 4 <= from + length; at += 4 + view.getUint16(at + 2, true)) {
        if (view.getUint16(at, true) === id) return true;
    }
    return false;
}

/**
 * Whether every file's own header, in front of its data, agrees with the zip's list at the end. JSZip believes the
 * list; the spreadsheet reader believes each file's own header and unpacks as many bytes as that says. A file that
 * is empty in the list but holds a big stream in its own header is invisible to every count made from the list, so
 * the two must say the same thing. A file written with a data descriptor leaves the sizes in its own header at
 * zero, which is fine. 64-bit size fields are refused: no document of the size shown here needs them, and the
 * spreadsheet reader lets them override the sizes above.
 */
export function zipHeadersAgree(bytes: ArrayBuffer): boolean {
    const view = new DataView(bytes);
    let end = -1;
    for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === END_OF_DIRECTORY) {
            end = at;
            break;
        }
    }
    if (end < 0) return false;
    let at = view.getUint32(end + 16, true);
    while (at + 46 <= end && view.getUint32(at, true) === DIRECTORY_ENTRY) {
        const local = view.getUint32(at + 42, true);
        if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== LOCAL_HEADER) return false;
        const described = (view.getUint16(local + 6, true) & HAS_DATA_DESCRIPTOR) !== 0;
        for (const size of [20, 24]) {
            const listed = view.getUint32(at + size, true);
            const own = view.getUint32(local + size - 2, true);
            if (own !== listed && !(described && own === 0)) return false;
        }
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const ownExtraAt = local + 30 + view.getUint16(local + 26, true);
        if (
            hasExtraField(view, at + 46 + nameLength, extraLength, bytes.byteLength, ZIP64_FIELD) ||
            hasExtraField(view, ownExtraAt, view.getUint16(local + 28, true), bytes.byteLength, ZIP64_FIELD)
        ) {
            return false;
        }
        at += 46 + nameLength + extraLength + view.getUint16(at + 32, true);
    }
    return true;
}

/** What JSZip keeps of an entry it read from the list (private, but stable in the pinned version and covered by the tests). */
interface KeptEntry {
    dir: boolean;
    _data?: { compressedSize?: number; uncompressedSize?: number };
}

/** JSZip keeps a file that has data as an object that knows its sizes, and an empty file as a bare placeholder. */
function holdsData(entry: KeptEntry): boolean {
    const compressed = entry._data?.compressedSize;
    return (
        !entry.dir &&
        typeof compressed === "number" &&
        (compressed > EMPTY_STREAM_BYTES || !!entry._data?.uncompressedSize)
    );
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
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    if (!zipHeadersAgree(bytes)) throw new Error("The file cannot be read");
    // Every entry in the zip's list that holds data must have survived as a file here, or it is being hidden from the count.
    const listed = zipDataEntryCount(bytes);
    if (
        listed === undefined ||
        listed !== Object.values(zip.files).filter((entry) => holdsData(entry as unknown as KeptEntry)).length
    ) {
        throw new Error("The file cannot be read");
    }
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
