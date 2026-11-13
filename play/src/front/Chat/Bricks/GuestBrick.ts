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
        const { guestId: owner, startedAt, savedAt, saidNeedsAccount, carryTaken } = saved;
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

/** What a carried chat holds at most (the bot server keeps to the same): the newest lines, each cut, within a byte budget. */
export const CARRIED_LINES_MAX = 200;
export const CARRIED_LINE_CHARS = 2000;
export const CARRIED_BYTES_MAX = 20000;

/** The lines to bring along after sign-in: what was said, and when, the newest ones that fit in one message. */
export function carriedLines(chat: GuestChat): GuestChatLine[] {
    const kept: GuestChatLine[] = [];
    let bytes = 0;
    for (let index = chat.lines.length - 1; index >= 0 && kept.length < CARRIED_LINES_MAX; index--) {
        const { from, at } = chat.lines[index];
        // A picture, file or note comes along as what it was: its name, or the words heard in it
        const text = lineWords(chat.lines[index]);
        if (!text) continue;
        const cut = text.slice(0, CARRIED_LINE_CHARS);
        const line = { from, text: cut, at };
        // The same measure as the bot server's: a line is sent twice in the message, both copies JSON-escaped
        bytes += 2 * new TextEncoder().encode(JSON.stringify(line)).length;
        if (bytes > CARRIED_BYTES_MAX) break;
        kept.unshift(line);
    }
    return kept;
}
