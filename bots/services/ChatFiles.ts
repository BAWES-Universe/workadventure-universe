/**
 * Files in bot chats (#1508): what the bot server tells Orbit about a file someone sent, and the one-line note that
 * stands for it in the chat's history. Orbit keeps the list (its /api/bot-files routes); the bot finds files again by
 * their short id (f1, f2…), which is the bot's own count, so two people in one bubble never share one.
 */
import type { ParsedFile } from './FileParser';

export type FileKind = 'image' | 'audio' | 'video' | 'document' | 'other';

/** Where a file can be opened again: the uploader's bucket and id behind a signed link, or a link that lasts. */
export type FileStore = { bucket: string; fileId: string } | { url: string };

/** A file someone sent in a chat, as the uploader put it. */
export interface ChatUpload {
    /** The uploader's location for it. */
    url: string;
    /** The name it was sent with. */
    name: string;
    mimeType?: string | null;
    mediaType?: string | null;
    sizeBytes?: number | null;
    lengthSeconds?: number | null;
}

// As the uploader names a file it keeps: a UUID, with the file's extension (up to 16 characters)
const UPLOADER_FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/i;
const BUCKET = /^[a-z0-9][a-z0-9.\-_]{1,62}$/i;

/**
 * Where to keep a file so it still opens next week. A signed link expires, so it is kept as the bucket and id behind
 * it (the last two parts of its path, as nearby chat keeps them). Any other link, the uploader's own /upload-file link
 * or a public one, lasts and is kept as it is.
 */
export function storeOf(location: string): FileStore {
    let parsed: URL;
    try {
        parsed = new URL(location);
    } catch {
        return { url: location };
    }
    if (!parsed.searchParams.has('X-Amz-Signature') && !parsed.searchParams.has('Signature')) return { url: location };
    const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
    const bucket = segments.at(-2);
    let fileId: string | undefined;
    try {
        fileId = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;
    } catch {
        fileId = undefined;
    }
    // A signed link that isn't the uploader's is kept as it is, and Orbit turns it down: it would stop working
    if (!bucket || !fileId || !BUCKET.test(bucket) || !UPLOADER_FILE_ID.test(fileId)) return { url: location };
    return { bucket, fileId };
}

const DOCUMENT_MIME = /^(text\/|application\/(pdf|msword|rtf|json|xml|csv|vnd\.openxmlformats-officedocument|vnd\.ms-|vnd\.oasis\.opendocument))/i;
const DOCUMENT_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|md|csv|json|xml|html?)$/i;

export function kindOf(file: Pick<ChatUpload, 'name' | 'mimeType' | 'mediaType'>): FileKind {
    const mime = (file.mimeType ?? '').toLowerCase();
    if (file.mediaType === 'image' || mime.startsWith('image/')) return 'image';
    if (file.mediaType === 'audio' || mime.startsWith('audio/')) return 'audio';
    if (file.mediaType === 'video' || mime.startsWith('video/')) return 'video';
    if (DOCUMENT_MIME.test(mime) || DOCUMENT_EXTENSION.test(file.name)) return 'document';
    return 'other';
}

/** The file's type in the note: its extension ("PDF") when it has a short one, else its kind. */
function typeWord(name: string, kind: FileKind): string {
    const extension = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
    return extension ? extension.toUpperCase() : kind;
}

function clockOf(seconds: number): string {
    const whole = Math.round(seconds);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = String(whole % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A name in the note: one line, with no quote or bracket that would end the note early. */
function noteName(name: string): string {
    const line = name.replace(/[\s\u0000-\u001F\u007F]+/g, ' ').replace(/["[\]]/g, "'").trim() || 'file';
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export interface NotedFile {
    /** The short id, once Orbit has given one. */
    ref?: string | null;
    name: string;
    kind: FileKind;
    pages?: number | null;
    lengthSeconds?: number | null;
}

/**
 * The note that stands for a file in the chat's history, in place of "[sent a file]":
 * `[file f3 · "plan.pdf" · PDF · 41 pages]`. Before Orbit gave the id it reads `[file · "plan.pdf" · PDF]`.
 */
export function fileNote(file: NotedFile): string {
    const parts = [file.ref ? `file ${file.ref}` : 'file', `"${noteName(file.name)}"`, typeWord(file.name, file.kind)];
    if (file.pages) parts.push(`${file.pages} ${file.pages === 1 ? 'page' : 'pages'}`);
    if (file.lengthSeconds) parts.push(clockOf(file.lengthSeconds));
    return `[${parts.join(' · ')}]`;
}

const NOTE_ID = /\[file f\d+ · /g;

/** A history line with its notes' ids taken out, so a message sent again reads the same before and after its id came. */
export function withoutNoteIds(text: string): string {
    return text.replace(NOTE_ID, '[file · ');
}

// A whole line that is a file's note: a name never holds a bracket or a line break (noteName)
const NOTE_LINE = /^\[file(?: f\d+)? · [^\]\n]*\]$\n?/gm;

/** What the person wrote, without the notes for their files: a file's name is not something they said. */
export function withoutFileNotes(text: string): string {
    return text.replace(NOTE_LINE, '').trim();
}

/** The message as the history keeps it: what they wrote, then a note for each file. */
export function withFileNotes(text: string, notes: string[]): string {
    return [text.trim(), ...notes].filter(Boolean).join('\n');
}

// The lines FileParser gives when there was nothing to read, never the file's own text
const NOT_TEXT = /^\[(Failed to |Couldn't read |[^\]\n]{0,60} — no extractable |Web page[^\]\n]{0,200}— )/;

/** The text FileParser read from a file, or null when it read none (an image, a song, a failure). */
export function keptTextOf(parsed: ParsedFile | null | undefined): string | null {
    if (!parsed || (parsed.type !== 'text' && parsed.type !== 'document')) return null;
    const text = parsed.text ?? '';
    if (!text.trim() || (text.length < 500 && NOT_TEXT.test(text.trim()))) return null;
    return text;
}

/** Orbit takes a file's text in pieces of up to this many characters, so one request stays a few MB. */
export const TEXT_PIECE_CHARS = 1_000_000;

/** A text cut into pieces Orbit takes in order, none ending in half an emoji. */
export function piecesOf(text: string, size = TEXT_PIECE_CHARS): { from: number; text: string; last: boolean }[] {
    const pieces: { from: number; text: string; last: boolean }[] = [];
    let from = 0;
    while (from < text.length || pieces.length === 0) {
        let end = Math.min(from + size, text.length);
        // Never end a piece on the first half of an emoji
        if (end < text.length && end > from + 1 && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
        pieces.push({ from, text: text.slice(from, end), last: end >= text.length });
        from = end;
    }
    return pieces;
}
