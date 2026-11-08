/**
 * A bot hears a voice note: the clip is read once, sent to the bot's own hearing provider as a file, and the words come back as
 * text that is saved on the message (never audio over the bridge socket, never the clip kept at the provider).
 *
 * Who the note is for is decided by the caller before it gets here: only a note that was meant for this bot is ever fetched. Everything
 * that goes wrong ends the same way: the note is not heard, the bot is told so in one short line, and nothing throws to the caller.
 * A key is read for the one provider call and is not kept, logged or put in an error.
 */
import type { RecognitionConfig } from './protocol';
import type { ProviderPart } from './protocol';

/** Why a note was not heard. `unsupported`: the bot's hearing provider has no file call yet. `none`: the bot has no hearing to use. */
export type NoteFailure = 'none' | 'unsupported' | 'too-long' | 'too-big' | 'allowance' | 'rejected' | 'busy' | 'failed';

/** Where the time of one hearing went, in milliseconds. No words, no audio: safe to log and to count. */
export interface NoteTimings {
    downloadMs: number;
    uploadMs: number;
    waitMs: number;
    totalMs: number;
}

export type HeardNote =
    | { ok: true; text: string; provider: string; clipSeconds?: number; timings: NoteTimings }
    | { ok: false; reason: NoteFailure; status?: number };

/** What a hearing provider does with a clip. One per adapter that can read a file. */
export interface ClipHearer {
    /** Reads the clip; throws a `HearingError` when the provider says no. The clip's seconds come back when the provider knows them. */
    hear(settings: RecognitionConfig, clip: { bytes: Uint8Array; filename: string }): Promise<{ text: string; seconds?: number; uploadMs: number; waitMs: number }>;
}

/** A provider's refusal: its HTTP status when it had one, and whether it refused the key itself or ran out of room. */
export class HearingError extends Error {
    constructor(
        message: string,
        readonly status?: number
    ) {
        super(message);
        this.name = 'HearingError';
    }
    get rejected(): boolean {
        return this.status === 401 || this.status === 403;
    }
    get exhausted(): boolean {
        return this.status === 402 || this.status === 429;
    }
}

/** What the orchestrator needs of the bot's voice settings (`BotVoiceSettings` is the real one; tests give a fake). */
export interface HearingSettings {
    /** The bot's hearing, key included, or null when the bot has none it can use. Never throws. */
    recognition(): Promise<{ recognition: RecognitionConfig; providerId: string; owner: boolean } | null>;
    report(providerId: string, part: ProviderPart, outcome: { ok: true } | { ok: false; status?: number; rejected?: boolean }): void;
}

/** What it costs a person's listening time for this bot to hear a note, when an allowance is kept (Orbit's listening limit). */
export interface NoteAllowance {
    /** Whether the bot may hear another note now. Never throws: an Orbit that can't be asked allows. */
    allowed(): Promise<boolean>;
    /** Counts the seconds heard. */
    spend(seconds: number): void;
}

export interface NoteHearingOptions {
    /** The clip's bytes at its address, or throws. Over `maxBytes` it throws. */
    fetchClip: (url: string, maxBytes: number) => Promise<Uint8Array>;
    hearers: Record<string, ClipHearer>;
    settings: HearingSettings;
    allowance?: NoteAllowance;
    /** The longest clip heard, in seconds, and the most bytes read for it. Settings, not decisions of this file. */
    limits: { maxSeconds: number; maxBytes: number };
    /** How many notes are being heard at once; one more waits no longer than it takes to say it is busy. */
    maxConcurrent?: number;
    log?: (message: string) => void;
    now?: () => number;
}

/** A note heard once is not heard again for the same message: a retry, a second chat window or a redelivered event gets the same answer. */
const KEEP_MS = 60 * 60_000;
const KEEP_MAX = 500;
const DEFAULT_CONCURRENT = 4;

export class NoteHearing {
    private readonly done = new Map<string, { at: number; result: Promise<HeardNote> }>();
    private running = 0;

    constructor(private readonly options: NoteHearingOptions) {}

    /**
     * Hears one note. `messageId` is the chat's own id for the message, so the same note is heard once. `seconds` is the length the
     * sender's app wrote on the note, when it did: a note over the limit is refused before anything is downloaded.
     */
    hear(messageId: string, clip: { url: string; filename: string; seconds?: number }): Promise<HeardNote> {
        const now = (this.options.now ?? Date.now)();
        this.forget(now);
        const kept = this.done.get(messageId);
        if (kept) return kept.result;
        const result = this.run(clip).catch((error): HeardNote => {
            this.log(`could not hear a note (${describe(error)})`);
            return { ok: false, reason: 'failed' };
        });
        this.done.set(messageId, { at: now, result });
        // A note that was refused for room or for a provider's trouble is tried again the next time it is asked for
        void result.then((heard) => {
            if ('reason' in heard && (heard.reason === 'busy' || heard.reason === 'failed' || heard.reason === 'allowance')) this.done.delete(messageId);
        });
        return result;
    }

    private async run(clip: { url: string; filename: string; seconds?: number }): Promise<HeardNote> {
        const { limits, settings, allowance } = this.options;
        const now = this.options.now ?? Date.now;
        const started = now();
        if (clip.seconds !== undefined && clip.seconds > limits.maxSeconds) return { ok: false, reason: 'too-long' };
        const found = await settings.recognition();
        if (!found) return { ok: false, reason: 'none' };
        const hearer = this.options.hearers[found.recognition.adapter];
        if (!hearer) return { ok: false, reason: 'unsupported' };
        // Universe AI pays for hearing out of the person's listening time; a person's own key is not counted
        if (!found.owner && allowance && !(await allowance.allowed())) return { ok: false, reason: 'allowance' };
        if (this.running >= (this.options.maxConcurrent ?? DEFAULT_CONCURRENT)) return { ok: false, reason: 'busy' };
        this.running++;
        try {
            let bytes: Uint8Array;
            try {
                bytes = await this.options.fetchClip(clip.url, limits.maxBytes);
            } catch (error) {
                if (/too large/i.test((error as Error)?.message ?? '')) return { ok: false, reason: 'too-big' };
                throw error;
            }
            const downloadMs = now() - started;
            try {
                const heard = await hearer.hear(found.recognition, { bytes, filename: clip.filename });
                if (!found.owner) settings.report(found.providerId, 'recognition', { ok: true });
                const seconds = heard.seconds ?? clip.seconds;
                if (!found.owner && allowance && seconds) allowance.spend(seconds);
                if (seconds !== undefined && seconds > limits.maxSeconds) return { ok: false, reason: 'too-long' };
                const totalMs = now() - started;
                this.log(`heard a ${seconds !== undefined ? `${seconds.toFixed(1)} s ` : ''}note with ${found.recognition.adapter} in ${totalMs} ms (download ${downloadMs}, upload ${heard.uploadMs}, wait ${heard.waitMs})`);
                return {
                    ok: true,
                    text: heard.text,
                    provider: found.recognition.adapter,
                    ...(seconds !== undefined ? { clipSeconds: seconds } : {}),
                    timings: { downloadMs, uploadMs: heard.uploadMs, waitMs: heard.waitMs, totalMs },
                };
            } catch (error) {
                if (error instanceof HearingError) {
                    settings.report(found.providerId, 'recognition', { ok: false, ...(error.status !== undefined ? { status: error.status } : {}), ...(error.rejected ? { rejected: true } : {}) });
                    if (error.rejected) return { ok: false, reason: 'rejected', status: error.status };
                    if (error.exhausted) return { ok: false, reason: 'allowance', status: error.status };
                    return { ok: false, reason: 'failed', ...(error.status !== undefined ? { status: error.status } : {}) };
                }
                throw error;
            }
        } finally {
            this.running--;
        }
    }

    private forget(now: number): void {
        for (const [id, entry] of this.done) {
            if (now - entry.at > KEEP_MS || this.done.size > KEEP_MAX) this.done.delete(id);
            else break;
        }
    }

    private log(message: string): void {
        this.options.log?.(`voice note: ${message}`);
    }
}

/** A line about a failure that cannot carry a key or words: the status or the error's name. */
function describe(error: unknown): string {
    if (error instanceof HearingError) return error.status ? `status ${error.status}` : 'provider error';
    return error instanceof Error ? error.constructor.name : 'error';
}

/** The words a note's transcript may hold, cut to what chat shows and the bot reads: runs of whitespace become one space. */
export function tidyTranscript(text: string, maxChars: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > maxChars ? `${clean.slice(0, maxChars - 1).trimEnd()}…` : clean;
}
