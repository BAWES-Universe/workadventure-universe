/**
 * Voice notes in chat: what a note is called, how its length and shape travel with the file, which recording format a
 * browser can make, and which received notes this device has already played.
 */

/** A note stops here: the recorder ends and waits for Send. */
export const VOICE_NOTE_MAX_SECONDS = 120;
/** The timer turns amber and counts down for this many seconds before the cap. */
export const VOICE_NOTE_WARNING_SECONDS = 10;
/** Bars drawn in a bubble and in the review step. */
export const VOICE_NOTE_BARS = 30;
/** Points of the shape sent to Matrix clients (Element draws up to 100). */
export const VOICE_NOTE_MATRIX_WAVEFORM_POINTS = 100;
/** Element writes the waveform on a 0 to 1024 scale (MSC1767). */
export const VOICE_NOTE_MATRIX_WAVEFORM_MAX = 1024;

/** A quiet bar still shows. */
const FLOOR = 0.08;

/** The body Element gives a voice message, and the name every note of ours is uploaded under (plus its extension). */
export const VOICE_NOTE_NAME = "Voice message";

export interface VoiceNoteDetails {
    /** Seconds. */
    duration: number;
    /** One 0 to 1 level per slice of the recording, the loudest slice at 1. */
    waveform: number[];
}

/** A recorded note that was never sent: the people it was for walked off first. Kept in this tab's memory. */
export interface UnsentVoiceNote {
    file: File;
    details: VoiceNoteDetails;
}

export interface RecordingFormat {
    /** What MediaRecorder is asked for. */
    recorderType: string;
    /** The file's type without codec parameters. */
    fileType: string;
    /** `.oga` and `.weba` rather than `.ogg` and `.webm`: those two are read as video by the nearby chat. */
    extension: string;
}

/**
 * Tried in this order. MP4 (AAC) plays in every browser and in Element X, and Chrome and Safari can make it; Firefox
 * makes Opus in WebM or Ogg, which Chrome, Edge and Firefox play.
 */
const RECORDING_FORMATS: RecordingFormat[] = [
    { recorderType: "audio/mp4", fileType: "audio/mp4", extension: "m4a" },
    { recorderType: "audio/webm;codecs=opus", fileType: "audio/webm", extension: "weba" },
    { recorderType: "audio/ogg;codecs=opus", fileType: "audio/ogg", extension: "oga" },
];

/** The best format this browser records, or undefined when it cannot record audio at all. */
export function pickRecordingFormat(isTypeSupported: (type: string) => boolean): RecordingFormat | undefined {
    return RECORDING_FORMATS.find((format) => isTypeSupported(format.recorderType));
}

export function browserRecordingFormat(): RecordingFormat | undefined {
    if (typeof MediaRecorder === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices) {
        return undefined;
    }
    return pickRecordingFormat((type) => MediaRecorder.isTypeSupported(type));
}

export function voiceNoteFileName(format: RecordingFormat): string {
    return `${VOICE_NOTE_NAME}.${format.extension}`;
}

/**
 * Whether a file name is one of our notes. The nearby chat carries no flag with a file, so its voice notes are told
 * from audio files by this name.
 */
export function isVoiceNoteFileName(name: string | undefined): boolean {
    if (name === undefined) return false;
    return /^voice message\.[a-z0-9]{1,5}$/i.test(name.trim());
}

/** The note's length and shape, kept by file until the room that sends it writes them into the message. */
export const voiceNoteDetails = new WeakMap<File, VoiceNoteDetails>();

/**
 * `levels` cut into `bars` slices, each at its loudest, scaled so the loudest slice is 1 and none is below the floor
 * (a quiet bar still shows).
 */
export function waveformOf(levels: number[], bars: number): number[] {
    if (bars <= 0) return [];
    if (levels.length === 0) return new Array<number>(bars).fill(FLOOR);
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
        const start = Math.floor((i * levels.length) / bars);
        const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / bars));
        let peak = 0;
        for (let j = start; j < end && j < levels.length; j++) peak = Math.max(peak, levels[j]);
        peaks.push(peak);
    }
    const max = Math.max(...peaks, 0.01);
    return peaks.map((peak) => Math.max(FLOOR, peak / max));
}

/**
 * The same shape resampled to `bars` bars, for a bubble that shows fewer or more bars than the note carries. The shape
 * is already scaled, so it is not scaled again: a silent note (every bar at the floor) stays at the floor instead of
 * turning into a row of full bars.
 */
export function resampleWaveform(waveform: number[], bars: number): number[] {
    if (waveform.length === 0 || bars <= 0) return new Array<number>(Math.max(bars, 0)).fill(FLOOR);
    const resampled: number[] = [];
    for (let i = 0; i < bars; i++) {
        const start = Math.floor((i * waveform.length) / bars);
        const end = Math.max(start + 1, Math.floor(((i + 1) * waveform.length) / bars));
        let peak = 0;
        for (let j = start; j < end && j < waveform.length; j++) {
            const level = waveform[j];
            if (Number.isFinite(level)) peak = Math.max(peak, level);
        }
        resampled.push(Math.min(1, Math.max(FLOOR, peak)));
    }
    return resampled;
}

/** The shape as Element reads it: whole numbers from 0 to 1024. */
export function toMatrixWaveform(waveform: number[]): number[] {
    return resampleWaveform(waveform, VOICE_NOTE_MATRIX_WAVEFORM_POINTS).map((level) =>
        Math.round(Math.min(1, Math.max(0, level)) * VOICE_NOTE_MATRIX_WAVEFORM_MAX)
    );
}

/** Element's 0 to 1024 shape back to 0 to 1, or undefined when the event has none that is usable. */
export function fromMatrixWaveform(raw: unknown): number[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const levels = raw.map((value) =>
        typeof value === "number" && Number.isFinite(value)
            ? Math.min(1, Math.max(0, value / VOICE_NOTE_MATRIX_WAVEFORM_MAX))
            : 0
    );
    return waveformOf(levels, Math.min(levels.length, VOICE_NOTE_MATRIX_WAVEFORM_POINTS));
}

/** Seconds from a Matrix event's milliseconds, or undefined when it is not a usable length. */
export function secondsFromMatrixDuration(milliseconds: unknown): number | undefined {
    return typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds > 0
        ? milliseconds / 1000
        : undefined;
}

/** A note's length and shape as the nearby chat sends them: whole milliseconds, and the 0 to 1024 shape Matrix uses. */
export interface VoiceNoteOnWire {
    voiceDurationMs: number;
    voiceWaveform: number[];
}

/**
 * The nearby chat sends the length and shape its sender measured, so nobody has to download and decode the file to
 * draw it (a phone browser may not decode it at all, and the bubble then shows a flat shape).
 */
export function voiceNoteToWire(details: VoiceNoteDetails): VoiceNoteOnWire {
    return {
        voiceDurationMs: Math.max(0, Math.round(details.duration * 1000)),
        voiceWaveform: toMatrixWaveform(details.waveform),
    };
}

/** What a nearby message says about its note's length and shape: each undefined when it carries none usable. */
export function voiceNoteFromWire(
    durationMs: unknown,
    waveform: unknown
): { voiceDuration: number | undefined; voiceWaveform: number[] | undefined } {
    return {
        voiceDuration: secondsFromMatrixDuration(durationMs),
        // A sender writes 100 points; more than that is cut, not read.
        voiceWaveform: fromMatrixWaveform(
            Array.isArray(waveform) ? waveform.slice(0, VOICE_NOTE_MATRIX_WAVEFORM_POINTS) : undefined
        ),
    };
}

const PLAYED_STORAGE_KEY = "universe-voice-notes-played";
const PLAYED_LIMIT = 500;

/** The notes this device has played, newest last. Kept in this browser only: nothing is told to the sender. */
function readPlayed(): string[] {
    try {
        const raw = window.localStorage.getItem(PLAYED_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}

export function hasPlayedVoiceNote(messageId: string): boolean {
    return readPlayed().includes(messageId);
}

export function markVoiceNotePlayed(messageId: string): void {
    try {
        const played = readPlayed();
        if (played.includes(messageId)) return;
        played.push(messageId);
        window.localStorage.setItem(PLAYED_STORAGE_KEY, JSON.stringify(played.slice(-PLAYED_LIMIT)));
    } catch {
        // Storage is blocked or full: the dot stays until the page is reloaded.
    }
}

const PLAYED_SINCE_STORAGE_KEY = "universe-voice-notes-since";
// Used when storage is blocked: one moment for the whole session, so notes that arrive after it still show their dot.
const sessionStartedAt = Date.now();

/**
 * When this device first looked at voice notes. A note sent before that is not marked as new: a chat with years of
 * voice messages would otherwise light up with a dot on every one of them.
 */
function playedSince(): number {
    try {
        const stored = Number(window.localStorage.getItem(PLAYED_SINCE_STORAGE_KEY));
        if (Number.isFinite(stored) && stored > 0) return stored;
        const now = Date.now();
        window.localStorage.setItem(PLAYED_SINCE_STORAGE_KEY, String(now));
        return now;
    } catch {
        return sessionStartedAt;
    }
}

/** True for a received note this device has not played and that was sent after it first showed notes. */
export function isVoiceNoteUnplayed(messageId: string | undefined, sentAt: Date | undefined): boolean {
    if (messageId === undefined) return false;
    if (sentAt !== undefined && sentAt.getTime() < playedSince()) return false;
    return !hasPlayedVoiceNote(messageId);
}

// Set when the chat code loads, before any message is shown: a note that arrives in this session was sent after it,
// while the history loaded with the chat was sent before it. Set only when a note is first drawn, it would sit after
// the first note and leave that one unmarked.
playedSince();
