/**
 * A person's usage (game #1999), as Orbit's `/api/me/usage` sends it: one bar and plain words, never a count of replies
 * and never a price. Nothing in here talks to a server or reads a store, so every rule can be unit tested.
 */

export type UsageWords = "plenty" | "half" | "low" | "out";

/** What Universe AI gives the person for text and voice together. */
export interface ChatUsage {
    /** What is left, 0 to 1: the bar. */
    left: number;
    words: UsageWords;
    /** When the bar is full again; none when no window is running. */
    fullAgainAt: string | null;
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
}

export interface MyUsage {
    chat: ChatUsage;
    computer: ComputerUsage | null;
    /** What their Bricks keep, in bytes. */
    storageBytes: number | null;
    /** While extra usage runs: the day it ends. */
    extraUntil: string | null;
}

const WORDS: UsageWords[] = ["plenty", "half", "low", "out"];

function words(value: unknown): UsageWords | undefined {
    return typeof value === "string" && (WORDS as string[]).includes(value) ? (value as UsageWords) : undefined;
}

function fraction(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

function when(value: unknown): string | null {
    return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

/** The answer of `/api/me/usage`; undefined when it is not one (the page then shows what it could not read). */
export function parseUsage(value: unknown): MyUsage | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { chat, computer, storage, extra } = value as Record<string, unknown>;
    const chatRaw = chat as Record<string, unknown> | null | undefined;
    const chatLeft = fraction(chatRaw?.left);
    const chatWords = words(chatRaw?.words);
    if (chatLeft === undefined || chatWords === undefined) return undefined;

    let computerUsage: ComputerUsage | null = null;
    const computerRaw = computer as Record<string, unknown> | null | undefined;
    if (computerRaw && typeof computerRaw === "object") {
        const left = fraction(computerRaw.left);
        const computerWords = words(computerRaw.words);
        const startsAgainAt = when(computerRaw.startsAgainAt);
        if (left !== undefined && computerWords !== undefined && startsAgainAt) {
            computerUsage = {
                left,
                words: computerWords,
                startsAgainAt,
                asked: computerRaw.asked === true,
                canAskForMore: computerRaw.canAskForMore === true,
            };
        }
    }

    const bytes = (storage as { bytes?: unknown } | null | undefined)?.bytes;
    return {
        chat: { left: chatLeft, words: chatWords, fullAgainAt: when(chatRaw?.fullAgainAt) },
        computer: computerUsage,
        storageBytes: typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : null,
        extraUntil: when((extra as { until?: unknown } | null | undefined)?.until),
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
