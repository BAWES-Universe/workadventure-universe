/**
 * Keeps the files people send a bot, and the files it sends them, on Orbit's list (#1508), in the background: a reply never waits for it, and a
 * failure here never touches the reply. Each file is added (one retry when Orbit could not be reached), its note in
 * the history gets the short id Orbit gave, and its text is kept in pieces: the text the reply already read when that
 * was all of it, or the whole file read again afterwards, up to "Text kept from a file".
 *
 * Nothing about a file (its name, its text) is ever logged.
 */
import type { AdminApiService, ArtifactCall, BotFileSummary } from '../server/AdminApiService';
import type { MemoryForgetNotice } from '../memory/ForgetNotice';
import { FileParser } from './FileParser';
import { keptTextOf, kindOf, piecesOf, storeOf, TEXT_PIECE_CHARS, type ChatUpload, type FileKind, type MadeWith, type SentMedia } from './ChatFiles';

/** Waited before the one retry of an add Orbit did not answer. */
const RETRY_AFTER_MS = 2_000;
/** Whole files read again at once, so a burst of uploads doesn't load a small server that hosts every bot. */
const READS_AT_ONCE = 2;
/** The longest line Orbit takes with a file. */
const MAX_LINE_SENT = 2_000;

export interface FileJob {
    call: ArtifactCall;
    /** Who the bot server knows the person as (their uuid), so a Forget for them drops what is still waiting. */
    personRef: string | null;
    upload: ChatUpload;
    kind: FileKind;
    /** Who sent it: the person (the default), or the bot. */
    source?: 'person' | 'bot';
    /** For a file the bot sent: the tool that made it and what the bot asked it for, when it was made this visit. */
    made?: MadeWith | null;
    /** One line about it (a caption it was sent with), for the bot's notes and for search. */
    line?: string | null;
    pages?: number | null;
    /** The whole text, when the reply already read all of it. */
    text?: string | null;
    /** Read the whole file again afterwards, when the reply read only part of it. */
    readAgain?: { mimeType: string } | null;
    /** "Text kept from a file": text past it is not sent, since Orbit would turn it down. */
    maxTextChars: number;
    /** Called with the short id once Orbit gave one. */
    onRef?: (ref: string) => void;
}

type Parse = typeof FileParser.parseFile;

/**
 * A file the bot sent, to keep: named as it was sent (or by its link), with the tool that made it. A document's text
 * is read afterwards, up to "Text kept from a file", so finding it later finds its words.
 */
export function sentMediaJob(
    item: SentMedia,
    where: { call: ArtifactCall; personRef: string | null; maxTextChars: number },
    made: MadeWith | null
): FileJob {
    let fromLink = '';
    try {
        fromLink = decodeURIComponent(new URL(item.url).pathname.split('/').pop() ?? '');
    } catch {
        fromLink = '';
    }
    const name = item.fileName?.trim() || fromLink || item.mediaType || 'file';
    const upload: ChatUpload = { url: item.url, name, mimeType: item.mimeType || null, mediaType: item.mediaType };
    const kind = kindOf(upload);
    return {
        ...where,
        upload,
        kind,
        source: 'bot',
        made,
        line: item.caption?.trim() || null,
        ...(kind === 'document' && upload.mimeType && where.maxTextChars > 0 ? { readAgain: { mimeType: upload.mimeType } } : {}),
    };
}

/** Text up to `max` characters, never ending in half an emoji. */
function clipped(text: string, max: number): string {
    if (text.length <= max) return text;
    const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
    return text.slice(0, Math.max(0, end));
}

/** As PersistentMemory: an older Orbit repeats a Forget for a minute; one with an id until it is reported. */
const FORGET_REPEAT_WINDOW_MS = 2 * 60 * 1000;
const FORGET_ROW_KEEP_MS = 24 * 60 * 60 * 1000;

export class ChatFileKeeper {
    /** Counts up on each Forget, per bot ("*" for everyone) and per person, so work started before it stops. */
    private forgets = new Map<string, number>();
    /** Forgets already counted, by "botId|row:<id>" (or "botId|*" and "botId|uuid:<uuid>"), until when each is left out. */
    private applied = new Map<string, number>();
    private reads: (() => Promise<void>)[] = [];
    private reading = 0;

    constructor(
        private parse: Parse = (url, mimeType, maxChars) => FileParser.parseFile(url, mimeType, maxChars),
        private retryAfterMs = RETRY_AFTER_MS
    ) {}

    /**
     * Keep the files of one message, one after the other, so their notes get their ids in the order they were sent.
     * Never throws; resolves with the ids given (null for a file that wasn't kept).
     */
    keepAll(admin: AdminApiService, jobs: FileJob[]): Promise<(string | null)[]> {
        return (async () => {
            const refs: (string | null)[] = [];
            for (const job of jobs) refs.push(await this.keep(admin, job));
            return refs;
        })();
    }

    /**
     * Drop what is still waiting for people Orbit asked the bot to forget. Orbit repeats a Forget in its answers until it
     * is reported (#493), so each one counts once, by its id (or, from an older Orbit, by who it names for a while), and
     * a file sent after it is kept.
     */
    forget(botId: string, notice: MemoryForgetNotice): void {
        const now = Date.now();
        for (const [key, keepUntil] of this.applied) if (now > keepUntil) this.applied.delete(key);
        const once = (key: string, keepMs: number) => {
            if (this.applied.has(`${botId}|${key}`)) return false;
            this.applied.set(`${botId}|${key}`, now + keepMs);
            return true;
        };
        const bump = (key: string) => this.forgets.set(key, (this.forgets.get(key) ?? 0) + 1);
        if (notice.rows && notice.rows.length > 0) {
            for (const row of notice.rows) {
                if (once(`row:${row.id}`, FORGET_ROW_KEEP_MS)) bump(`${botId}|${row.userUuid ?? '*'}`);
            }
            return;
        }
        if (notice.everyone && once('*', FORGET_REPEAT_WINDOW_MS)) bump(`${botId}|*`);
        for (const uuid of notice.userUuids) if (once(`uuid:${uuid}`, FORGET_REPEAT_WINDOW_MS)) bump(`${botId}|${uuid}`);
    }

    private epochOf(botId: string, personRef: string | null): string {
        return `${this.forgets.get(`${botId}|*`) ?? 0}:${personRef ? (this.forgets.get(`${botId}|${personRef}`) ?? 0) : 0}`;
    }

    private async keep(admin: AdminApiService, job: FileJob): Promise<string | null> {
        const epoch = this.epochOf(job.call.botId, job.personRef);
        const wanted = () => this.epochOf(job.call.botId, job.personRef) === epoch;
        const added = await this.add(admin, job);
        if (!added || !wanted()) return added?.ref ?? null;
        job.onRef?.(added.ref);
        // A file with text to keep (null: it could not be read, which Orbit is told)
        if (job.text !== undefined) {
            await this.keepText(admin, job, added.ref, job.text, wanted);
        } else if (job.readAgain) {
            const readAgain = job.readAgain;
            this.queueRead(async () => {
                if (!wanted()) return;
                let text: string | null = null;
                try {
                    text = keptTextOf(await this.parse(job.upload.url, readAgain.mimeType, job.maxTextChars));
                } catch {
                    text = null;
                }
                if (!wanted()) return;
                await this.keepText(admin, job, added.ref, text, wanted);
            });
        }
        return added.ref;
    }

    private async add(admin: AdminApiService, job: FileJob): Promise<BotFileSummary | null> {
        const { upload } = job;
        const file = {
            source: job.source ?? ('person' as const),
            kind: job.kind,
            name: upload.name,
            mimeType: upload.mimeType ?? null,
            sizeBytes: upload.sizeBytes ?? null,
            store: storeOf(upload.url),
            lengthSeconds: upload.lengthSeconds != null ? Math.round(upload.lengthSeconds) : null,
            pages: job.pages ?? null,
            // Orbit takes a line up to 2,000 characters, and keeps its first 300
            ...(job.line ? { line: clipped(job.line, MAX_LINE_SENT) } : {}),
            // Orbit takes a prompt up to one piece of text
            ...(job.made ? { madeWith: job.made.with, madePrompt: job.made.prompt === null ? null : clipped(job.made.prompt, TEXT_PIECE_CHARS) } : {}),
        };
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                return (await admin.addBotFile(job.call, file)).file;
            } catch (error) {
                const code = (error as { code?: string })?.code;
                // Orbit said no (or has no list yet): trying again gives the same answer
                if (code !== 'orbit_unavailable' || attempt > 0) {
                    console.warn(`[ChatFileKeeper] A file for bot ${job.call.botId} was not kept (${code ?? 'error'})`);
                    return null;
                }
                await new Promise((resolve) => setTimeout(resolve, this.retryAfterMs));
            }
        }
        return null;
    }

    /** The text in pieces, in order; or that it could not be read. */
    private async keepText(admin: AdminApiService, job: FileJob, ref: string, text: string | null, wanted: () => boolean): Promise<void> {
        // "Text kept from a file" is 0: no text is kept
        if (job.maxTextChars <= 0) return;
        try {
            if (text === null) {
                await admin.keepBotFileText(job.call, ref, { failed: true });
                return;
            }
            for (const piece of piecesOf(clipped(text, job.maxTextChars))) {
                if (!wanted()) return;
                await admin.keepBotFileText(job.call, ref, piece);
            }
        } catch (error) {
            console.warn(`[ChatFileKeeper] A file's text for bot ${job.call.botId} was not kept (${(error as { code?: string })?.code ?? 'error'})`);
        }
    }

    private queueRead(read: () => Promise<void>): void {
        this.reads.push(read);
        this.nextRead();
    }

    private nextRead(): void {
        while (this.reading < READS_AT_ONCE && this.reads.length > 0) {
            const read = this.reads.shift()!;
            this.reading++;
            void read()
                .catch(() => undefined)
                .finally(() => {
                    this.reading--;
                    this.nextRead();
                });
        }
    }

    /** Resolves once every read waiting or running has finished (for tests). */
    async idle(): Promise<void> {
        while (this.reading > 0 || this.reads.length > 0) await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

/** One keeper for the bot server: direct messages and every bubble share it. */
export const chatFileKeeper = new ChatFileKeeper();
