/**
 * Songs, images and videos inside artifacts (#1510). A bot can put the media of this turn into a page it makes: what
 * the person sent with the message it is answering, and what its tools made or found in this reply. Each one gets a
 * short name for the turn ("m1"), so the model never needs, or sees, where it is stored; the bot server fetches it and
 * Orbit keeps its own copy beside the page, served from the artifacts address, so a shared link plays it too.
 *
 * Only this turn's media: nothing from another person or another chat can go in, because the list starts empty every
 * turn and is filled from this person's message and this reply's tool results.
 */
import { FileParser } from '../services/FileParser';

export type MediaKind = 'audio' | 'image' | 'video' | 'file';

/** One song, image or video of this turn. */
export interface TurnMedia {
    /** "m1", "m2": what the model calls it. */
    ref: string;
    url: string;
    kind: MediaKind;
    /** The person sent it, or a tool made or found it. */
    by: 'person' | 'tool';
}

const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

function extensionOf(url: string): string {
    try {
        return new URL(url).pathname.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? '';
    } catch {
        return '';
    }
}

export function mediaKindOf(url: string, hint?: string): MediaKind {
    if (hint === 'audio' || hint === 'image' || hint === 'video') return hint;
    const ext = extensionOf(url);
    if (AUDIO.has(ext)) return 'audio';
    if (IMAGE.has(ext)) return 'image';
    if (VIDEO.has(ext)) return 'video';
    return 'file';
}

/**
 * The lines an attachment leaves in the message the model reads ("[User also sent an image: <url>]", "[User sent an
 * audio file: <url>]"). Only these count as sent by the person: an address they typed in their words is not a file.
 */
const ATTACHMENT_LINE = /\[User (?:also )?sent an? (image|audio file|video file|file)[^\]\n]*?: (https?:\/\/[^\s\]]+)/g;

function kindOfLine(word: string): string | undefined {
    return word === 'image' ? 'image' : word === 'audio file' ? 'audio' : word === 'video file' ? 'video' : undefined;
}

/** Adds media to the turn's list (each address once) and says which entries are new. */
export function addTurnMedia(list: TurnMedia[], items: Array<{ url: string; kind?: string }>, by: TurnMedia['by']): TurnMedia[] {
    const added: TurnMedia[] = [];
    for (const item of items) {
        if (!/^https?:\/\//i.test(item.url) || list.some((entry) => entry.url === item.url)) continue;
        const entry: TurnMedia = { ref: `m${list.length + 1}`, url: item.url, kind: mediaKindOf(item.url, item.kind), by };
        list.push(entry);
        added.push(entry);
    }
    return added;
}

/** The turn's list at its start: the files in the message being answered, and the images sent for the model to see. */
export function startTurnMedia(message: string, images: string[] = []): TurnMedia[] {
    const list: TurnMedia[] = [];
    const found: Array<{ url: string; kind?: string }> = [];
    for (const match of message.matchAll(ATTACHMENT_LINE)) found.push({ url: match[2], kind: kindOfLine(match[1]) });
    for (const url of images) found.push({ url, kind: 'image' });
    addTurnMedia(list, found, 'person');
    return list;
}

const KIND_WORD: Record<MediaKind, string> = { audio: 'song or sound', image: 'image', video: 'video', file: 'file' };

/** "m1 (song or sound, they sent it), m2 (image, from your tools)": what the model is told it can put in. */
export function describeTurnMedia(entries: TurnMedia[]): string {
    return entries.map((entry) => `${entry.ref} (${KIND_WORD[entry.kind]}, ${entry.by === 'person' ? 'they sent it' : 'from your tools'})`).join(', ');
}

/** The line that tells the model what it can put in an artifact. Empty when there is nothing. */
export function turnMediaNotice(entries: TurnMedia[]): string {
    if (entries.length === 0) return '';
    return `Media you can put in an artifact this turn: ${describeTurnMedia(entries)}. Pass them in make_artifact or change_artifact "media".`;
}

const TYPE_BY_EXTENSION: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
    weba: 'audio/webm',
    flac: 'audio/flac',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
};

/** The extension a page's media name should end in for a type, so Orbit's name and type check agree. */
const EXTENSION_BY_TYPE: Record<string, string> = Object.fromEntries(
    Object.entries(TYPE_BY_EXTENSION).reverse().map(([ext, type]) => [type, ext])
);

export class MediaFetchError extends Error {
    constructor(public readonly code: 'too_large' | 'unreachable', message: string) {
        super(message);
    }
}

export interface FetchedMedia {
    contentType: string;
    body: Uint8Array;
}

/**
 * Downloads one media file behind the same guard the file reader uses: every address and redirect is checked, so a
 * tool's result cannot point the bot server at its own network. Stops past `maxBytes` (the media still allowed in this
 * version) and after `timeoutMs`.
 */
export async function fetchMedia(url: string, maxBytes: number, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<FetchedMedia> {
    let current = url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        for (let hop = 0; hop < 5; hop++) {
            await FileParser.validateUrl(current);
            const response = await fetchImpl(current, { redirect: 'manual', signal: controller.signal });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) throw new MediaFetchError('unreachable', 'It moved and left no new address.');
                current = new URL(location, current).href;
                continue;
            }
            if (!response.ok || !response.body) throw new MediaFetchError('unreachable', `It answered ${response.status}.`);
            if (Number(response.headers.get('content-length')) > maxBytes) throw new MediaFetchError('too_large', 'It is too large.');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > maxBytes) {
                    await reader.cancel();
                    throw new MediaFetchError('too_large', 'It is too large.');
                }
                chunks.push(value);
            }
            const body = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                body.set(chunk, offset);
                offset += chunk.byteLength;
            }
            const sent = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
            // A file server that says nothing useful ("application/octet-stream") is read by the file's ending
            const contentType = EXTENSION_BY_TYPE[sent] ? sent : TYPE_BY_EXTENSION[extensionOf(current)] ?? TYPE_BY_EXTENSION[extensionOf(url)] ?? sent;
            return { contentType, body };
        }
        throw new MediaFetchError('unreachable', 'It redirected too many times.');
    } catch (error) {
        if (error instanceof MediaFetchError) throw error;
        throw new MediaFetchError('unreachable', controller.signal.aborted ? 'It took too long to download.' : 'It could not be downloaded.');
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The name a media file goes in under: the one the model picked, with the ending its type needs ("song" as audio/mpeg
 * becomes "song.mp3", "cover.jpeg" stays). Letters, digits, ".", "-" and "_" only, as Orbit asks.
 */
export function mediaFileName(wanted: string, contentType: string): string {
    const extension = EXTENSION_BY_TYPE[contentType];
    let name = wanted.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 90);
    if (!name) name = 'media';
    if (!extension) return name;
    const current = name.match(/\.(\w+)$/)?.[1]?.toLowerCase();
    if (current && TYPE_BY_EXTENSION[current] === contentType) return name;
    return `${name.replace(/\.\w+$/, '')}.${extension}`;
}
