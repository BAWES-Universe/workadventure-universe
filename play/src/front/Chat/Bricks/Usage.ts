/**
 * A person's usage (game #1999 and the credits and grants work), as Orbit's `/api/me/usage` sends it: real numbers. Universe
 * AI in replies with the time they reset, Instant Apps and computers in dollars, extra credit, what each Brick spent, and one
 * line for each task. Every number is the server's: the game never works one out. An older Orbit that sends only the bar and
 * its words is still read, and shows those words. Nothing in here talks to a server or reads a store, so every rule can be
 * unit tested.
 */

export type UsageWords = "plenty" | "half" | "low" | "out";

/** Replies, as Orbit counts them for the person: what the server will admit, with work already running left out. */
export interface Replies {
    available: number;
    total: number;
    /** Replies being made now: not in `available` */
    inProgress: number;
    /** False when no window is running (the next reply starts one; opening Usage never does) */
    running: boolean;
    /** The window's length, from Limits; none when Orbit did not say */
    windowHours: number | null;
}

/** An extra that lifts the person's reply limit for a while: a multiple, or no personal limit. */
export interface ChatExtra {
    /** null with `noLimit`: no personal limit */
    multiplier: number | null;
    noLimit: boolean;
    until: string | null;
}

/** What Universe AI gives the person for text and voice together. */
export interface ChatUsage {
    /** What is left, 0 to 1: the bar. */
    left: number;
    words: UsageWords;
    /** When the bar is full again; none when no window is running. */
    fullAgainAt: string | null;
    /** Real counts; null from an older Orbit, which sends only the bar and its words */
    replies: Replies | null;
    extra: ChatExtra | null;
    /** The balance could not be read: the page says so, with no bar */
    unavailable: boolean;
}

export type CreditKind = "oneoff" | "monthly";
export type CreditCategory = "apps" | "computer";

/** Money credit for one category (Instant Apps or computers), in millionths of a dollar. */
export interface Money {
    kind: CreditKind;
    availableMicros: number;
    totalMicros: number;
    inProgressMicros: number;
    /** When a monthly credit renews; none for a one-off */
    renewsAt: string | null;
    asked: boolean;
    canAskForMore: boolean;
    /** The balance could not be read: the page says so, with no bar */
    unavailable: boolean;
}

/** Extra credit someone has: what it covers, what is left, when it ends. One amount for everything it covers. */
export interface ExtraCredit {
    covers: CreditCategory[];
    availableMicros: number;
    totalMicros: number;
    until: string | null;
    /** Who gave it; none means Universe */
    fromName: string | null;
}

/** What one of the person's Bricks spent this month, and on what. */
export interface BotSpend {
    id: string;
    name: string;
    spentMicros: number;
    uses: CreditCategory[];
}

export type ActivityState = "done" | "refunded";
/** How a task came to end: every action worked, some did (partly done), or none did. */
export type ActivityOutcome = "done" | "partial" | "refunded";
export type ActivityPayer = "you" | "universe" | "sponsor";

/** One line of a receipt: what was used and what it took ("Nothing" is a note). */
export interface ReceiptLine {
    label: string;
    amountMicros: number | null;
    note: string | null;
}

/** What Orbit says of a line whose price is not known yet. The page says it as "amount unavailable", never as a number or as "Nothing". */
export const PRICE_NOT_KNOWN = "Price not known yet";

/** One Instant action of a task and how it ended. Only the App and the outcome: never what was asked or answered. */
export interface ActivityAction {
    label: string;
    outcome: "worked" | "failed";
    /** "Gmail · didn't work" (Orbit's words) */
    text: string;
    /** "Nothing taken" for an action that did not work; null for one that did */
    takenText: string | null;
    /** What this one action took, when Orbit says (a failed one took nothing); null when it does not say */
    amountMicros: number | null;
}

/** One task, in Activity. */
export interface ActivityItem {
    id: string;
    title: string;
    at: string;
    state: ActivityState;
    /** What it took from the person's credit; null when nothing */
    spentMicros: number | null;
    category: CreditCategory | null;
    payer: ActivityPayer;
    payerName: string | null;
    lines: ReceiptLine[];
    /** How the task came to end. `state` stays "done" for a task that partly worked, since something worked. */
    outcome: ActivityOutcome;
    /** Orbit's sentence under a partly done receipt ("Two steps worked and one didn't. Nothing was taken for the one that didn't."); null otherwise */
    outcomeNote: string | null;
    /** Each Instant action of the task; empty for a task with none (an older Orbit, or a computer's) */
    actions: ActivityAction[];
}

/** This month's computer time. Only for someone whose Brick uses a computer. */
export interface ComputerUsage {
    left: number;
    words: UsageWords;
    startsAgainAt: string;
    /** They asked and the Universe team has not answered yet. */
    asked: boolean;
    /** "Ask for more" is only offered once the month's time is used up. */
    canAskForMore: boolean;
    /** The computer allowance in dollars; null from an older Orbit, which sends only the bar and its words */
    money: Money | null;
}

export interface MyUsage {
    /** Orbit's stamp: a bigger one is newer, and an older answer never replaces a newer one. null when it sent none. */
    version: number | null;
    chat: ChatUsage;
    /** Instant Apps; null when there is none to show */
    apps: Money | null;
    computer: ComputerUsage | null;
    /** Extra credit, only while someone has it */
    credit: ExtraCredit[];
    bots: BotSpend[];
    activity: ActivityItem[];
    /** What their Bricks keep, in bytes. */
    storageBytes: number | null;
    /** Who pays for it; Universe says so on the page */
    storagePaidByUniverse: boolean;
    /** While extra usage runs: the day it ends. */
    extraUntil: string | null;
}

const WORDS: UsageWords[] = ["plenty", "half", "low", "out"];
/** Activity is read up to here, however many Orbit sends */
const ACTIVITY_MAX = 50;
const BOTS_MAX = 50;
const LINES_MAX = 12;
/** Names and titles are one short line each */
const TEXT_MAX = 120;

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);

function words(value: unknown): UsageWords | undefined {
    return typeof value === "string" && (WORDS as string[]).includes(value) ? (value as UsageWords) : undefined;
}

function fraction(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function when(value: unknown): string | null {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const micros = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
const short = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, TEXT_MAX) : undefined;
const categories = (value: unknown): CreditCategory[] =>
    (Array.isArray(value) ? value : []).filter(
        (item, index, all): item is CreditCategory =>
            (item === "apps" || item === "computer") && all.indexOf(item) === index
    );

/** The words for a bar that has none: the same cut-offs Orbit uses (a fifth, a half). */
function usageWordsOf(left: number): UsageWords {
    return left <= 0 ? "out" : left <= 0.2 ? "low" : left > 0.5 ? "plenty" : "half";
}

function parseReplies(value: unknown): Replies | null {
    if (!isRaw(value)) return null;
    const available = count(value.available);
    const total = count(value.total);
    if (available === undefined || total === undefined) return null;
    return {
        available: Math.min(available, total),
        total,
        inProgress: count(value.inProgress) ?? 0,
        running: value.running === true,
        windowHours: count(value.windowHours) || null,
    };
}

function parseChatExtra(value: unknown): ChatExtra | null {
    if (!isRaw(value)) return null;
    const noLimit = value.noLimit === true;
    const multiplier = typeof value.multiplier === "number" && value.multiplier > 1 ? value.multiplier : null;
    if (!noLimit && multiplier === null) return null;
    return { multiplier: noLimit ? null : multiplier, noLimit, until: when(value.until) };
}

/** Money for Instant Apps or computers. A balance that cannot be read still says so, with no numbers to show. */
function parseMoney(value: unknown): Money | null {
    if (!isRaw(value)) return null;
    const unavailable = value.unavailable === true;
    const availableMicros = micros(value.availableMicros);
    const totalMicros = micros(value.totalMicros);
    if (!unavailable && (availableMicros === undefined || totalMicros === undefined)) return null;
    return {
        kind: value.kind === "oneoff" ? "oneoff" : "monthly",
        availableMicros: availableMicros ?? 0,
        totalMicros: totalMicros ?? 0,
        inProgressMicros: micros(value.inProgressMicros) ?? 0,
        renewsAt: when(value.renewsAt),
        asked: value.asked === true,
        canAskForMore: value.canAskForMore === true,
        unavailable,
    };
}

function parseCredit(value: unknown): ExtraCredit[] {
    if (!Array.isArray(value)) return [];
    const out: ExtraCredit[] = [];
    for (const item of value) {
        if (!isRaw(item)) continue;
        const covers = categories(item.covers);
        const availableMicros = micros(item.availableMicros);
        const totalMicros = micros(item.totalMicros);
        if (covers.length === 0 || availableMicros === undefined || totalMicros === undefined) continue;
        out.push({
            covers,
            availableMicros: Math.min(availableMicros, totalMicros),
            totalMicros,
            until: when(item.until),
            fromName: short(item.fromName) ?? null,
        });
    }
    return out;
}

function parseBots(value: unknown): BotSpend[] {
    if (!Array.isArray(value)) return [];
    const out: BotSpend[] = [];
    for (const item of value) {
        if (!isRaw(item)) continue;
        const id = short(item.id);
        const name = short(item.name);
        const spentMicros = micros(item.spentMicros);
        if (!id || !name || spentMicros === undefined) continue;
        out.push({ id, name, spentMicros, uses: categories(item.uses) });
        if (out.length >= BOTS_MAX) break;
    }
    return out;
}

function parseLines(value: unknown): ReceiptLine[] {
    if (!Array.isArray(value)) return [];
    const out: ReceiptLine[] = [];
    for (const item of value) {
        if (!isRaw(item)) continue;
        const label = short(item.label);
        if (!label) continue;
        out.push({ label, amountMicros: micros(item.amountMicros) ?? null, note: short(item.note) ?? null });
        if (out.length >= LINES_MAX) break;
    }
    return out;
}

const ACTIONS_MAX = 20;

function parseActions(value: unknown): ActivityAction[] {
    if (!Array.isArray(value)) return [];
    const out: ActivityAction[] = [];
    for (const item of value) {
        if (!isRaw(item)) continue;
        const label = short(item.label);
        const text = short(item.text);
        if (!label || !text || (item.outcome !== "worked" && item.outcome !== "failed")) continue;
        out.push({
            label,
            outcome: item.outcome,
            text,
            // A failed action took nothing, whatever else it says
            takenText: item.outcome === "failed" ? short(item.takenText) ?? null : null,
            amountMicros: item.outcome === "failed" ? null : micros(item.amountMicros) ?? null,
        });
        if (out.length >= ACTIONS_MAX) break;
    }
    return out;
}

function parseActivity(value: unknown): ActivityItem[] {
    if (!Array.isArray(value)) return [];
    const out: ActivityItem[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!isRaw(item)) continue;
        const id = typeof item.id === "string" && /^[\w-]{1,64}$/.test(item.id) ? item.id : undefined;
        const title = short(item.title);
        const at = when(item.at);
        // One task that cannot be read is left out, never the whole list
        if (!id || !title || !at) continue;
        // A receipt has one row: the same id twice is one task (its first row), never two rows that open the same receipt
        if (seen.has(id)) continue;
        seen.add(id);
        // A task the system is still looking up (an older Orbit may send it as "checking") is not a state anyone can act on: it is
        // left out and shows when it has settled
        if (item.state === "checking") continue;
        const state = item.state === "refunded" ? "refunded" : "done";
        const actions = parseActions(item.actions);
        // Partly done needs a step that worked and one that did not; an older Orbit that sends neither is done or refunded as before
        const partly =
            state !== "refunded" &&
            item.outcome === "partial" &&
            actions.some((action) => action.outcome === "worked") &&
            actions.some((action) => action.outcome === "failed");
        out.push({
            id,
            title,
            at,
            state,
            outcome: state === "refunded" ? "refunded" : partly ? "partial" : "done",
            outcomeNote: partly ? short(item.outcomeNote) ?? null : null,
            actions,
            spentMicros: micros(item.spentMicros) ?? null,
            category: item.category === "apps" || item.category === "computer" ? item.category : null,
            payer: item.payer === "universe" ? "universe" : item.payer === "sponsor" ? "sponsor" : "you",
            payerName: short(item.payerName) ?? null,
            lines: parseLines(item.lines),
        });
        if (out.length >= ACTIVITY_MAX) break;
    }
    return out;
}

/** The answer of `/api/me/usage`; undefined when it is not one (the page then says it could not read it). */
export function parseUsage(value: unknown): MyUsage | undefined {
    if (!isRaw(value)) return undefined;
    const { chat, computer, storage, extra } = value;
    const chatRaw = isRaw(chat) ? chat : undefined;
    const chatUnavailable = chatRaw?.unavailable === true;
    const chatLeft = fraction(chatRaw?.left);
    const chatWords = words(chatRaw?.words);
    const replies = parseReplies(chatRaw?.replies);
    // A bar from replies Orbit counted, or from the older bar and its words, or a balance that could not be read
    if (!chatUnavailable && !replies && (chatLeft === undefined || chatWords === undefined)) return undefined;
    const barLeft = replies ? (replies.total > 0 ? replies.available / replies.total : 0) : chatLeft ?? 0;

    let computerUsage: ComputerUsage | null = null;
    const computerRaw = isRaw(computer) ? computer : undefined;
    if (computerRaw) {
        const money = parseMoney(computerRaw);
        // A balance that could not be read has no bar: it still makes the section, which says so
        const left =
            money && !money.unavailable ? moneyLeft(money) : fraction(computerRaw.left) ?? (money ? 0 : undefined);
        const computerWords = words(computerRaw.words) ?? (left !== undefined ? usageWordsOf(left) : undefined);
        const startsAgainAt = when(computerRaw.startsAgainAt) ?? money?.renewsAt ?? null;
        if (left !== undefined && computerWords !== undefined && (startsAgainAt || money)) {
            computerUsage = {
                left,
                words: computerWords,
                startsAgainAt: startsAgainAt ?? "",
                asked: computerRaw.asked === true,
                canAskForMore: computerRaw.canAskForMore === true,
                money,
            };
        }
    }

    const bytes = (isRaw(storage) ? storage : {}).bytes;
    const stamp = value.version;
    return {
        version: typeof stamp === "number" && Number.isFinite(stamp) ? stamp : null,
        chat: {
            left: Math.min(1, Math.max(0, barLeft)),
            words: chatWords ?? usageWordsOf(barLeft),
            fullAgainAt: when(chatRaw?.fullAgainAt),
            replies,
            extra: parseChatExtra(chatRaw?.extra),
            unavailable: chatUnavailable,
        },
        apps: parseMoney(value.apps),
        computer: computerUsage,
        credit: parseCredit(value.credit),
        bots: parseBots(value.bots),
        activity: parseActivity(value.activity),
        storageBytes: typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : null,
        storagePaidByUniverse: isRaw(storage) && storage.payer === "universe",
        extraUntil: when(isRaw(extra) ? extra.until : undefined),
    };
}

/**
 * The time a bar is full again: "8:40 PM" for today, with the day in front on any other day. Empty for a time that
 * cannot be read.
 */
export function fullAgainWhen(at: string | null, locale: string | undefined, now: Date = new Date()): string {
    if (!at) return "";
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    if (date.toDateString() === now.toDateString()) return time;
    const day = date.toLocaleDateString(locale?.toLowerCase().startsWith("en") ? "en-GB" : locale, {
        day: "numeric",
        month: "short",
    });
    return `${day}, ${time}`;
}

/** A size in plain units: "1.4 GB", "230 MB", "0 B". The units are the same in every language. */
export function storageSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = Math.max(0, bytes);
    let unit = 0;
    while (size >= 1000 && unit < units.length - 1) {
        size /= 1000;
        unit++;
    }
    const text = unit === 0 || size >= 100 ? Math.round(size).toString() : size.toFixed(1).replace(/\.0$/, "");
    return `${text} ${units[unit]}`;
}

const CENT = 10_000;

function dollarText(cents: number, locale: string | undefined): string {
    const whole = cents % 100 === 0;
    try {
        return new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: whole ? 0 : 2,
            maximumFractionDigits: whole ? 0 : 2,
        }).format(cents / 100);
    } catch {
        return `$${whole ? String(cents / 100) : (cents / 100).toFixed(2)}`;
    }
}

/**
 * What is available, in dollars, cut down to the cent so it never claims more than the server will admit: "$3.20", "$2",
 * "$0". Whole dollars carry no cents.
 */
export function availableText(microsValue: number, locale: string | undefined): string {
    return dollarText(Math.floor(Math.max(0, microsValue) / CENT), locale);
}

/** What was taken, rounded up to the cent so it never understates: "$0.06", "$0.92". Something taken is never "$0.00". */
export function spentText(microsValue: number, locale: string | undefined): string {
    return dollarText(Math.ceil(Math.max(0, microsValue) / CENT), locale);
}

/** More than nothing and less than one cent: said as that, never as "$0" or "$0.01". */
export const isUnderACent = (microsValue: number): boolean => microsValue > 0 && microsValue < CENT;

/**
 * What is available, as the page says it: "Less than $0.01" for a positive amount under a cent (it is not "$0": something is
 * there), otherwise cut down to the cent as `availableText` does. `tiny` is the words for the amount under a cent.
 */
export function availableLabel(microsValue: number, locale: string | undefined, tiny: string): string {
    return isUnderACent(microsValue) ? tiny : availableText(microsValue, locale);
}

/**
 * What was taken, as the page says it: "less than $0.01" for a positive amount under a cent (it is not "$0.01": that is more than
 * was taken), "$0" for a true zero, otherwise rounded up to the cent as `spentText` does.
 */
export function spentLabel(microsValue: number, locale: string | undefined, tiny: string): string {
    return isUnderACent(microsValue) ? tiny : spentText(microsValue, locale);
}

/**
 * The bar of a money credit: what is left of what it was, 0 to 1. Both sides are whole cents cut down the same way as the
 * words ("$0.01 of $0.01" is a full bar), so the bar never disagrees with the line beside it.
 */
export function moneyLeft(money: Pick<Money, "availableMicros" | "totalMicros">): number {
    if (money.totalMicros <= 0) return 0;
    const total = Math.max(1, Math.floor(money.totalMicros / CENT));
    return Math.min(1, Math.max(0, Math.floor(money.availableMicros / CENT) / total));
}

/** Whether less than a cent is left: the credit is used up. */
export const moneyUsedUp = (money: Pick<Money, "availableMicros">): boolean => money.availableMicros < CENT;

/**
 * When a monthly credit renews, in the viewer's clock: the day ("1 Dec") and the time ("3:00 AM"). Undefined for a time that
 * cannot be read.
 */
export function renewsWhen(at: string | null, locale: string | undefined): { day: string; time: string } | undefined {
    if (!at) return undefined;
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return undefined;
    const day = date.toLocaleDateString(locale?.toLowerCase().startsWith("en") ? "en-GB" : locale, {
        day: "numeric",
        month: "short",
    });
    return { day, time: date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) };
}
