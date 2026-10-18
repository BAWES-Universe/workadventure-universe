/**
 * Runs of messages: one person's messages close together show their name and time once, on a label above the first.
 * Discord groups the same way: by author, a few minutes, and the day.
 */

/** A message from the same person this long after the previous one starts a new run, with its own time. */
export const RUN_GAP_MS = 7 * 60 * 1000;

export interface RunItem {
    id: string;
    date: Date | null;
    /**
     * Who wrote it ("me" for your own). Undefined for a notice (a divider, someone joining), or when the writer isn't
     * known yet: it stands alone, with its own label.
     */
    senderKey: string | undefined;
    /** A reply starts a new run, so the quote never sits under someone else's label. */
    isReply: boolean;
}

export interface RunPlace {
    /** First message of its run: it shows the label (name and time) and the face. */
    runStart: boolean;
}

/**
 * Who wrote a message, for runs. The name is part of it: scripted messages and unknown people all share the
 * placeholder chat id "0", so two of them must not merge into one run. A writer not loaded yet has no key: two such
 * messages may be from different people.
 */
export function runSenderKey(sender: { chatId?: string; username?: string } | undefined): string | undefined {
    return sender ? `${sender.chatId ?? ""}|${sender.username ?? ""}` : undefined;
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
        places.set(item.id, { runStart });
        previous = item;
        if (day !== undefined) previousDay = day;
    }
    return places;
}
