import { readable, type Readable } from "svelte/store";
import type { BotAvailability } from "./BotChatStatus";

/** How long a bot's state is trusted before it is asked again. */
const STATUS_TTL_MS = 60 * 1000;

type Fetch = (botIds: string[]) => Promise<Record<string, string> | null>;

interface Entry {
    value: BotAvailability | undefined;
    at: number;
    listeners: Set<(value: BotAvailability | undefined) => void>;
}

/** Bot states, fetched in one request per tick for every bot asked about at once, and kept for a minute. */
export class BotStatusCache {
    private entries = new Map<string, Entry>();
    private pending = new Set<string>();
    private flushing: Promise<void> | undefined;

    constructor(private fetchStatus: Fetch, private now: () => number = Date.now) {}

    store(botId: string): Readable<BotAvailability | undefined> {
        return readable<BotAvailability | undefined>(this.entries.get(botId)?.value, (set) => {
            const entry = this.entry(botId);
            entry.listeners.add(set);
            set(entry.value);
            if (this.now() - entry.at >= STATUS_TTL_MS) this.request(botId);
            return () => entry.listeners.delete(set);
        });
    }

    /**
     * A bot said it is gone or resting in a note: show that now, without waiting for the next lookup. A note older
     * than what the cache already knows (a lookup made after it) changes nothing, and an old one is checked again on
     * the next look.
     */
    learn(botId: string, value: BotAvailability, at: number = this.now()): void {
        const entry = this.entry(botId);
        if (at < entry.at) return;
        entry.at = at;
        this.publish(entry, value);
    }

    private entry(botId: string): Entry {
        let entry = this.entries.get(botId);
        if (!entry) {
            entry = { value: undefined, at: -Infinity, listeners: new Set() };
            this.entries.set(botId, entry);
        }
        return entry;
    }

    private publish(entry: Entry, value: BotAvailability | undefined): void {
        entry.value = value;
        for (const listener of entry.listeners) listener(value);
    }

    private request(botId: string): void {
        this.pending.add(botId);
        this.flushing ??= Promise.resolve().then(() => this.flush());
    }

    private async flush(): Promise<void> {
        const ids = [...this.pending].slice(0, 50);
        for (const id of ids) this.pending.delete(id);
        const states = await this.fetchStatus(ids).catch(() => null);
        for (const id of ids) {
            const entry = this.entry(id);
            // A failed lookup is retried on the next look, and keeps showing what was known.
            if (!states) continue;
            entry.at = this.now();
            const value = states[id];
            this.publish(
                entry,
                value === "online" || value === "resting" || value === "unready" || value === "gone" ? value : undefined
            );
        }
        this.flushing = undefined;
        if (this.pending.size > 0) this.flushing = Promise.resolve().then(() => this.flush());
    }
}
