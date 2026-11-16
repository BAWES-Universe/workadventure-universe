/**
 * The Brick for guests (game #1997): what answers a guest who writes to the Brick in their Chats.
 *
 * It is Universe's own, one shared definition for every universe, and it has no bot row: nothing is created for a guest,
 * nothing about a guest is kept here, and nothing is written to a bot's conversation log. The chat itself lives on the
 * guest's device, which sends the lines it holds with each message; this service reads them for this one answer and
 * forgets them. Orbit keeps totals only (who, where, when, what a reply took).
 *
 * The order of a turn, so nothing is spent that is not counted and nothing counted that was not tried:
 *   1. read what steers the Brick for this place, and how to reach Universe AI, from Orbit (never a host's key);
 *   2. ask Orbit whether this guest may have one more reply (their own allowance, the universe's pool); Orbit counts it at once;
 *   3. only then ask the model;
 *   4. close the turn at Orbit: a reply that failed is given back, and what it took is kept as totals.
 * The hello is the game's own fixed text and never comes through here.
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { AIProviderRegistry } from '../ai/AIProviderRegistry';
import { readBotLimits, type AIProviderConfig, type BotLimits } from '../ai/types';
import { priceMetadata } from '../ai/pricing/ledger';
import type { AdminApiService, GuestBrickAllowance, GuestBrickSetup } from './AdminApiService';
import type { CarriedMedia, CarriedPart, GuestChatNote } from '../matrix/MatrixDmBridge';
import type { GuestNotes } from '../voice/NoteTurns';

/** One line of the chat the guest holds, as their device sends it back. */
export interface GuestChatLine {
    from: 'guest' | 'brick';
    text: string;
}

export interface GuestBrickAsk {
    /** The guest: from their game token, never from the request. */
    guestId: string;
    /** One id for each try; a retry of the same try is counted once. */
    turnId: string;
    /** The room they are in: it decides which place the Brick helps with. */
    roomUrl: string;
    /** What they wrote now. */
    message: string;
    /** The chat so far, oldest first, without the message above. */
    history: GuestChatLine[];
    /** The Brick already said, once in this chat, that something needs an account: it does not say it again. */
    saidNeedsAccount: boolean;
    /** Files sent with this message (plan v3): each named by its upload receipt, never by a link. */
    files?: unknown[];
    /** A voice note sent as this message, by its upload receipt. */
    note?: unknown;
}

/** A guest's upload, read through the uploader once its receipt is theirs, and only when it is still what was uploaded. */
export type GuestUpload =
    | { ok: true; bytes: Uint8Array; url: string; type: string; name: string; sha256: string }
    /** `expired`: the device renews the receipt and sends the same message again. `refused`: not theirs, gone or changed. */
    /** `not-now`: the uploader could not be asked just now (a timeout or a server error); the file may well still be there. */
    | { ok: false; why: 'expired' | 'refused' | 'too-big' | 'not-now' };

/** What the Brick for guests needs to read files and hear notes, the same way every bot does. */
export interface GuestBrickMedia {
    readUpload(guestId: string, receipt: unknown): Promise<GuestUpload>;
    /** The text every bot reads for files, from bytes already checked, and the pictures for a model that sees them. */
    readFiles(text: string, files: { url: string; type: string; bytes: ArrayBuffer }[], readChars: number): Promise<{ text: string; images: string[] }>;
    /** Null when hearing can't work on this server. */
    notes: GuestNotes | null;
    /** What signs the device's "I have the answer" (SECRET_KEY). */
    secret: string;
}

/** The most files one message may carry, and their bytes together. */
export const GUEST_FILES_MAX = 10;
export const GUEST_FILE_BYTES_MAX = 15 * 1024 * 1024;
export const GUEST_TURN_BYTES_MAX = 40 * 1024 * 1024;

export type GuestBrickAnswer =
    /** `needsAccount` is true when this answer says that something needs an account: the game then offers to sign in. */
    | { kind: 'reply'; text: string; needsAccount: boolean; heard?: string; delivery?: string }
    /** The guest's own allowance, or the universe's pool for guests, is used up: no model was asked. */
    | { kind: 'limit'; limit: 'guest' | 'universe'; resetsAt: string }
    /** Another message of this guest is being answered: they send it again once it is. */
    | { kind: 'busy' }
    /** It could not answer (the AI failed, Orbit could not be asked): nothing was counted, they can send it again. */
    | { kind: 'failed' }
    /**
     * A voice note was not heard, and nothing is pending: too long ("This note is over N minutes. Send a shorter one."), the
     * service is busy or the note could not be read ("Couldn't listen to this note. Type it instead."), a try that may have
     * finished on a server that is gone ("Couldn't finish this one. Send it again."), or an answer no longer kept.
     */
    | { kind: 'unheard'; why: 'too-long' | 'busy' | 'failed' | 'uncertain' | 'expired'; longestSeconds?: number }
    /** A file or note could not be read: `expired` receipts are renewed and sent again; `refused` ones are gone. */
    | { kind: 'upload'; why: 'expired' | 'refused' | 'too-big' };

/** The Brick ends an answer with this when that answer says something needs an account; the game never shows it. */
export const NEEDS_ACCOUNT_MARK = '[NEEDS_ACCOUNT]';
const NEEDS_ACCOUNT_MARKS = /\s*\[NEEDS_ACCOUNT\]\s*/gi;

/** Words added to what Orbit says steers the Brick, so the game can tell an answer that points to signing in. */
function markRule(saidAlready: boolean): string {
    return saidAlready
        ? 'You already told this guest that something needs an account. Do not say it again and do not use any marker.'
        : `When your answer tells them that something needs an account (you cannot remember things after this visit, keep what you make, use apps, make more Bricks or use a computer until they sign in), end that answer with ${NEEDS_ACCOUNT_MARK} on its own at the very end. Never use it in any other answer.`;
}

/** The answer without the mark, and whether it had one. */
export function readMark(text: string): { text: string; needsAccount: boolean } {
    const needsAccount = new RegExp(NEEDS_ACCOUNT_MARKS.source, 'i').test(text);
    return { text: text.replace(NEEDS_ACCOUNT_MARKS, ' ').replace(/[ \t]+\n/g, '\n').trim(), needsAccount };
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Whether a string can be one of the ids this service takes in. */
export function isGuestBrickId(value: unknown): value is string {
    return typeof value === 'string' && ID.test(value);
}

/** The lines a request carries, kept to the ones the Brick may read: the newest `max`, each cut to `chars`. */
export function readHistory(value: unknown, max: number, chars: number): GuestChatLine[] {
    if (!Array.isArray(value)) return [];
    const lines: GuestChatLine[] = [];
    for (const one of value) {
        if (!one || typeof one !== 'object') continue;
        const { from, text } = one as Record<string, unknown>;
        if ((from !== 'guest' && from !== 'brick') || typeof text !== 'string' || !text.trim()) continue;
        lines.push({ from, text: text.trim().slice(0, chars) });
    }
    return lines.slice(-Math.max(0, max));
}

/**
 * The most a carried chat holds, so the one message that brings it never goes past what a homeserver takes in an event
 * (the lines are in it twice: as text and as data) or what a request may carry: the newest lines, each cut, within a byte budget.
 */
export const CARRIED_LINES_MAX = 200;
export const CARRIED_LINE_CHARS = 2000;
export const CARRIED_BYTES_MAX = 20000;

/** The longest the model may take for a guest's answer. The device stops waiting after a little more than this (Orbit round trips on top), so a counted answer always arrives. */
export const GUEST_REPLY_CEILING_MS = 90_000;

/** The most pictures, files and notes one carried chat brings, and what a note's words may hold. */
export const CARRIED_MEDIA_MAX = 20;
export const CARRIED_HEARD_CHARS = 4000;
/** What a copied file's link and a media item's fields take in the message, counted before the copy is made. */
const CARRIED_MEDIA_BYTES = 400;

function readCarriedMedia(value: unknown): CarriedMedia[] {
    if (!Array.isArray(value)) return [];
    const media: CarriedMedia[] = [];
    for (const one of value.slice(0, 10)) {
        if (!one || typeof one !== 'object') continue;
        const { kind, name, type, receipt, size, duration, heard } = one as Record<string, unknown>;
        if ((kind !== 'file' && kind !== 'note') || typeof receipt !== 'string' || receipt.length > 4096) continue;
        media.push({
            kind,
            name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : kind === 'note' ? 'voice message' : 'file',
            type: typeof type === 'string' && type ? type.slice(0, 255) : 'application/octet-stream',
            receipt,
            ...(typeof size === 'number' && Number.isFinite(size) && size >= 0 ? { size: Math.floor(size) } : {}),
            ...(typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
            ...(typeof heard === 'string' && heard.trim() ? { heard: heard.trim().slice(0, CARRIED_HEARD_CHARS) } : {}),
        });
    }
    return media;
}

/** The lines of a chat a guest held, as their device brings them along after sign-in: each with when it was said, and its media. */
export function readCarriedLines(value: unknown): GuestChatNote[] {
    if (!Array.isArray(value)) return [];
    const lines: GuestChatNote[] = [];
    let mediaLeft = CARRIED_MEDIA_MAX;
    for (const one of value) {
        if (!one || typeof one !== 'object') continue;
        const { from, text, at, label, id } = one as Record<string, unknown>;
        const media = from === 'guest' ? readCarriedMedia((one as Record<string, unknown>).media) : [];
        if ((from !== 'guest' && from !== 'brick') || typeof text !== 'string' || (!text.trim() && media.length === 0)) continue;
        lines.push({
            ...(typeof id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(id) ? { id } : {}),
            from,
            text: text.trim().slice(0, CARRIED_LINE_CHARS),
            at: typeof at === 'number' && Number.isFinite(at) && at > 0 ? Math.floor(at) : Date.now(),
            ...(media.length ? { media } : {}),
            ...(media.length && label === true ? { label: true as const } : {}),
        });
    }
    // The newest ones that fit: the start of a long chat is what is left behind
    const kept: GuestChatNote[] = [];
    let bytes = 0;
    for (let index = lines.length - 1; index >= 0 && kept.length < CARRIED_LINES_MAX; index--) {
        const line = lines[index];
        // Media past the most one chat brings stays behind as words
        if (line.media && line.media.length > mediaLeft) {
            const keptMedia = line.media.slice(0, mediaLeft);
            line.media = keptMedia.length ? keptMedia : undefined;
            if (!line.media) delete line.label;
        }
        mediaLeft -= line.media?.length ?? 0;
        // A line is sent twice in the event (as the message text and as data), both JSON-escaped; a receipt never goes in it
        const shown = { ...line, media: line.media?.map(({ receipt: _receipt, ...rest }) => rest) };
        bytes += 2 * Buffer.byteLength(JSON.stringify(shown), 'utf8') + (line.media?.length ?? 0) * CARRIED_MEDIA_BYTES;
        if (bytes > CARRIED_BYTES_MAX) break;
        if (!line.text && !line.media) continue;
        kept.unshift(line);
    }
    return kept;
}

/** The part a device names, null for a chat brought as one message, or 'bad' for one that is not a part. */
export function readCarriedPart(value: unknown): CarriedPart | null | 'bad' {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object') return 'bad';
    const { from, to, last } = value as Record<string, unknown>;
    const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100_000;
    if (!whole(from) || !whole(to) || to <= from || typeof last !== 'boolean') return 'bad';
    return { from, to, last };
}

/** What the model is given as the guest's turn: the chat so far, then what they write now. */
export function guestTurn(history: GuestChatLine[], message: string): string {
    const before = history.map((line) => `${line.from === 'guest' ? 'Guest' : 'You'}: ${line.text}`).join('\n');
    return before ? `The chat so far:\n${before}\n\nThe guest now writes:\n${message}` : message;
}

/** The key that signs a delivery: derived from SECRET_KEY for this only. */
function deliveryKey(secret: string): Buffer {
    return Buffer.from(hkdfSync('sha256', secret, 'guest-brick-delivery', 'delivery:v1', 32));
}

/** What the device sends back once it has an answer: which kept answer, for this guest only. */
export function signDelivery(secret: string, guestId: string, turnId: string): string {
    return `${turnId}.${createHmac('sha256', deliveryKey(secret)).update(`${turnId}|${guestId}`).digest('base64url')}`;
}

/** The kept answer a delivery names, when it is this guest's; null otherwise. */
export function readDelivery(secret: string, guestId: string, value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 300) return null;
    const dot = value.lastIndexOf('.');
    if (dot <= 0) return null;
    const turnId = value.slice(0, dot);
    const expected = createHmac('sha256', deliveryKey(secret)).update(`${turnId}|${guestId}`).digest();
    const given = Buffer.from(value.slice(dot + 1), 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected) ? turnId : null;
}

/** One hash of everything a turn holds, so the same turn id used for something else is refused by Orbit. */
export function turnContentHash(parts: { note?: string; text: string; files: string[]; history: GuestChatLine[] }): string {
    const history = createHash('sha256').update(JSON.stringify(parts.history)).digest('hex');
    return createHash('sha256').update(JSON.stringify({ note: parts.note ?? null, text: parts.text, files: parts.files, history })).digest('hex');
}

/** The turn can only fail in these ways, and the guest only ever hears "try again". */
const AI_FAILED = 'The AI did not answer';

export class GuestBrickService {
    private readonly asking = new Set<string>();
    /** Guests' turns with files or a note now, across every guest: each reads its uploads into memory before anything is counted. */
    private withUploads = 0;
    private readonly uploadsAtOnce: number;

    constructor(
        private readonly admin: Pick<AdminApiService, 'isConfigured' | 'getGuestBrick' | 'claimGuestBrickReply' | 'finishGuestBrickReply'>,
        private readonly providers: Pick<AIProviderRegistry, 'getOrCreateProvider'> = new AIProviderRegistry(),
        private readonly clock: () => Date = () => new Date(),
        private readonly media: GuestBrickMedia | null = null,
        /** How many guests' turns with files or a note this server takes at once; one more is "busy", never queued. Two per core by default. */
        options: { uploadsAtOnce?: number } = {}
    ) {
        this.uploadsAtOnce = Math.max(1, options.uploadsAtOnce ?? Math.max(4, 2 * availableParallelism()));
    }

    /** What this server can take from a guest now: files (with receipts), and voice notes (heard through Orbit). */
    async canTake(): Promise<{ files: boolean; notes: boolean }> {
        if (!this.media) return { files: false, notes: false };
        return { files: true, notes: !!this.media.notes && (await this.media.notes.canHearGuest()) };
    }

    /** The device has the answer of a note: its kept copy is deleted. False for one that is not this guest's. */
    async delivered(guestId: string, delivery: unknown): Promise<boolean> {
        if (!this.media?.notes) return false;
        const turnId = readDelivery(this.media.secret, guestId, delivery);
        if (!turnId) return false;
        await this.media.notes.delivered(turnId);
        return true;
    }

    /** The bytes of every upload a message names, or why one can't be read. Free: nothing is counted yet. */
    private async readUploads(ask: GuestBrickAsk): Promise<{ ok: true; note?: Extract<GuestUpload, { ok: true }>; files: Extract<GuestUpload, { ok: true }>[] } | { ok: false; answer: GuestBrickAnswer }> {
        const named = Array.isArray(ask.files) ? ask.files : [];
        if (ask.note === undefined && named.length === 0) return { ok: true, files: [] };
        if (!this.media || named.length > GUEST_FILES_MAX || (ask.note !== undefined && named.length > 0)) return { ok: false, answer: { kind: 'upload', why: 'refused' } };
        if (ask.note !== undefined && !this.media.notes) return { ok: false, answer: { kind: 'unheard', why: 'failed' } };
        const read: Extract<GuestUpload, { ok: true }>[] = [];
        let bytes = 0;
        for (const receipt of ask.note !== undefined ? [ask.note] : named) {
            const one = await this.media.readUpload(ask.guestId, receipt);
            if ('why' in one) {
                // The uploader couldn't be asked just now: nothing is said to be gone, the guest sends it again in a moment
                if (one.why === 'not-now') return { ok: false, answer: ask.note !== undefined ? { kind: 'unheard', why: 'busy' } : { kind: 'busy' } };
                return { ok: false, answer: { kind: 'upload', why: one.why } };
            }
            bytes += one.bytes.byteLength;
            if (bytes > GUEST_TURN_BYTES_MAX) return { ok: false, answer: { kind: 'upload', why: 'too-big' } };
            read.push(one);
        }
        return ask.note !== undefined ? { ok: true, note: read[0], files: [] } : { ok: true, files: read };
    }

    /** Whether Orbit is set up to run the Brick for guests at all. */
    available(): boolean {
        return this.admin.isConfigured();
    }

    async reply(ask: GuestBrickAsk): Promise<GuestBrickAnswer> {
        // One answer at a time per guest: two taps never spend two replies on one question
        if (this.asking.has(ask.guestId)) return { kind: 'busy' };
        // Files and notes are read before anything is counted, so how many are read at once is bounded across all guests: one
        // more is told to try again in a moment, the way a busy uploader is
        const uploads = ask.note !== undefined || (Array.isArray(ask.files) && ask.files.length > 0);
        if (uploads && this.withUploads >= this.uploadsAtOnce) return ask.note !== undefined ? { kind: 'unheard', why: 'busy' } : { kind: 'busy' };
        this.asking.add(ask.guestId);
        if (uploads) this.withUploads++;
        try {
            return await this.turn(ask);
        } finally {
            this.asking.delete(ask.guestId);
            if (uploads) this.withUploads--;
        }
    }

    private async turn(ask: GuestBrickAsk): Promise<GuestBrickAnswer> {
        let setup: GuestBrickSetup;
        let allowance: GuestBrickAllowance;
        // What the guest sent, read and checked before anything is counted
        const read = await this.readUploads(ask);
        if ('answer' in read) return read.answer;
        const uploads = read;
        try {
            setup = await this.admin.getGuestBrick(ask.roomUrl);
        } catch (error) {
            console.warn('[GuestBrick] Could not ask Orbit:', error instanceof Error ? error.message : error);
            return { kind: 'failed' };
        }
        try {
            allowance = await this.admin.claimGuestBrickReply({ guestId: ask.guestId, turnId: ask.turnId, roomUrl: ask.roomUrl });
        } catch (error) {
            console.warn('[GuestBrick] Could not ask Orbit:', error instanceof Error ? error.message : error);
            // Orbit may have counted the turn before the answer was lost: it is closed as failed, so nothing is kept for an answer never given
            await this.admin.finishGuestBrickReply(ask.turnId, { failed: true });
            return { kind: 'failed' };
        }
        if (allowance.allowed === false) return { kind: 'limit', limit: allowance.limit, resetsAt: allowance.resetsAt };
        // This very try was counted before and did not fail: it is answered or being answered, so the model is not paid for again.
        // A try that failed before is counted again by Orbit (`counted` is true), so it runs. A note's answer is kept at Orbit for a
        // while, so the same note asked again gets it back below, without running anything; with no kept answer it never runs again.
        if (allowance.counted === false && !uploads.note) {
            console.warn('[GuestBrick] This try was already counted, so no model runs again:', ask.turnId);
            return { kind: 'failed' };
        }

        const limits: BotLimits = readBotLimits(setup.credentials.limits);
        const config = {
            ...setup.credentials,
            maxTokens: typeof setup.credentials.maxTokens === 'number' ? setup.credentials.maxTokens : limits.replyTokens,
            // Never longer than the device waits for an answer (BotApiService GUEST_REPLY_TIMEOUT_MS), whatever Orbit says: a reply that finished after the device gave up would be counted but never seen
            settings: { ...(setup.credentials.settings ?? {}), timeout: Math.min(limits.waitSeconds * 1000, GUEST_REPLY_CEILING_MS) },
        } as unknown as AIProviderConfig;
        const history = readHistory(ask.history, limits.messages, limits.readChars);
        let message = ask.message.trim().slice(0, limits.readChars);

        // A voice note: heard once (or its kept words or answer given back), counted on the guest Brick's own note minutes
        let held: { turnId: string; generation: number; transcript: string } | undefined;
        if (uploads.note && this.media?.notes) {
            const notes = this.media.notes;
            const heard = await notes.guestNote({
                guestId: ask.guestId,
                roomUrl: ask.roomUrl,
                turnId: ask.turnId,
                bytes: uploads.note.bytes,
                contentHash: turnContentHash({ note: uploads.note.sha256, text: message, files: [], history }),
            });
            if (heard.kind === 'answered') {
                // Counted again only when the try had failed at Orbit: then it is closed as answered, with nothing new spent
                if (allowance.counted !== false) await this.admin.finishGuestBrickReply(ask.turnId, { tokensUsed: 0, costMicros: 0 });
                const kept = readMark(heard.answer);
                return { kind: 'reply', text: kept.text, needsAccount: kept.needsAccount && !ask.saidNeedsAccount, heard: heard.transcript, delivery: signDelivery(this.media.secret, ask.guestId, heard.turnId) };
            }
            if (heard.kind !== 'heard') {
                if (allowance.counted !== false) await this.admin.finishGuestBrickReply(ask.turnId, { failed: true });
                return heard.kind === 'refused'
                    ? { kind: 'unheard', why: heard.why, ...(heard.longestSeconds !== undefined ? { longestSeconds: heard.longestSeconds } : {}) }
                    : { kind: 'unheard', why: heard.kind };
            }
            if (!heard.transcript.trim()) {
                await notes.answerFailed(heard.turnId, heard.generation);
                if (allowance.counted !== false) await this.admin.finishGuestBrickReply(ask.turnId, { failed: true });
                return { kind: 'unheard', why: 'failed' };
            }
            // This try was counted before and never failed, yet the note has no kept answer: an earlier try ran or is running the
            // model and its answer was not recorded. The model is never run twice for one turn: the words stay for a new send
            if (allowance.counted === false) {
                console.warn('[GuestBrick] This note was already answered once, so no model runs again:', ask.turnId);
                await notes.answerFailed(heard.turnId, heard.generation);
                return { kind: 'unheard', why: 'uncertain' };
            }
            held = heard;
            message = heard.transcript.trim().slice(0, limits.readChars);
        }

        const sentAt = this.clock();
        try {
            // Files: the same reading every bot does, from the bytes checked above; only this message's pictures go to the model
            let images: string[] = [];
            if (uploads.files.length > 0 && this.media) {
                const read = await this.media.readFiles(
                    message,
                    uploads.files.map((file) => ({ url: file.url, type: file.type, bytes: file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer })),
                    limits.readChars
                );
                message = read.text;
                images = read.images;
            }
            const provider = this.providers.getOrCreateProvider(config);
            if (!provider.isReady()) throw new Error(AI_FAILED);
            const system = `${setup.brick.chatInstructions}\n\n${markRule(ask.saidNeedsAccount)}`;
            const response = images.length
                ? await provider.generate(system, guestTurn(history, message), config, undefined, undefined, images)
                : await provider.generate(system, guestTurn(history, message), config);
            if (response.error || !response.content?.trim()) throw new Error(AI_FAILED);
            const priced = priceMetadata(
                config,
                {
                    tokensUsed: response.tokensUsed,
                    promptTokens: response.usage?.promptTokens,
                    completionTokens: response.usage?.completionTokens,
                    cachedPromptTokens: response.usage?.cachedPromptTokens,
                    cacheWriteTokens: response.usage?.cacheWriteTokens,
                    reasoningTokens: response.usage?.reasoningTokens,
                    costUsd: response.usage?.costUsd,
                    error: response.error,
                },
                sentAt
            );
            const answer = readMark(response.content);
            // An answer that was only the marker has nothing to show: it fails, and the allowance is given back
            if (!answer.text.trim()) throw new Error(AI_FAILED);
            // A note's answer is kept at Orbit, encrypted, until the device says it has it, so a lost answer is never run again.
            // When Orbit did not keep it, the model has still run and been paid for: the answer goes to the guest and the try
            // stays counted (never given back, never marked failed), so a retry of this turn is refused by Orbit's count and the
            // note's turn, and the model never runs twice for one note
            if (held && this.media?.notes) {
                try {
                    await this.media.notes.answered(held.turnId, held.generation, response.content);
                } catch (error) {
                    console.warn('[GuestBrick] Orbit did not keep a note\'s answer; it goes to the guest, and is not run again:', error instanceof Error ? error.message : error);
                }
            }
            // What was said is never kept here: only what it took. Totals go once, for the try Orbit counted
            if (allowance.counted !== false) await this.admin.finishGuestBrickReply(ask.turnId, { tokensUsed: response.tokensUsed, costMicros: priced.cost.micros });
            return {
                kind: 'reply',
                text: answer.text,
                needsAccount: answer.needsAccount && !ask.saidNeedsAccount,
                ...(held && this.media ? { heard: held.transcript, delivery: signDelivery(this.media.secret, ask.guestId, held.turnId) } : {}),
            };
        } catch (error) {
            console.warn('[GuestBrick] The reply failed:', error instanceof Error ? error.message : error);
            // The words of a heard note stay at Orbit: the next try answers them without hearing the note again
            if (held && this.media?.notes) await this.media.notes.answerFailed(held.turnId, held.generation);
            // Given back: a guest is never charged an allowance for an answer they did not get
            await this.admin.finishGuestBrickReply(ask.turnId, { failed: true });
            return { kind: 'failed' };
        }
    }
}
