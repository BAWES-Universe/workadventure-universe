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
