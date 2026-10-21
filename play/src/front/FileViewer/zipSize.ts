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
