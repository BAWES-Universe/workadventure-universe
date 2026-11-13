import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { BotAsk } from "../Bots/BotAsk";
import { DEFAULT_BRICK_LOOK, type BrickCard, type GuestChatLine } from "./Brick";
import { ownCard } from "./BrickHello";

/**
 * The Brick for someone who has not signed in (game #1997). It is Universe's own, one for every universe, and it has no
 * account, no bot and no chat on a server: the chat lives on the guest's device, and each message carries the lines the
 * device holds so the bot server can answer from them and forget them. Nothing in here talks to a server or reads a
 * store, so every rule can be unit tested.
 */

/** The one chat's id: it is never a chat address, so nothing can look it up anywhere else. */
export const GUEST_BRICK_ID = "guest-brick";

/** A guest's id as the game gives it to a new device (a uuid): an account's token names an email or an account instead. */
const GUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGuestId(value: unknown): value is string {
    return typeof value === "string" && GUEST_ID.test(value);
}

/**
 * A picture, file or voice note a guest sent the Brick (plan v3): kept on the device with the upload's receipt, which is what
 * the bot server takes as proof the file is theirs. The device never sends the link as authority.
 */
export interface GuestMedia {
    kind: "file" | "note";
    name: string;
    /** Its type, as the uploader checked it. */
    type: string;
    /** Where it can be shown from. */
    url: string;
    receipt: string;
    size?: number;
    /** A note's length (seconds) and shape (0 to 1 levels), as it was recorded. */
    duration?: number;
    waveform?: number[];
    /** What the Brick heard in a note. */
    heard?: string;
    /** The note could not be heard. */
    unheard?: true;
    /** A carried file that no longer existed when the chat came along. */
    gone?: true;
}

/** One line of the chat a guest holds. `needsAccount` marks the Brick's answer that said something needs an account. */
export interface GuestLine extends GuestChatLine {
    needsAccount?: true;
    /** What the guest sent with (or as) this line. */
    media?: GuestMedia[];
    /** The line's text only stands in for its media, so a game from before still shows the line: it is not drawn. */
    label?: true;
    /** The one id of this message's turn, the same on every try, so a retry is never counted or heard twice. */
    turnId?: string;
}

/** The chat format this game writes: 2 has media. A game from before reads its lines' text and leaves the rest. */
export const GUEST_CHAT_VERSION = 2;
const MEDIA_MAX = 10;
const WAVEFORM_MAX = 100;

function readMedia(value: unknown): GuestMedia[] {
    if (!Array.isArray(value)) return [];
    const media: GuestMedia[] = [];
    for (const one of value.slice(0, MEDIA_MAX)) {
        if (!one || typeof one !== "object") continue;
        const { kind, name, type, url, receipt, size, duration, waveform, heard, unheard } = one as Record<
            string,
            unknown
        >;
        if ((kind !== "file" && kind !== "note") || typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
        if (typeof receipt !== "string" || typeof name !== "string" || typeof type !== "string") continue;
        media.push({
            kind,
            name: name.slice(0, 255),
            type: type.slice(0, 255),
            url,
            receipt,
            ...(typeof size === "number" && Number.isFinite(size) && size >= 0 ? { size } : {}),
            ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
            ...(Array.isArray(waveform)
                ? {
                      waveform: waveform
                          .slice(0, WAVEFORM_MAX)
                          .filter((level): level is number => typeof level === "number" && Number.isFinite(level)),
                  }
                : {}),
            ...(typeof heard === "string" && heard.trim() ? { heard: heard.trim().slice(0, 8000) } : {}),
            ...(unheard === true ? { unheard: true as const } : {}),
        });
    }
    return media;
}

/** The words a line stands for, as the Brick and a carried chat read it: its text, a note's words, and a mark for each file. */
export function lineWords(line: GuestLine): string {
    const parts: string[] = [];
    if (!line.label && line.text.trim()) parts.push(line.text.trim());
    for (const one of line.media ?? []) {
        if (one.kind === "note") parts.push(one.heard ? `(voice note) ${one.heard}` : "(voice note)");
        else parts.push(one.type.startsWith("image/") ? `(sent a picture: ${one.name})` : `(sent a file: ${one.name})`);
    }
    return parts.join("\n");
}

/** The text a media line keeps for a game from before (it shows the line by its text). */
export function mediaLabel(media: readonly GuestMedia[]): string {
    return media.map((one) => (one.kind === "note" ? "🎤 Voice message" : `📎 ${one.name}`)).join("\n");
}

/** The chat a guest holds on their device. It is theirs only: it is sent to nobody but with their own next message. */
export interface GuestChat {
    /** The guest it belongs to: a device that gets a new guest starts a new chat. */
    guestId: string;
    /** When this chat began (ms): what a closed card is remembered by. */
    startedAt: number;
    /** When the last line was said (ms). */
    savedAt: number;
    /** The Brick already said, once in this chat, that something needs an account. */
    saidNeedsAccount: boolean;
    /** Set once Orbit has handed this chat to the account that signed in: it is only brought along from then on, never asked for again. */
    carryTaken?: true;
    /** How many lines, from the first, are already in the person's chat with their Brick: a carry cut short goes on from here. */
    carriedTo?: number;
    lines: GuestLine[];
}

export function newGuestChat(guestId: string, now: number): GuestChat {
    return { guestId, startedAt: now, savedAt: now, saidNeedsAccount: false, lines: [] };
}

function readLines(value: unknown): GuestLine[] {
    if (!Array.isArray(value)) return [];
    const lines: GuestLine[] = [];
    for (const one of value) {
        if (!one || typeof one !== "object") continue;
        const { from, text, at, needsAccount, label, turnId } = one as Record<string, unknown>;
        const media = from === "guest" ? readMedia((one as Record<string, unknown>).media) : [];
        if ((from !== "guest" && from !== "brick") || typeof text !== "string" || (!text.trim() && media.length === 0))
            continue;
        if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) continue;
        lines.push({
            from,
            text,
            at,
            ...(needsAccount === true && from === "brick" ? { needsAccount: true } : {}),
            ...(media.length ? { media } : {}),
            ...(media.length && label === true ? { label: true as const } : {}),
            ...(typeof turnId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(turnId) ? { turnId } : {}),
        });
    }
    return lines;
}

/**
 * The chat this device kept, as it was saved. Undefined when there is none, when it is not this guest's, or when it
 * was last touched longer ago than `keepMs`. `keepMs` is left out where a person who has signed in picks it up: Orbit
 * decides there whether the chat still goes with them.
 */
export function parseGuestChat(
    raw: string | null,
    guestId: string | null,
    now: number,
    keepMs?: number
): GuestChat | undefined {
    if (!raw) return undefined;
    try {
        const saved = JSON.parse(raw) as Record<string, unknown> | null;
        if (!saved || typeof saved !== "object") return undefined;
        const { guestId: owner, startedAt, savedAt, saidNeedsAccount, carryTaken, carriedTo } = saved;
        if (typeof owner !== "string" || (guestId !== null && owner !== guestId)) return undefined;
        if (typeof startedAt !== "number" || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return undefined;
        if (keepMs !== undefined && now - savedAt > keepMs) return undefined;
        const lines = readLines(saved.lines);
        if (lines.length === 0) return undefined;
        return {
            guestId: owner,
            startedAt,
            savedAt,
            saidNeedsAccount: saidNeedsAccount === true,
            ...(carryTaken === true ? { carryTaken: true as const } : {}),
            ...(typeof carriedTo === "number" && Number.isInteger(carriedTo) && carriedTo > 0 ? { carriedTo } : {}),
            lines,
        };
    } catch {
        return undefined;
    }
}

export function serializeGuestChat(chat: GuestChat): string {
    return JSON.stringify({ v: GUEST_CHAT_VERSION, ...chat });
}

/** The chat with one more line. A Brick's line that says something needs an account is the one that is remembered as said. */
export function withLine(chat: GuestChat, line: GuestLine): GuestChat {
    return {
        ...chat,
        savedAt: line.at,
        saidNeedsAccount: chat.saidNeedsAccount || line.needsAccount === true,
        lines: [...chat.lines, line],
    };
}

/**
 * The most lines a request carries. It is only the size of what is sent, so a long chat never makes a request too big:
 * how many of them the Brick reads is its own setting at Orbit, which clips them again.
 */
export const REQUEST_LINES_MAX = 100;

/**
 * What one request may carry, so a long chat or a long pasted message never makes it too big for the bot server to take
 * in (it reads a request body of about 100 KB): each line and the message are cut, and the chat is kept to a byte budget,
 * newest lines first. Together they stay well under that, with every character counted as it is escaped in the request.
 */
export const REQUEST_LINE_CHARS = 4000;
export const REQUEST_MESSAGE_CHARS = 8000;
export const REQUEST_HISTORY_BYTES_MAX = 40000;

/** The message of a request, cut to what a request carries. */
export function requestMessage(text: string): string {
    return text.slice(0, REQUEST_MESSAGE_CHARS);
}

/**
 * The chat so far as the request carries it, oldest first: every line but the ones in `skip` (the message being answered,
 * and any the guest wrote since that are still waiting for their turn), the newest that fit.
 */
export function historyExcept(
    lines: readonly GuestLine[],
    skip: ReadonlySet<number>
): { from: "guest" | "brick"; text: string }[] {
    const kept = lines.filter((line, index) => !skip.has(index) && lineWords(line)).slice(-REQUEST_LINES_MAX);
    const out: { from: "guest" | "brick"; text: string }[] = [];
    const encoder = new TextEncoder();
    let bytes = 0;
    for (let index = kept.length - 1; index >= 0; index--) {
        // Earlier pictures and notes are read as words: only the message being answered sends its files
        const line = { from: kept[index].from, text: lineWords(kept[index]).slice(0, REQUEST_LINE_CHARS) };
        bytes += encoder.encode(JSON.stringify(line)).length + 1;
        if (bytes > REQUEST_HISTORY_BYTES_MAX) break;
        out.push(line);
    }
    return out.reverse();
}

/** What the bot server answers a guest's message with (the same answers as the service). */
export type GuestAnswer =
    | { kind: "reply"; text: string; needsAccount: boolean; heard?: string; delivery?: string }
    | { kind: "limit"; limit: "guest" | "universe"; resetsAt: string }
    | { kind: "busy" }
    | { kind: "failed" }
    | { kind: "unheard"; why: "too-long" | "busy" | "failed" | "uncertain" | "expired"; longestSeconds?: number }
    | { kind: "upload"; why: "expired" | "refused" | "too-big" };

const UNHEARD = ["too-long", "busy", "failed", "uncertain", "expired"] as const;
const UPLOAD = ["expired", "refused", "too-big"] as const;

/** An answer as the bot server sends it; anything else is a failure, never a guess. */
export function parseGuestAnswer(value: unknown): GuestAnswer {
    if (!value || typeof value !== "object") return { kind: "failed" };
    const answer = value as Record<string, unknown>;
    if (answer.kind === "reply" && typeof answer.text === "string" && answer.text.trim()) {
        return {
            kind: "reply",
            text: answer.text.trim(),
            needsAccount: answer.needsAccount === true,
            ...(typeof answer.heard === "string" && answer.heard.trim() ? { heard: answer.heard.trim() } : {}),
            ...(typeof answer.delivery === "string" && answer.delivery.length <= 300
                ? { delivery: answer.delivery }
                : {}),
        };
    }
    if (answer.kind === "unheard" && (UNHEARD as readonly unknown[]).includes(answer.why)) {
        return {
            kind: "unheard",
            why: answer.why as (typeof UNHEARD)[number],
            ...(typeof answer.longestSeconds === "number" && answer.longestSeconds > 0
                ? { longestSeconds: answer.longestSeconds }
                : {}),
        };
    }
    if (answer.kind === "upload" && (UPLOAD as readonly unknown[]).includes(answer.why)) {
        return { kind: "upload", why: answer.why as (typeof UPLOAD)[number] };
    }
    if (
        answer.kind === "limit" &&
        (answer.limit === "guest" || answer.limit === "universe") &&
        typeof answer.resetsAt === "string" &&
        Number.isFinite(Date.parse(answer.resetsAt))
    ) {
        return { kind: "limit", limit: answer.limit, resetsAt: answer.resetsAt };
    }
    return answer.kind === "busy" ? { kind: "busy" } : { kind: "failed" };
}

/** The Brick as its row and header draw it: Universe's own look and name, never a bot of anyone's. */
export function guestBrickCard(ll: TranslationFunctions, now: number): BrickCard {
    return {
        id: GUEST_BRICK_ID,
        name: ll.chat.brick.guest.name(),
        description: null,
        characterTextureId: DEFAULT_BRICK_LOOK,
        enabled: true,
        isDefault: false,
        createdAt: new Date(now).toISOString(),
        hello: null,
    };
}

export const GUEST_STARTERS_CARD = "guest.starters";
export const GUEST_STARTER_PLACE = "place";
export const GUEST_STARTER_BRICK = "brick";
export const GUEST_KEEP_CARD = "guest.keep";
export const GUEST_KEEP_YES = "yes";
export const GUEST_KEEP_NO = "no";

/** The ways to start under the hello: only what the Brick can do for a guest. */
export function guestStartersCard(ll: TranslationFunctions): BotAsk {
    const words = ll.chat.brick.guest;
    return ownCard(GUEST_STARTERS_CARD, ll.chat.brick.startTitle(), [
        { id: GUEST_STARTER_PLACE, label: words.thisPlaceAsk(), line: words.thisPlaceLine() },
        { id: GUEST_STARTER_BRICK, label: words.whatCanABrickDoAsk(), line: words.whatCanABrickDoLine() },
    ]);
}

/** What a tap on a starter sends, in the guest's words; undefined for anything that is not a starter. */
export function guestStarterWords(starter: string, ll: TranslationFunctions): string | undefined {
    const words = ll.chat.brick.guest;
    if (starter === GUEST_STARTER_PLACE) return words.thisPlaceAsk();
    if (starter === GUEST_STARTER_BRICK) return words.whatCanABrickDoAsk();
    return undefined;
}

/** "Keep Brick?" after an answer that says something needs an account: sign in, or not now. */
export function guestKeepCard(ll: TranslationFunctions): BotAsk {
    const words = ll.chat.brick.guest;
    return ownCard(GUEST_KEEP_CARD, words.keepTitle(), [
        { id: GUEST_KEEP_YES, label: words.keepYes(), line: words.keepYesLine() },
        { id: GUEST_KEEP_NO, label: words.keepNo(), line: words.keepNoLine() },
    ]);
}

/** What a card remembers it was closed by: the chat it was in, so a new chat starts with its cards again. */
export const guestChatCardId = (chat: Pick<GuestChat, "startedAt">): string => `${GUEST_BRICK_ID}:${chat.startedAt}`;

/**
 * What one part of a carried chat holds at most (the bot server keeps to the same): lines, each cut, within a byte budget. A long
 * chat comes in as many parts as it takes (plan v3 section 7): no line is left behind.
 */
export const CARRIED_LINES_MAX = 200;
export const CARRIED_LINE_CHARS = 2000;
export const CARRIED_BYTES_MAX = 20000;

/** What a picture, file or note adds to a carried line in the Brick's message, once copied (its link and fields), as the bot server counts it. */
const CARRIED_MEDIA_BYTES = 400;
/** The most pictures, files and notes one part brings (the bot server keeps to the same). */
export const CARRIED_MEDIA_MAX = 20;
/** The words a carried note keeps. */
const CARRIED_HEARD_CHARS = 4000;

/** The stable name of a carried line: the chat it is from and its place in it, so a part sent twice is drawn once. */
export const carriedLineId = (chat: Pick<GuestChat, "startedAt">, index: number): string =>
    `${chat.startedAt}.${index}`;

/** The same measure as the bot server's: a line is sent twice in the message, both copies JSON-escaped; receipts not counted. */
function carriedBytes(line: GuestChatLine): number {
    const shown = { ...line, media: line.media?.map((one) => ({ ...one, receipt: undefined })) };
    return 2 * new TextEncoder().encode(JSON.stringify(shown)).length + (line.media?.length ?? 0) * CARRIED_MEDIA_BYTES;
}

/** One line as it is carried, cut until it fits in a part on its own: a line is never left behind for being long. */
function carriedLine(chat: GuestChat, index: number): GuestChatLine {
    const one = chat.lines[index];
    const media = (one.media ?? []).slice(0, CARRIED_MEDIA_MAX).map((item) => ({
        kind: item.kind,
        name: item.name,
        type: item.type,
        ...(item.size !== undefined ? { size: item.size } : {}),
        ...(item.duration !== undefined ? { duration: item.duration } : {}),
        ...(item.heard ? { heard: item.heard.slice(0, CARRIED_HEARD_CHARS) } : {}),
        receipt: item.receipt,
    }));
    let line: GuestChatLine = {
        id: carriedLineId(chat, index),
        from: one.from,
        text: one.text.slice(0, CARRIED_LINE_CHARS),
        at: one.at,
        ...(media.length ? { media } : {}),
        ...(media.length && one.label ? { label: true as const } : {}),
    };
    // Rarely: a line of escaped characters. Its words are cut further, the note's words first, until it fits
    for (let cut = 0.75; carriedBytes(line) > CARRIED_BYTES_MAX && cut > 0.01; cut *= 0.75) {
        line = {
            ...line,
            text: one.text.slice(0, Math.floor(CARRIED_LINE_CHARS * cut)),
            ...(line.media
                ? {
                      media: line.media.map((item) =>
                          item.heard
                              ? { ...item, heard: item.heard.slice(0, Math.floor(CARRIED_HEARD_CHARS * cut)) }
                              : item
                      ),
                  }
                : {}),
        };
    }
    return line;
}

/** One part of a carried chat: the lines from `from` up to (not including) `to`, and whether it is the last of the chat. */
export interface CarriedPart {
    from: number;
    to: number;
    last: boolean;
    lines: GuestChatLine[];
}

/**
 * The next part of a chat to bring along after sign-in, from line `from`: as many lines, in order, as fit in one message. A
 * guest's pictures, files and notes go with their receipts, so the bot server can copy them into the account; a note's words go
 * with it. The same chat and `from` always make the same part, so a part asked again is the same part.
 */
export function carriedPart(chat: GuestChat, from: number): CarriedPart {
    const lines: GuestChatLine[] = [];
    let bytes = 0;
    let media = 0;
    let to = from;
    while (to < chat.lines.length && lines.length < CARRIED_LINES_MAX) {
        const line = carriedLine(chat, to);
        const size = carriedBytes(line);
        const count = line.media?.length ?? 0;
        if (lines.length > 0 && (bytes + size > CARRIED_BYTES_MAX || media + count > CARRIED_MEDIA_MAX)) break;
        lines.push(line);
        bytes += size;
        media += count;
        to += 1;
    }
    return { from, to, last: to >= chat.lines.length, lines };
}

/** For a bot server from before, which takes a carried chat as one message: the newest lines that fit in one part. */
export function carriedTail(chat: GuestChat): CarriedPart {
    let start = chat.lines.length;
    while (start > 0 && carriedPart(chat, start - 1).last) start -= 1;
    const part = carriedPart(chat, start);
    return { ...part, to: chat.lines.length, last: true };
}
