import { VOICE_NOTE_BARS, waveformOf } from "./VoiceNote";

/** A file bigger than this is not read for its shape: it is a long recording or a song, not a message. */
const MAX_SHAPE_BYTES = 10 * 1024 * 1024;
const CACHE_LIMIT = 100;

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
 * Resolves undefined when the file is too big or the browser cannot decode it: the bubble then shows a flat shape.
 */
export function readAudioShape(url: string): Promise<AudioShape | undefined> {
    const known = cache.get(url);
    if (known) return known;
    const shape = queue.then(() => decode(url)).catch(() => undefined);
    queue = shape;
    cache.set(url, shape);
    if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    return shape;
}

async function decode(url: string): Promise<AudioShape | undefined> {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const size = Number(response.headers.get("content-length"));
    if (Number.isFinite(size) && size > MAX_SHAPE_BYTES) {
        await response.body?.cancel();
        return undefined;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_SHAPE_BYTES) return undefined;
    decoder ??= new OfflineAudioContext(1, 1, 44100);
    const decoded = await decoder.decodeAudioData(bytes);
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
