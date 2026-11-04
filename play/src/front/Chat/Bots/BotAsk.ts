import { derived, type Readable } from "svelte/store";
import { botIdFromChatId } from "./BotChatStatus";

/**
 * A card a bot's direct message carries when it needs one answer before it changes, deletes or sends something (game
 * #1657, mock 3 approved 4 Nov 2026). It travels in the `universe.ask` field of the bot's notice, whose body says the
 * same in plain words for other chat apps. The bot server edits the same notice as the card ends, so `answer` fills in
 * and the card moves into the chat where it was asked.
 *
 * What the game does with it: pins the oldest waiting card above the message box, shows how each card ended, and sends
 * a tap as a `universe.ask.answer` event with only the card's id and revision (never new content). The bot server owns
 * everything else: what the action is, who may answer, how long a card waits and whether a tap still counts.
 */
export const BOT_ASK_KEY = "universe.ask";
/** The event a tap sends to the room. The bot server reads it; the game never decides what a tap does. */
export const BOT_ASK_ANSWER_EVENT = "universe.ask.answer";

/** What a tap on an option decides, the same three words Orbit keeps (`approve`, `approveAndRemember`, `decline`). */
export type BotAskDecision = "approve" | "approveAndRemember" | "decline";
const DECISIONS: BotAskDecision[] = ["approve", "approveAndRemember", "decline"];

export interface BotAskOption {
    id: BotAskDecision;
    /** In the tool's own words: "Create issue", "Create, and allow more WEB issues in this chat", "Don't create". */
    label: string;
}

export interface BotAskLine {
    label?: string;
    text: string;
}

/** How a card ended, as the bot server wrote it. A card that is still waiting has none. */
export interface BotAskAnswer {
    /** Which option was tapped. */
    option?: BotAskDecision;
    /** After "allow more": how long it lasts, in words. */
    allowedMore?: string;
    /** After the action ran: what the bot got back. */
    result?: string;
    /** The action went out and no answer came back, so it may have run. */
    unknown?: boolean;
    /** The person typed something else, so nothing was done. */
    typed?: boolean;
    /** The person closed the card with X, so nothing was done. */
    closed?: boolean;
    /** Nobody answered in time, so nothing was done. */
    expired?: boolean;
}

export interface BotAsk {
    id: string;
    /** Goes up each time the card changes; a tap names the one it saw. */
    revision: number;
    /** The tool's own title: "Create a Linear issue". */
    title: string;
    /** Whose account the bot uses when it is not the person's own: "Sara's Linear". */
    actsAs?: string;
    /** The exact content: team, title, description... */
    lines: BotAskLine[];
    options: BotAskOption[];
    /** Deletes and sends out: the bot asks every time, so "allow more" is never offered. */
    everyTime?: boolean;
    /** Nobody has confirmed the tool yet: only people who manage the bot get this far. */
    notReviewed?: boolean;
    /** Where to look when the outcome could not be confirmed. */
    checkAt?: { label: string; url: string };
    /** Only the person who asked sees this card: it came to them alone in nearby chat (#1658), not in a direct message. */
    private?: boolean;
    /** When the card closes, on THIS device's clock. */
    expiresAt: number;
    /** How long a card waits, for "No answer in 10 min". */
    waitMinutes: number;
    answer?: BotAskAnswer;
}

const TITLE_MAX = 200;
const TEXT_MAX = 2000;
const LABEL_MAX = 80;
const LINES_MAX = 20;
const ACTS_AS_MAX = 120;

const clip = (value: unknown, max: number): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

function parseLines(value: unknown): BotAskLine[] {
    if (!Array.isArray(value)) return [];
    const lines: BotAskLine[] = [];
    for (const raw of value.slice(0, LINES_MAX)) {
        if (!raw || typeof raw !== "object") continue;
        const text = clip((raw as Record<string, unknown>).text, TEXT_MAX);
        if (!text) continue;
        const label = clip((raw as Record<string, unknown>).label, LABEL_MAX);
        lines.push(label ? { label, text } : { text });
    }
    return lines;
}

function parseOptions(value: unknown): BotAskOption[] {
    if (!Array.isArray(value)) return [];
    const options: BotAskOption[] = [];
    for (const raw of value.slice(0, 3)) {
        if (!raw || typeof raw !== "object") continue;
        const { id, label } = raw as Record<string, unknown>;
        const text = clip(label, LABEL_MAX);
        if (!DECISIONS.includes(id as BotAskDecision) || !text) continue;
        if (options.some((option) => option.id === id)) continue;
        options.push({ id: id as BotAskDecision, label: text });
    }
    return options;
}

function parseAnswer(value: unknown): BotAskAnswer | undefined {
    if (!value || typeof value !== "object") return undefined;
    const o = value as Record<string, unknown>;
    const answer: BotAskAnswer = {};
    if (DECISIONS.includes(o.option as BotAskDecision)) answer.option = o.option as BotAskDecision;
    const allowedMore = clip(o.allowedMore, TEXT_MAX);
    if (allowedMore) answer.allowedMore = allowedMore;
    const result = clip(o.result, TEXT_MAX);
    if (result) answer.result = result;
    if (o.unknown === true) answer.unknown = true;
    if (o.typed === true) answer.typed = true;
    if (o.closed === true) answer.closed = true;
    if (o.expired === true) answer.expired = true;
    // An answer that says nothing still ends the card: the bot server wrote it
    return answer;
}

function parseCheckAt(value: unknown): BotAsk["checkAt"] {
    if (!value || typeof value !== "object") return undefined;
    const label = clip((value as Record<string, unknown>).label, LABEL_MAX);
    const url = clip((value as Record<string, unknown>).url, 2000);
    if (!label || !url) return undefined;
    try {
        // Only a web page opens from a card
        return new URL(url).protocol === "https:" ? { label, url } : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The card a bot's notice carries, or undefined when it has none, is not from a bot or is not one we understand.
 * `receivedAt` is when this device got the notice: the bot server's clock can differ from ours, so the card's expiry
 * is measured from the time the notice was written (`now`) to when it closes, and counted from `receivedAt`.
 */
export function readBotAsk(
    sender: string | null | undefined,
    content: Record<string, unknown> | undefined,
    receivedAt: number
): BotAsk | undefined {
    if (!content || !botIdFromChatId(sender) || content.msgtype !== "m.notice") return undefined;
    return parseAskField(content[BOT_ASK_KEY], receivedAt);
}

/**
 * The card a bot sent one person in nearby chat (#1658): the same field a direct message's notice carries, as JSON in a
 * private event. Who sent it is checked by the caller (only the bot itself, about itself). Only this person sees it.
 */
export function readNearbyBotAsk(body: string, receivedAt: number): BotAsk | undefined {
    let field: unknown;
    try {
        field = JSON.parse(body);
    } catch {
        return undefined;
    }
    const ask = parseAskField(field, receivedAt);
    return ask ? { ...ask, private: true } : undefined;
}

function parseAskField(field: unknown, receivedAt: number): BotAsk | undefined {
    if (!field || typeof field !== "object") return undefined;
    const o = field as Record<string, unknown>;
    if (o.v !== 1 || o.kind !== "approval") return undefined;
    const id = clip(o.id, 200);
    const title = clip(o.title, TITLE_MAX);
    const options = parseOptions(o.options);
    if (!id || !title || options.length === 0) return undefined;
    if (typeof o.revision !== "number" || !Number.isInteger(o.revision) || o.revision < 0) return undefined;
    if (typeof o.expiresAt !== "number" || typeof o.now !== "number") return undefined;
    const waitMinutes = typeof o.waitMinutes === "number" && o.waitMinutes > 0 ? Math.round(o.waitMinutes) : 10;
    const everyTime = o.everyTime === true;
    return {
        id,
        revision: o.revision,
        title,
        actsAs: clip(o.actsAs, ACTS_AS_MAX),
        lines: parseLines(o.lines),
        // "Allow more" is never offered where the bot asks every time
        options: everyTime ? options.filter((option) => option.id !== "approveAndRemember") : options,
        everyTime: everyTime || undefined,
        notReviewed: o.notReviewed === true || undefined,
        checkAt: parseCheckAt(o.checkAt),
        expiresAt: receivedAt + (o.expiresAt - o.now),
        waitMinutes,
        answer: parseAnswer(o.answer),
    };
}

/** A card closes this long before its end with a warning and a way to ask for more time. */
export const BOT_ASK_WARNING_MS = 60_000;

/** Waiting: not answered, not closed and not past its time. Whether a card ended is the bot server's word, but a card past
 * its time never takes a tap, so it counts as ended here too. */
export function isWaiting(ask: BotAsk, now: number): boolean {
    return !ask.answer && ask.expiresAt > now;
}

/** The card as it should be drawn now: a card nobody answered and whose time ran out reads as closed for lack of an answer. */
export function endedAsk(ask: BotAsk, now: number): BotAsk {
    if (ask.answer || ask.expiresAt > now) return ask;
    return { ...ask, answer: { expired: true } };
}

/** A minute or less before it closes. */
export function closesSoon(ask: BotAsk, now: number): boolean {
    return isWaiting(ask, now) && ask.expiresAt - now <= BOT_ASK_WARNING_MS;
}

/** The next time the cards' look changes by itself (a warning appears, or a card runs out), or undefined. */
export function nextAskChange(asks: readonly BotAsk[], now: number): number | undefined {
    let next: number | undefined;
    for (const ask of asks) {
        if (ask.answer) continue;
        for (const at of [ask.expiresAt - BOT_ASK_WARNING_MS, ask.expiresAt]) {
            if (at > now && (next === undefined || at < next)) next = at;
        }
    }
    return next;
}

/**
 * Which waiting card is on show: the one the person paged to while it still waits, otherwise the oldest. Kept by the
 * card, not its place in the line, so a card that ends never leaves the next one that arrives in the wrong place.
 */
export function shownAskPosition(waitingIds: readonly string[], pagedToId: string | undefined): number {
    const at = pagedToId === undefined ? -1 : waitingIds.indexOf(pagedToId);
    return at >= 0 ? at : 0;
}

/** A phone's chat sheet that does not cover the screen: one slim bar instead of the whole card. */
export function askBarFits(sheetLayout: boolean, rest: "peek" | "half" | "full" | number): boolean {
    if (!sheetLayout) return false;
    return typeof rest === "number" ? rest < 0.85 : rest !== "full";
}

/** What a tap sends: only which card and which revision it saw, and what was tapped. */
export type BotAskTap =
    | { action: "decide"; option: BotAskDecision }
    | { action: "close" }
    | { action: "moreTime" }
    | { action: "reviewAgain" }
    | { action: "askAgain" };

/** A tap as the private event to a bot in nearby chat carries it (#1658): the same words, as JSON. */
export function botAskTapJson(tap: BotAskTap): string {
    return JSON.stringify(tap);
}

export function botAskAnswerContent(ask: Pick<BotAsk, "id" | "revision">, tap: BotAskTap): Record<string, unknown> {
    return { v: 1, ask: ask.id, revision: ask.revision, ...tap };
}

/** A message that may carry a card, as the chat list holds it. */
interface MessageWithAsk {
    id: string;
    ask?: Readable<BotAsk | undefined>;
}

export interface AskedMessage<M> {
    message: M;
    ask: BotAsk;
}

/** Every card in the chat, oldest first, kept up to date as the bot server changes them. */
export function chatAsks<M extends MessageWithAsk>(messages: Readable<readonly M[]>): Readable<Array<AskedMessage<M>>> {
    return derived(
        messages,
        ($messages, set: (value: Array<AskedMessage<M>>) => void) => {
            const withAsk = $messages.filter(
                (message): message is M & { ask: Readable<BotAsk | undefined> } => !!message.ask
            );
            if (withAsk.length === 0) {
                set([]);
                return;
            }
            return derived(
                withAsk.map((message) => message.ask),
                ($asks) =>
                    $asks.flatMap((ask, index) => (ask ? [{ message: withAsk[index], ask } as AskedMessage<M>] : []))
            ).subscribe(set);
        },
        [] as Array<AskedMessage<M>>
    );
}
