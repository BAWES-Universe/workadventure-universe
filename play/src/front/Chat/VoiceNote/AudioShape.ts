import { VOICE_NOTE_BARS, waveformOf } from "./VoiceNote";

/** A file bigger than this is not read for its shape: it is a long recording or a song, not a message. */
const MAX_SHAPE_BYTES = 10 * 1024 * 1024;
const CACHE_LIMIT = 100;
/** A stalled download gives up after this long, so it cannot hold up the notes queued behind it. */
const FETCH_TIMEOUT_MS = 20_000;

export interface AudioShape {
    /** Seconds. */
    duration: number;
    /** One 0 to 1 level per bar. */
    levels: number[];
}

let decoder: OfflineAudioContext | undefined;
// One file is decoded at a time: a chat full of notes would otherwise open them all at once.
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<AudioShape | undefined>>();

/**
 * The length and shape of an audio file that carries neither (a note from the nearby chat, or an audio file).
 * Resolves undefined when the file is too big, the browser cannot decode it, or it could not be fetched: the bubble
 * then shows a flat shape. Only the last is not remembered, so the next time the note is shown it is tried again.
 */
export function readAudioShape(url: string): Promise<AudioShape | undefined> {
    const known = cache.get(url);
    if (known) return known;
    const shape: Promise<AudioShape | undefined> = queue
        .then(() => decode(url))
        .catch(() => {
            if (cache.get(url) === shape) cache.delete(url);
            return undefined;
        });
    queue = shape;
    cache.set(url, shape);
    if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    return shape;
}

/**
 * The body of a response, or undefined once it passes the limit. The size header is only a hint (a chunked or
 * compressed answer has none), so the bytes are counted as they arrive and the download stops at the limit.
 */
async function readCapped(response: Response): Promise<ArrayBuffer | undefined> {
    const header = response.headers.get("content-length");
    if (header !== null && Number(header) > MAX_SHAPE_BYTES) {
        await response.body?.cancel();
        return undefined;
    }
    if (!response.body) {
        const bytes = await response.arrayBuffer();
        return bytes.byteLength > MAX_SHAPE_BYTES ? undefined : bytes;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        // A stream is read one chunk after another.
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_SHAPE_BYTES) {
            // eslint-disable-next-line no-await-in-loop
            await reader.cancel();
            return undefined;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return all.buffer;
}

/** Throws when the file could not be fetched in time: that may pass, unlike a file the browser cannot decode. */
async function fetchCapped(url: string): Promise<ArrayBuffer | undefined> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`Audio answered ${response.status}`);
        return await readCapped(response);
    } finally {
        clearTimeout(timeout);
    }
}

async function decode(url: string): Promise<AudioShape | undefined> {
    const bytes = await fetchCapped(url);
    if (!bytes) return undefined;
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    let decoded: AudioBuffer;
    try {
        decoded = await decoder.decodeAudioData(bytes);
    } catch (error) {
        console.warn("The browser could not read the shape of an audio file", error);
        return undefined;
    }
    // Peaks per bar over the first channel: enough for a shape, and far lighter than mixing every channel.
    const samples = decoded.getChannelData(0);
    const slice = Math.max(1, Math.floor(samples.length / VOICE_NOTE_BARS));
    const peaks: number[] = [];
    for (let bar = 0; bar < VOICE_NOTE_BARS; bar++) {
        let peak = 0;
        const end = Math.min(samples.length, (bar + 1) * slice);
        for (let i = bar * slice; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
        peaks.push(peak);
    }
    return { duration: decoded.duration, levels: waveformOf(peaks, VOICE_NOTE_BARS) };
}
