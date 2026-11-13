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
import type { CarriedMedia, GuestChatNote } from '../matrix/MatrixDmBridge';
import { sharedNoteHearing } from '../voice/NoteHearingWiring';

/** A guest's upload by its receipt: only the guest it names, read through the uploader, and only while it is what was uploaded. */
export async function readGuestUpload(
    guestId: string,
    receipt: unknown,
    secret: string,
    uploaderUrl: string,
    fetchBytes: (url: string, maxBytes: number) => Promise<ArrayBuffer | Uint8Array> = (url, maxBytes) => FileParser.fetchBytes(url, maxBytes),
    now: number = Date.now()
): Promise<GuestUpload> {
    const check = checkReceipt(receipt, secret, guestId, ['guest-brick', 'chat-file', 'chat-note'], now);
    if ('reason' in check) return { ok: false, why: check.reason === 'expired' ? 'expired' : 'refused' };
    const file = await readReceiptFile(check.claims, uploaderUrl, GUEST_FILE_BYTES_MAX, fetchBytes);
    if ('reason' in file) return { ok: false, why: file.reason === 'too-big' ? 'too-big' : 'refused' };
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
const copies = new Map<string, { at: number; url: string | null }>();

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
 * reusing the guest's receipt. A file that is gone, changed or past what one chat copies keeps its line, words and bubble as
 * gone. No receipt is left in what comes back. Carrying never hears, never runs the model and never charges.
 */
export async function copyCarriedMedia(guestId: string, lines: GuestChatNote[], copy: CarryCopy): Promise<GuestChatNote[]> {
    if (!lines.some((line) => line.media?.length)) return lines;
    const now = (copy.now ?? Date.now)();
    for (const [key, entry] of copies) {
        if (now - entry.at > COPIES_KEPT_MS || copies.size > COPIES_MAX) copies.delete(key);
        else break;
    }
    const handed = await copy.handed().catch(() => false);
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
                media.push(known.url ? { ...shown, url: known.url } : gone());
                continue;
            }
            const upload = await copy.read(receipt);
            if (!upload.ok || bytes + upload.bytes.byteLength > CARRIED_COPY_BYTES_MAX) {
                media.push(gone());
                continue;
            }
            bytes += upload.bytes.byteLength;
            const url = await copy.store(upload.bytes, upload.type, upload.name).catch(() => null);
            copies.set(key, { at: now, url });
            media.push(url ? { ...shown, type: upload.type, url } : gone());
        }
        out.push({ ...line, media });
    }
    return out;
}

/** The copy steps of this server: Orbit's hand-over, the guest's receipt, the uploader as the bot server. Null when guests can't send files. */
export function buildCarryCopy(admin: AdminApiService, guestId: string, userUuid: string, env: NodeJS.ProcessEnv = process.env): CarryCopy | null {
    const secret = env.SECRET_KEY;
    const uploaderUrl = env.UPLOADER_URL;
    if (!secret || !uploaderUrl || !/^https?:\/\//.test(uploaderUrl)) return null;
    return {
        handed: () => admin.guestChatHandedTo(guestId, userUuid),
        read: (receipt) => readGuestUpload(guestId, receipt, secret, uploaderUrl),
        store: (bytes, type, name) => uploadAttachment(Buffer.from(bytes), type, name),
    };
}
