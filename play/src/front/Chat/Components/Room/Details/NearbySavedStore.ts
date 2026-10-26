import { derived, get, writable } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import LL from "../../../../../i18n/i18n-svelte";
import { UPLOADER_URL } from "../../../../Enum/EnvironmentVariable";
import { botApiService } from "../../../../external-modules/bots/services/BotApiService";
import type { ChatMessage, ChatRoom } from "../../../Connection/ChatConnection";
import { ProximityChatRoom, type ProximityChatMessage } from "../../../Connection/Proximity/ProximityChatRoom";
import { getSaveableFiles } from "../MessageActions/messageActions";
import { savedItemsOf, savedRowsOf, type SavedNearbyItem } from "./NearbySaved";
import { sharedItemsOf, type SharedItems } from "./SharedItems";

/**
 * The nearby chat's "Media, links and files" kept on the player's account (#1424): what the chat shows is sent to
 * Orbit as it arrives, and what was kept from before is read back when the chat's details open. Guests keep nothing.
 */

// A text message is kept once its text has stopped changing (a bot's reply arrives a few words at a time).
const SETTLE_MS = 4000;
const SEND_DELAY_MS = 2000;
const SEND_BATCH = 50;

// Keys already sent from this tab: the chat's history comes along to the next map, and isn't sent again.
const sentKeys = new Set<string>();
const queue: SavedNearbyItem[] = [];
let sendTimer: ReturnType<typeof setTimeout> | undefined;

// Rows that already failed once: they get one more try, with the next batch.
const retried = new Set<SavedNearbyItem>();

function flush(): void {
    sendTimer = undefined;
    const batch = queue.splice(0, SEND_BATCH);
    if (queue.length > 0) sendTimer = setTimeout(flush, SEND_DELAY_MS);
    if (batch.length === 0) return;
    const retry = () => {
        const again: SavedNearbyItem[] = [];
        for (const row of batch) {
            if (retried.delete(row)) continue;
            retried.add(row);
            again.push(row);
        }
        if (again.length === 0) return;
        queue.unshift(...again);
        sendTimer ??= setTimeout(flush, SEND_DELAY_MS * 5);
    };
    botApiService
        .saveNearbyShared(batch)
        .then((saved) => {
            if (saved) batch.forEach((row) => retried.delete(row));
            else retry();
        })
        .catch(retry);
}

function keep(message: ChatMessage): void {
    if (!botApiService.canKeepNearbyShared()) return;
    const shared = sharedItemsOf(
        [message],
        (one) => get(one.content).body,
        () => false,
        (one) => getSaveableFiles(one.type, get(one.content))
    );
    const rows = savedRowsOf(shared, (item) => get(item.message.content).url, get(LL).chat.details.you()).filter(
        (row) => !sentKeys.has(row.itemKey)
    );
    if (rows.length === 0) return;
    rows.forEach((row) => sentKeys.add(row.itemKey));
    queue.push(...rows);
    sendTimer ??= setTimeout(flush, SEND_DELAY_MS);
}

function isConversation(message: ProximityChatMessage): boolean {
    return !message.session && !message.notSent && message.type !== "incoming" && message.type !== "outcoming";
}

/** Sends what this nearby chat shows to the player's account as it arrives. Returns how to stop. */
export function keepNearbyShared(room: ProximityChatRoom): Unsubscriber {
    const watched = new Set<ChatMessage>();
    const settling = new Map<ChatMessage, { timer: ReturnType<typeof setTimeout>; unsubscribe: Unsubscriber }>();

    const settle = (message: ChatMessage) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
            settling.get(message)?.unsubscribe();
            settling.delete(message);
            keep(message);
        };
        const unsubscribe = message.content.subscribe(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(done, SETTLE_MS);
            const entry = settling.get(message);
            if (entry) entry.timer = timer;
        });
        if (timer) settling.set(message, { timer, unsubscribe });
    };

    const unsubscribeMessages = room.messages.subscribe((messages) => {
        for (const message of messages as ProximityChatMessage[]) {
            if (watched.has(message)) continue;
            watched.add(message);
            if (!isConversation(message)) continue;
            if (message.type === "text" || message.type === "proximity") settle(message);
            else keep(message);
        }
    });

    return () => {
        unsubscribeMessages();
        for (const { timer, unsubscribe } of settling.values()) {
            clearTimeout(timer);
            unsubscribe();
        }
        settling.clear();
    };
}

interface NearbySavedState {
    rows: SavedNearbyItem[];
    next: string | null;
    loaded: boolean;
    loading: boolean;
}

const savedState = writable<NearbySavedState>({ rows: [], next: null, loaded: false, loading: false });

async function loadPage(first: boolean): Promise<void> {
    const state = get(savedState);
    if (state.loading || (!first && !state.next)) return;
    savedState.update((current) => ({ ...current, loading: true }));
    const page = await botApiService.getNearbyShared(first ? undefined : state.next ?? undefined);
    savedState.update((current) => {
        // Not read this time: asked again when the details next open, or on "Look further back".
        if (!page) return { ...current, loading: false };
        const rows = first ? page.items : [...current.rows, ...page.items];
        return { rows, next: page.next, loaded: true, loading: false };
    });
}

/** What was kept from the nearby chats before this tab, as items; it is read from Orbit the first time it's asked for. */
const savedItems: Readable<SharedItems> = derived(savedState, ($state) => savedItemsOf($state.rows, UPLOADER_URL), {
    media: [],
    links: [],
    files: [],
} as SharedItems);

export interface NearbySaved {
    items: Readable<SharedItems>;
    /** An older page is kept in Orbit. */
    hasMore: Readable<boolean>;
    loadMore: () => Promise<void>;
}

const nearbySaved: NearbySaved = {
    items: {
        subscribe(run) {
            if (!get(savedState).loaded && botApiService.canKeepNearbyShared()) {
                loadPage(true).catch((error) => console.error("Failed to read the kept nearby items", error));
            }
            return savedItems.subscribe(run);
        },
    },
    hasMore: derived(savedState, ($state) => $state.next !== null),
    loadMore: () => loadPage(false),
};

/** For the nearby chat: what it shared before this tab, kept on the player's account. Nothing for any other chat. */
export function nearbySavedFor(room: ChatRoom): NearbySaved | undefined {
    return room instanceof ProximityChatRoom ? nearbySaved : undefined;
}
