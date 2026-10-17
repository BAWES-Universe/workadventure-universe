/**
 * Runs of messages: one person's messages close together show their name and time once, on a label above the first.
 * Discord groups the same way: by author, a few minutes, and the day.
 */

/** A message from the same person this long after the previous one starts a new run, with its own time. */
export const RUN_GAP_MS = 7 * 60 * 1000;

export interface RunItem {
    id: string;
    date: Date | null;
    /** Who wrote it ("me" for your own), or undefined for a notice (a divider, someone joining): it ends a run. */
    senderKey: string | undefined;
    /** A reply starts a new run, so the quote never sits under someone else's label. */
    isReply: boolean;
}

export interface RunPlace {
    /** First message of its run: it shows the label (name and time) and the face. */
    runStart: boolean;
    /** First item of its day: a day label (Today, Yesterday, the date) goes above it. */
    dayStart: boolean;
}

function dayKey(date: Date | null): string | undefined {
    return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : undefined;
}

export function messageRuns(items: RunItem[]): Map<string, RunPlace> {
    const places = new Map<string, RunPlace>();
    let previous: RunItem | undefined;
    let previousDay: string | undefined;
    for (const item of items) {
        const day = dayKey(item.date);
        const dayStart = day !== undefined && day !== previousDay;
        const runStart =
            item.senderKey === undefined ||
            previous?.senderKey === undefined ||
            previous.senderKey !== item.senderKey ||
            dayStart ||
            item.isReply ||
            !item.date ||
            !previous.date ||
            item.date.getTime() - previous.date.getTime() >= RUN_GAP_MS;
        places.set(item.id, { runStart, dayStart });
        previous = item;
        if (day !== undefined) previousDay = day;
    }
    return places;
}

/** "Today", "Yesterday", then the date ("Fri 10 Oct", with the year when it isn't this year). */
export function dayLabel(date: Date, locale: string, now: Date = new Date()): string {
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const daysAgo = Math.round((startOf(now) - startOf(date)) / 86_400_000);
    if (daysAgo === 0 || daysAgo === 1) {
        const word = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-daysAgo, "day");
        return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
    }
    return date.toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    });
}
