/**
 * A bot's usage, as Orbit tells the people who manage it (Orbit #491, mock v4 approved 20 Oct 2026): replies a day in
 * direct messages and nearby chat, who chatted by name with how much and when, guests as one count, what it ran on, and
 * how many people reached a reply limit (#1159). What anyone said is never part of it.
 */
export type UsageRange = "today" | "7d" | "30d";
/** The screens Usage's rows open */
export type UsageScreen = "people" | "ranOn" | "limits";
export const USAGE_RANGES: UsageRange[] = ["today", "7d", "30d"];

export interface UsageSplit {
    dm: number;
    nearby: number;
    /** Replies from before Orbit recorded where they were given */
    notSplit: number;
}

export interface UsagePerson extends UsageSplit {
    id: string;
    name: string | null;
    replies: number;
    lastAt: string;
}

export interface UsageRanOn {
    kind: "own-key" | "universe-ai";
    /** The key's name; null for Universe AI */
    name: string | null;
    keyType: string | null;
    replies: number;
    tokens: number;
    /** What the key's replies cost, in millionths of a dollar; null when no reply had a price */
    costMicros: number | null;
    unpricedReplies: number;
    firstAt: string;
    lastAt: string;
}

export interface BotUsage {
    range: UsageRange;
    days: string[];
    hasUsage: boolean;
    viewerIsMaker: boolean;
    totals: { replies: number; people: number; tokens: number };
    channels: UsageSplit;
    perDay: Array<UsageSplit & { day: string }>;
    people: UsagePerson[];
    guests: UsageSplit & { count: number; replies: number };
    ranOn: UsageRanOn[];
    keyProblem: { name: string; downSince: string; meanwhile: "universe-ai" | "stopped" } | null;
    limits: {
        universeAi: { signedIn: number; guest: number; guestPool: number; windowHours: number };
        botLimit: number | null;
        botLimitWindowHours: number;
        ranOut: { universeAi: number; botLimit: number };
        askedMaker: number;
    };
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const obj = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const split = (value: unknown): UsageSplit => {
    const o = obj(value);
    return { dm: num(o.dm), nearby: num(o.nearby), notSplit: num(o.notSplit) };
};

/** Orbit's answer as the page uses it. Anything missing reads as nothing, never as a broken page. */
export function readBotUsage(value: unknown): BotUsage {
    const o = obj(value);
    if (!Array.isArray(o.days) || !o.totals)
        throw new Error("Orbit answered with something the game does not understand");
    const totals = obj(o.totals);
    const guests = obj(o.guests);
    const limits = obj(o.limits);
    const universeAi = obj(limits.universeAi);
    const ranOut = obj(limits.ranOut);
    const keyProblem = o.keyProblem ? obj(o.keyProblem) : null;
    return {
        range: USAGE_RANGES.includes(o.range as UsageRange) ? (o.range as UsageRange) : "7d",
        days: o.days.filter((day): day is string => typeof day === "string"),
        hasUsage: o.hasUsage === true,
        viewerIsMaker: o.viewerIsMaker === true,
        totals: { replies: num(totals.replies), people: num(totals.people), tokens: num(totals.tokens) },
        channels: split(o.channels),
        perDay: (Array.isArray(o.perDay) ? o.perDay : []).map((entry) => ({
            day: str(obj(entry).day) ?? "",
            ...split(entry),
        })),
        people: (Array.isArray(o.people) ? o.people : []).flatMap((entry) => {
            const p = obj(entry);
            const id = str(p.id);
            return id
                ? [{ id, name: str(p.name), replies: num(p.replies), ...split(p), lastAt: str(p.lastAt) ?? "" }]
                : [];
        }),
        guests: { count: num(guests.count), replies: num(guests.replies), ...split(guests) },
        ranOn: (Array.isArray(o.ranOn) ? o.ranOn : []).map((entry) => {
            const r = obj(entry);
            return {
                kind: r.kind === "own-key" ? "own-key" : "universe-ai",
                name: str(r.name),
                keyType: str(r.keyType),
                replies: num(r.replies),
                tokens: num(r.tokens),
                costMicros: typeof r.costMicros === "number" ? r.costMicros : null,
                unpricedReplies: num(r.unpricedReplies),
                firstAt: str(r.firstAt) ?? "",
                lastAt: str(r.lastAt) ?? "",
            };
        }),
        keyProblem:
            keyProblem && str(keyProblem.downSince)
                ? {
                      name: str(keyProblem.name) ?? "",
                      downSince: str(keyProblem.downSince) ?? "",
                      meanwhile: keyProblem.meanwhile === "stopped" ? "stopped" : "universe-ai",
                  }
                : null,
        limits: {
            universeAi: {
                signedIn: num(universeAi.signedIn),
                guest: num(universeAi.guest),
                guestPool: num(universeAi.guestPool),
                windowHours: num(universeAi.windowHours),
            },
            botLimit: typeof limits.botLimit === "number" ? limits.botLimit : null,
            botLimitWindowHours: num(limits.botLimitWindowHours),
            ranOut: { universeAi: num(ranOut.universeAi), botLimit: num(ranOut.botLimit) },
            askedMaker: num(limits.askedMaker),
        },
    };
}

/** 873 stays 873, 873456 is 873k, 2400000 is 2.4M. */
export function compactNumber(value: number, locale: string): string {
    try {
        return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
    } catch {
        return String(value);
    }
}

/** An estimated amount in dollars, never less than a cent once something was spent. */
export function dollars(micros: number, locale: string): string {
    const amount = Math.max(micros / 1_000_000, micros > 0 ? 0.01 : 0);
    try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
            amount
        );
    } catch {
        return `$${amount.toFixed(2)}`;
    }
}

/** A day of the range ("2026-10-27") as its short weekday, or day and month when the range is longer than a week. */
export function dayLabel(day: string, range: UsageRange, locale: string): string {
    const date = new Date(`${day}T12:00:00Z`);
    try {
        return new Intl.DateTimeFormat(
            locale,
            range === "30d" ? { day: "numeric", timeZone: "UTC" } : { weekday: "short", timeZone: "UTC" }
        ).format(date);
    } catch {
        return day.slice(5);
    }
}

/**
 * When something last happened, in the viewer's clock: today with the time, yesterday, the weekday this week, else the
 * date. The page puts "today" and "yesterday" into words.
 */
export function whenLabel(
    at: string,
    locale: string,
    now: Date = new Date()
): { kind: "today" | "yesterday" | "other"; text: string } {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return { kind: "other", text: "" };
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    try {
        if (days <= 0) {
            return {
                kind: "today",
                text: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date),
            };
        }
        if (days === 1) return { kind: "yesterday", text: "" };
        if (days < 7)
            return { kind: "other", text: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date) };
        return {
            kind: "other",
            text: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date),
        };
    } catch {
        return { kind: "other", text: date.toLocaleDateString() };
    }
}

function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Where a person chatted, as one word for their row. */
export function whereKind(split: UsageSplit): "dm" | "nearby" | "both" | "notSplit" {
    if (split.dm > 0 && split.nearby > 0) return "both";
    if (split.dm > 0) return "dm";
    if (split.nearby > 0) return "nearby";
    return "notSplit";
}

/** The viewer's own time zone, so days start at their midnight. */
export function viewerTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/** The chart's frame: the bars sit between these, the day names under them. */
export const CHART = { width: 360, height: 170, left: 28, right: 354, top: 12, bottom: 144 };

export interface ChartBar {
    day: string;
    x: number;
    width: number;
    total: number;
    /** Bottom to top: direct messages, nearby chat, not split. Empty ones are left out. */
    parts: Array<{ kind: "dm" | "nearby" | "notSplit"; y: number; height: number; top: boolean }>;
}

/**
 * A round top for the scale: 7 becomes 8, 63 becomes 70, 340 becomes 400. Always even, so the middle line is a whole
 * number of replies too.
 */
export function niceMax(value: number): number {
    if (value <= 4) return Math.max(2, Math.ceil(value / 2) * 2);
    const step = 10 ** Math.floor(Math.log10(value));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10])
        if (m * step >= value && (m * step) % 2 === 0) return m * step;
    return 10 * step;
}

/** Stacked bars for replies a day: direct messages at the bottom, then nearby chat, then older replies not split. */
export function chartBars(perDay: BotUsage["perDay"]): { bars: ChartBar[]; max: number } {
    const max = niceMax(Math.max(0, ...perDay.map((d) => d.dm + d.nearby + d.notSplit)));
    const plot = CHART.bottom - CHART.top;
    const slot = (CHART.right - CHART.left) / Math.max(1, perDay.length);
    const width = Math.max(4, Math.min(26, slot * 0.6));
    const bars = perDay.map((d, i) => {
        let y = CHART.bottom;
        const kinds = (["dm", "nearby", "notSplit"] as const).filter((kind) => d[kind] > 0);
        const parts = kinds.map((kind, k) => {
            const height = (d[kind] / max) * plot;
            y -= height;
            return { kind, y, height, top: k === kinds.length - 1 };
        });
        return {
            day: d.day,
            x: CHART.left + slot * i + (slot - width) / 2,
            width,
            total: d.dm + d.nearby + d.notSplit,
            parts,
        };
    });
    return { bars, max };
}

/**
 * The bar of the day the bot moved to what it runs on now, when that happened inside the range and not on its last day:
 * the chart draws a dashed line after it.
 */
export function chartSwitchBar(usage: BotUsage, bars: ChartBar[]): ChartBar | undefined {
    if (usage.ranOn.length < 2) return undefined;
    const at = new Date(usage.ranOn[usage.ranOn.length - 1].firstAt);
    if (Number.isNaN(at.getTime())) return undefined;
    const day = localDay(at);
    const index = bars.findIndex((bar) => bar.day === day);
    return index >= 0 && index < bars.length - 1 ? bars[index] : undefined;
}

/** "2026-10-27" for a moment, in the viewer's own clock, as Orbit names the range's days */
function localDay(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The outline of one part of a bar, its top corners round when it is the top of the bar. */
export function barPath(x: number, y: number, width: number, height: number, roundTop: boolean): string {
    const r = roundTop ? Math.min(4, width / 2, height) : 0;
    const bottom = y + height;
    if (!r) return `M${x},${bottom} V${y} H${x + width} V${bottom} Z`;
    return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${
        y + r
    } V${bottom} Z`;
}
