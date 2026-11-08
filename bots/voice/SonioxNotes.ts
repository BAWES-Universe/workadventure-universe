/**
 * Hearing a voice note with Soniox's file API (https://docs.soniox.com/stt/async/async-transcription): the clip is uploaded, a
 * transcription is made from it, and both are deleted as soon as the words are read. The worker's live stream is for speech as it is
 * said; a recorded note (m4a, webm, ogg) is a file, and Soniox reads those formats itself.
 */
import { HearingError, type ClipHearer } from './NoteHearing';
import type { RecognitionConfig } from './protocol';

export const SONIOX_API = 'https://api.soniox.com/v1';
/** The file model that matches the live one a bot is set up with (stt-rt-v6 is read with stt-async-v6). */
export const SONIOX_CURRENT_ASYNC_MODEL = 'stt-async-v6';
/** Live models Soniox has retired are read with the current file model, as with the live stream. */
const SUPERSEDED_LIVE = new Set(['stt-rt-v5', 'stt-rt-v4', 'stt-rt-v3', 'stt-rt-preview', 'stt-rt-preview-v2', 'stt-rt-preview-v1']);

/** The file model for a bot's hearing model: an `stt-rt-vN` is read with `stt-async-vN`; anything else is used as named. */
export function asyncModelFor(model: string): string {
    if (!model || SUPERSEDED_LIVE.has(model)) return SONIOX_CURRENT_ASYNC_MODEL;
    const live = /^stt-rt-v(\d+)$/.exec(model);
    return live ? `stt-async-v${live[1]}` : model;
}

/**
 * Where the file API is for a bot's hearing endpoint. The endpoint is the live stream's (`wss://stt-rt.<region>.soniox.com/...`), and a
 * key only works in its own region, so the file API of the same region is used (`https://api.<region>.soniox.com/v1`). An `https://`
 * endpoint is taken as the API itself. Anything else is not understood: the default is used.
 */
export function restApiFor(endpoint: string | undefined): string | undefined {
    if (!endpoint) return undefined;
    if (endpoint.startsWith('https://')) return endpoint.replace(/\/+$/, '');
    const live = /^wss:\/\/stt-rt\.((?:[a-z0-9-]+\.)*soniox\.com)(?:[:/]|$)/i.exec(endpoint);
    return live ? `https://api.${live[1].toLowerCase()}/v1` : undefined;
}

export interface SonioxNotesOptions {
    fetch?: typeof fetch;
    /** Where the API is. Settings, not decisions of this file. */
    api?: string;
    /** How long a clip may take from upload to words before it counts as failed: also the most any one call may hang, so a stalled provider never holds a slot. */
    timeoutMs?: number;
    /** The most the clean-up calls may take, after the words are read or the hearing failed. */
    cleanupMs?: number;
    /** The first wait between asks, doubled each time up to the cap. */
    pollFirstMs?: number;
    pollCapMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

interface Transcription {
    id?: unknown;
    status?: unknown;
    audio_duration_ms?: unknown;
    error_message?: unknown;
}

export class SonioxNotes implements ClipHearer {
    constructor(private readonly options: SonioxNotesOptions = {}) {}

    async hear(settings: RecognitionConfig, clip: { bytes: Uint8Array; filename: string }): ReturnType<ClipHearer['hear']> {
        const call = this.options.fetch ?? fetch;
        const api = restApiFor(settings.endpoint) ?? this.options.api ?? SONIOX_API;
        const now = this.options.now ?? Date.now;
        const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        const timeoutMs = this.options.timeoutMs ?? 90_000;
        const headers = { Authorization: `Bearer ${settings.key ?? ''}` };
        // One limit for the whole hearing, put on every call: a call that stalls ends with the hearing instead of keeping its slot
        const signal = AbortSignal.timeout(timeoutMs);
        const started = now();
        let fileId: string | undefined;
        let transcriptionId: string | undefined;
        try {
            const form = new FormData();
            form.append('file', new Blob([clip.bytes as BlobPart]), clip.filename);
            const uploaded = await send(call, `${api}/files`, { method: 'POST', headers, body: form, signal });
            fileId = typeof uploaded.id === 'string' ? uploaded.id : undefined;
            if (!fileId) throw new HearingError('soniox did not name the file');
            const uploadMs = now() - started;

            const body: Record<string, unknown> = { model: asyncModelFor(settings.model), file_id: fileId };
            // Plain language codes ("ar"), not regional ones ("ar-KW"), as for the live stream
            if (settings.language) body.language_hints = [settings.language.split(/[-_]/)[0].toLowerCase()];
            // Names to expect, spelled as listed
            if (settings.terms?.length) body.context = { terms: settings.terms };
            const made = (await send(call, `${api}/transcriptions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })) as Transcription;
            transcriptionId = typeof made.id === 'string' ? made.id : undefined;
            if (!transcriptionId) throw new HearingError('soniox did not name the transcription');

            const waitStarted = now();
            let wait = this.options.pollFirstMs ?? 250;
            let state = made;
            while (state.status !== 'completed') {
                if (state.status === 'error') throw new HearingError('soniox could not read the note', 422);
                if (now() - started > timeoutMs) throw new HearingError('soniox took too long', 504);
                await sleep(wait);
                wait = Math.min(wait * 2, this.options.pollCapMs ?? 1500);
                state = (await send(call, `${api}/transcriptions/${transcriptionId}`, { headers, signal })) as Transcription;
            }
            const waitMs = now() - waitStarted;
            const answer = await send(call, `${api}/transcriptions/${transcriptionId}/transcript`, { headers, signal });
            const text = typeof answer.text === 'string' ? answer.text : '';
            const ms = typeof state.audio_duration_ms === 'number' ? state.audio_duration_ms : undefined;
            return { text, ...(ms !== undefined ? { seconds: ms / 1000 } : {}), uploadMs, waitMs };
        } finally {
            // Nothing stays at the provider: the clip and its words are deleted whether or not they were read
            const gone: Promise<unknown>[] = [];
            const cleanup = AbortSignal.timeout(this.options.cleanupMs ?? 10_000);
            if (transcriptionId) gone.push(call(`${api}/transcriptions/${transcriptionId}`, { method: 'DELETE', headers, signal: cleanup }).catch(() => undefined));
            if (fileId) gone.push(call(`${api}/files/${fileId}`, { method: 'DELETE', headers, signal: cleanup }).catch(() => undefined));
            await Promise.all(gone);
        }
    }
}

/** One call to the API: JSON back, or a `HearingError` with the status (never the request, the key or the answer's text). */
async function send(call: typeof fetch, url: string, init: RequestInit): Promise<Record<string, unknown> & Transcription> {
    let response: Response;
    try {
        response = await call(url, init);
    } catch (error) {
        throw timedOut(error) ? new HearingError('soniox took too long', 504) : new HearingError('soniox could not be reached');
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new HearingError('soniox refused the call', response.status);
    }
    try {
        return (await response.json()) as Record<string, unknown> & Transcription;
    } catch (error) {
        throw timedOut(error) ? new HearingError('soniox took too long', 504) : new HearingError('soniox sent an answer that could not be read', response.status);
    }
}

/** Whether a call ended because its time ran out. */
function timedOut(error: unknown): boolean {
    const name = (error as { name?: string } | null)?.name;
    return name === 'TimeoutError' || name === 'AbortError';
}
