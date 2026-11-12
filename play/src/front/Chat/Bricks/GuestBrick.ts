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

/** One line of the chat a guest holds. `needsAccount` marks the Brick's answer that said something needs an account. */
export interface GuestLine extends GuestChatLine {
    needsAccount?: true;
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
        const { from, text, at, needsAccount } = one as Record<string, unknown>;
        if ((from !== "guest" && from !== "brick") || typeof text !== "string" || !text.trim()) continue;
        if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) continue;
        lines.push({ from, text, at, ...(needsAccount === true && from === "brick" ? { needsAccount: true } : {}) });
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
    return JSON.stringify(chat);
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
 * The chat so far as the request carries it, oldest first: every line but the ones in `skip` (the message being answered,
 * and any the guest wrote since that are still waiting for their turn).
 */
export function historyExcept(
    lines: readonly GuestLine[],
    skip: ReadonlySet<number>
): { from: "guest" | "brick"; text: string }[] {
    return lines
        .filter((_, index) => !skip.has(index))
        .slice(-REQUEST_LINES_MAX)
        .map(({ from, text }) => ({ from, text }));
}

/** What the bot server answers a guest's message with (the same four answers as the service). */
export type GuestAnswer =
    | { kind: "reply"; text: string; needsAccount: boolean }
    | { kind: "limit"; limit: "guest" | "universe"; resetsAt: string }
    | { kind: "busy" }
    | { kind: "failed" };

/** An answer as the bot server sends it; anything else is a failure, never a guess. */
export function parseGuestAnswer(value: unknown): GuestAnswer {
    if (!value || typeof value !== "object") return { kind: "failed" };
    const answer = value as Record<string, unknown>;
    if (answer.kind === "reply" && typeof answer.text === "string" && answer.text.trim()) {
        return { kind: "reply", text: answer.text.trim(), needsAccount: answer.needsAccount === true };
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
        const { from, text, at } = chat.lines[index];
        const cut = text.slice(0, CARRIED_LINE_CHARS);
        bytes += new TextEncoder().encode(cut).length;
        if (bytes > CARRIED_BYTES_MAX) break;
        kept.unshift({ from, text: cut, at });
    }
    return kept;
}
