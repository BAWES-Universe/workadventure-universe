import { readable, type Readable } from "svelte/store";
import type { BotAvailability } from "./BotChatStatus";

/** How long a bot's state is trusted before it is asked again. */
const STATUS_TTL_MS = 60 * 1000;
/** Most bots one lookup asks about; it is the bot server's limit too. */
const BATCH_MAX = 50;
/** How often the bots still on screen are checked for an answer older than a minute. */
const REFRESH_EVERY_MS = STATUS_TTL_MS / 2;

type Fetch = (botIds: string[]) => Promise<Record<string, string> | null>;

interface Entry {
    value: BotAvailability | undefined;
    /** The moment the shown value is about: when its lookup started, or when its note was written. */
    asOf: number;
    /** When the bot server was last asked (when that lookup started), for the one-minute trust. */
    askedAt: number;
    /** The last note taken in, so the same note seen again (the chat re-reads its messages) is not taken in twice. */
    lastNote: { value: BotAvailability; at: number } | undefined;
    /** When the newest note applied was written; a lookup that started before it cannot replace it. */
    noteAt: number;
    /** A lookup for this bot is on its way. */
    asking: boolean;
    listeners: Set<(value: BotAvailability | undefined) => void>;
}

/** Bot states, fetched in one request per tick for every bot asked about at once, and kept for a minute. */
export class BotStatusCache {
    private entries = new Map<string, Entry>();
    private pending = new Set<string>();
    private flushing: Promise<void> | undefined;
    /** Re-asks while anything is shown, so an open chat moves on from a state that changed (or was wrong) by itself. */
    private refresher: ReturnType<typeof setInterval> | undefined;
    private watching = 0;

    constructor(private fetchStatus: Fetch, private now: () => number = Date.now) {}

    store(botId: string): Readable<BotAvailability | undefined> {
        return readable<BotAvailability | undefined>(this.entries.get(botId)?.value, (set) => {
            const entry = this.entry(botId);
            entry.listeners.add(set);
            set(entry.value);
            if (this.now() - entry.askedAt >= STATUS_TTL_MS) this.request(botId, entry);
            this.watching++;
            this.refresher ??= setInterval(() => this.refresh(), REFRESH_EVERY_MS);
            return () => {
                entry.listeners.delete(set);
                this.watching--;
                if (this.watching === 0 && this.refresher) {
                    clearInterval(this.refresher);
                    this.refresher = undefined;
                }
            };
        });
    }

    /** Every bot still on screen whose answer is a minute old is asked about again, in one lookup. */
    private refresh(): void {
        for (const [botId, entry] of this.entries) {
            if (entry.listeners.size > 0 && this.now() - entry.askedAt >= STATUS_TTL_MS) this.request(botId, entry);
        }
    }

    /**
     * A bot said it is gone, resting or not ready in a note: show that now, without waiting for the next lookup.
     * `at` is when the note was written, on this device's clock (as the lookups are), not the homeserver's. A note written before the latest lookup started changes nothing (the lookup
     * knows better), and a lookup that started before the note, even if it answers later, cannot replace it. A note
     * written at the very moment a lookup started counts as the newer.
     */
    learn(botId: string, value: BotAvailability, at: number = this.now()): void {
        const entry = this.entry(botId);
        // The chat reads the same last note again whenever its messages change: only the first sighting counts.
        if (entry.lastNote?.at === at && entry.lastNote.value === value) return;
        entry.lastNote = { value, at };
        // A clock ahead of ours cannot make a note newer than this moment.
        const writtenAt = Math.min(at, this.now());
        if (writtenAt < entry.asOf) return;
        entry.asOf = writtenAt;
        entry.noteAt = writtenAt;
        this.publish(entry, value);
    }

    private entry(botId: string): Entry {
        let entry = this.entries.get(botId);
        if (!entry) {
            entry = {
                value: undefined,
                asOf: -Infinity,
                askedAt: -Infinity,
                lastNote: undefined,
                noteAt: -Infinity,
                asking: false,
                listeners: new Set(),
            };
            this.entries.set(botId, entry);
        }
        return entry;
    }

    private publish(entry: Entry, value: BotAvailability | undefined): void {
        entry.value = value;
        for (const listener of entry.listeners) listener(value);
    }

    private request(botId: string, entry: Entry): void {
        // A lookup already under way will answer for this look too.
        if (entry.asking) return;
        this.pending.add(botId);
        this.flushing ??= Promise.resolve().then(() => this.flush());
    }

    private async flush(): Promise<void> {
        const ids = [...this.pending].slice(0, BATCH_MAX);
        for (const id of ids) {
            this.pending.delete(id);
            this.entry(id).asking = true;
        }
        const startedAt = this.now();
        const states = await Promise.resolve()
            .then(() => this.fetchStatus(ids))
            .catch(() => null);
        for (const id of ids) {
            const entry = this.entry(id);
            entry.asking = false;
            // A failed lookup is retried on the next look, and keeps showing what was known.
            if (!states) continue;
            entry.askedAt = startedAt;
            // A note as new as the lookup, or newer, is kept: the lookup was started before it was written.
            if (entry.noteAt >= startedAt) continue;
            entry.asOf = startedAt;
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
