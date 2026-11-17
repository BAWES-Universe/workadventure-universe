/**
 * What the Brick for guests reads files and hears notes with (plan v3 section 5), put together from the bot server's own parts:
 * upload receipts (who uploaded which bytes), the uploader's own path for a file, the reading every bot does, and the voice note
 * turns at Orbit. Kept apart from GuestBrickService, which is tested with plain stand-ins.
 */
import type { AdminApiService } from './AdminApiService';
import type { BotManager } from './BotManager';
import { DmReplyService } from './DmReplyService';
import { GUEST_FILE_BYTES_MAX, type GuestBrickMedia, type GuestUpload } from './GuestBrickService';
import { checkReceipt, readReceiptFile } from './UploadReceipts';
import { FileParser } from '../services/FileParser';
import { uploadAttachment } from '../matrix/uploadAttachment';
import { storeOf } from '../services/ChatFiles';
import type { CarriedMedia, GuestChatNote } from '../matrix/MatrixDmBridge';
import { sharedNoteHearing } from '../voice/NoteHearingWiring';

/**
 * A guest's upload by its receipt: only the guest it names, read through the uploader, and only while it is what was uploaded.
 * `expiredOk` is for a carry only: Orbit has handed that guest's chat to the person asking, so a receipt past its day still names
 * the guest's own file, and the file's hash still has to match. Whether the file is still kept is the uploader's to say.
 */
export async function readGuestUpload(
    guestId: string,
    receipt: unknown,
    secret: string,
    uploaderUrl: string,
    fetchBytes: (url: string, maxBytes: number) => Promise<ArrayBuffer | Uint8Array> = (url, maxBytes) => FileParser.fetchBytes(url, maxBytes),
    now: number = Date.now(),
    expiredOk = false
): Promise<GuestUpload> {
    const check = checkReceipt(receipt, secret, guestId, ['guest-brick', 'chat-file', 'chat-note'], expiredOk ? -Infinity : now);
    if ('reason' in check) return { ok: false, why: check.reason === 'expired' ? 'expired' : 'refused' };
    const file = await readReceiptFile(check.claims, uploaderUrl, GUEST_FILE_BYTES_MAX, fetchBytes);
    if ('reason' in file) return { ok: false, why: file.reason === 'too-big' ? 'too-big' : file.reason === 'not-now' ? 'not-now' : 'refused' };
    const { claims } = check;
    return { ok: true, bytes: file.bytes, url: claims.loc, type: claims.type, name: claims.name, sha256: claims.sha256 };
}

/** Null where guests can't send files: no key to check receipts with, or no uploader to read them from. */
export function buildGuestBrickMedia(botManager: BotManager, admin: AdminApiService, env: NodeJS.ProcessEnv = process.env): GuestBrickMedia | null {
    const secret = env.SECRET_KEY;
    const uploaderUrl = env.UPLOADER_URL;
    if (!secret || !uploaderUrl || !/^https?:\/\//.test(uploaderUrl)) return null;
    let reader: DmReplyService | undefined;
    return {
        secret,
        notes: sharedNoteHearing(admin, env)?.guest ?? null,
        readUpload: (guestId, receipt) => readGuestUpload(guestId, receipt, secret, uploaderUrl),
        readFiles: (text, files, readChars) => (reader ??= new DmReplyService(botManager)).readCheckedFiles(text, files, readChars),
    };
}

/** The most bytes one carried chat copies. */
export const CARRIED_COPY_BYTES_MAX = 60 * 1024 * 1024;
const COPIES_KEPT_MS = 60 * 60 * 1000;
const COPIES_MAX = 2000;
/** Copies made for a hand-over, by guest and file, so a carry asked again (its chat was not there yet) never copies twice. */
const copies = new Map<string, { at: number; url: string }>();
/** `over`: the file was not copied because it was bigger than the budget left for the carry that started the copy (its size). */
type Copied = { ok: true; url: string; type: string; size: number } | { ok: false; over?: number };
/** Copies being made right now, by the same key: a carry asked again while the first is still copying waits for it instead of copying a second time. */
const copying = new Map<string, Promise<Copied>>();

/** Orbit or the storage could not be asked just now: nothing of this part is said, and the device asks again later. */
export class CarryNotNowError extends Error {}

export interface CarryCopy {
    /** Whether Orbit handed this guest's chat to the person who asks. */
    handed: () => Promise<boolean>;
    /** A guest's upload by its receipt (the guest's own only). */
    read: (receipt: string) => Promise<GuestUpload>;
    /** Keeps a copy in the person's own storage; its lasting link, or null. */
    store: (bytes: Uint8Array, type: string, name: string) => Promise<string | null>;
    now?: () => number;
}

/**
 * Brings a guest's pictures, files and notes into the account that signed in as them (plan v3 section 7): only when Orbit handed
 * that guest's chat to this person, each read by the guest's own receipt and copied into the person's own storage, never by
 * reusing the guest's receipt. A file that is gone, changed or past what one part copies keeps its line, words and bubble as
 * gone. No receipt is left in what comes back. Carrying never hears, never runs the model and never charges.
 */
export async function copyCarriedMedia(guestId: string, lines: GuestChatNote[], copy: CarryCopy): Promise<GuestChatNote[]> {
    if (!lines.some((line) => line.media?.length)) return lines;
    const now = (copy.now ?? Date.now)();
    for (const [key, entry] of copies) {
        if (now - entry.at > COPIES_KEPT_MS || copies.size > COPIES_MAX) copies.delete(key);
        else break;
    }
    // Only a real "no" marks the files gone: a hand-over that can't be checked now is asked again, never taken as a no
    const handed = await copy.handed().catch((error: unknown) => {
        throw new CarryNotNowError(`Could not check the hand-over: ${error instanceof Error ? error.message : String(error)}`);
    });
    let bytes = 0;
    const out: GuestChatNote[] = [];
    for (const line of lines) {
        if (!line.media?.length) {
            out.push(line);
            continue;
        }
        const media: CarriedMedia[] = [];
        for (const one of line.media) {
            const { receipt, ...shown } = one;
            const gone = (): CarriedMedia => ({ ...shown, gone: true });
            if (!handed || !receipt) {
                media.push(gone());
                continue;
            }
            const key = `${guestId}|${receipt}`;
            const known = copies.get(key);
            if (known) {
                media.push({ ...shown, url: known.url });
                continue;
            }
            const left = CARRIED_COPY_BYTES_MAX - bytes;
            let made = await copyOnce(key, receipt, left, now, copy);
            // A copy that a carry with less budget started and refused for its size is not a "no" for this one: it asks for its own
            if (!made.ok && made.over !== undefined && made.over <= left) made = await copyOnce(key, receipt, left, now, copy);
            if (!made.ok || made.size > left) {
                media.push(gone());
                continue;
            }
            bytes += made.size;
            media.push({ ...shown, type: made.type, url: made.url });
        }
        out.push({ ...line, media });
    }
    return out;
}

/** One copy of a file by its key, shared by every carry that asks while it is being made. The budget is the asker's who started it. */
function copyOnce(key: string, receipt: string, left: number, now: number, copy: CarryCopy): Promise<Copied> {
    const running = copying.get(key);
    if (running) return running;
    const work = (async (): Promise<Copied> => {
        const upload = await copy.read(receipt);
        // The uploader couldn't be asked just now: nothing of this part is said, and the device asks again later
        if ('why' in upload && upload.why === 'not-now') throw new CarryNotNowError('Could not read a file just now');
        if (!upload.ok) return { ok: false };
        if (upload.bytes.byteLength > left) return { ok: false, over: upload.bytes.byteLength };
        // Storage that fails now fails the part, which the device asks again; a copy made is remembered, so it is made once
        const url = await copy.store(upload.bytes, upload.type, upload.name).catch((error: unknown) => {
            throw new CarryNotNowError(`Could not copy a file: ${error instanceof Error ? error.message : String(error)}`);
        });
        if (!url) return { ok: false };
        copies.set(key, { at: now, url });
        return { ok: true, url, type: upload.type, size: upload.bytes.byteLength };
    })().finally(() => copying.delete(key));
    copying.set(key, work);
    return work;
}

/** The copy steps of this server: Orbit's hand-over, the guest's receipt, the uploader as the bot server. Null when guests can't send files. */
export function buildCarryCopy(admin: AdminApiService, guestId: string, userUuid: string, env: NodeJS.ProcessEnv = process.env): CarryCopy | null {
    const secret = env.SECRET_KEY;
    const uploaderUrl = env.UPLOADER_URL;
    if (!secret || !uploaderUrl || !/^https?:\/\//.test(uploaderUrl)) return null;
    return {
        handed: () => admin.guestChatHandedTo(guestId, userUuid),
        read: (receipt) => readGuestUpload(guestId, receipt, secret, uploaderUrl, undefined, undefined, true),
        store: async (bytes, type, name) => {
            const location = await uploadAttachment(Buffer.from(bytes), type, name);
            return location ? lastingLinkOf(location, uploaderUrl) : null;
        },
    };
}

/**
 * Where a copy in the person's storage can be opened next week. The uploader answers with a signed link when the bucket has no public
 * one, and a signed link runs out: it is kept as the uploader's own lasting `/chat-file/<bucket>/<id>` link, which sends on to a fresh one.
 */
export function lastingLinkOf(location: string, uploaderUrl: string): string {
    const store = storeOf(location);
    if (!('bucket' in store)) return location;
    return `${uploaderUrl.replace(/\/+$/, '')}/chat-file/${encodeURIComponent(store.bucket)}/${encodeURIComponent(store.fileId)}`;
}
