import { derived, get, readable, writable } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import LL from "../../../../../i18n/i18n-svelte";
import { UPLOADER_URL } from "../../../../Enum/EnvironmentVariable";
import { botApiService } from "../../../../external-modules/bots/services/BotApiService";
import type { ChatMessage, ChatRoom, ChatRoomMember } from "../../../Connection/ChatConnection";
import { localUserStore } from "../../../../Connection/LocalUserStore";
import { ProximityChatRoom, type ProximityChatMessage } from "../../../Connection/Proximity/ProximityChatRoom";
import { getSaveableFiles } from "../MessageActions/messageActions";
import { savedItemsOf, savedRowsOf, type SavedNearbyItem } from "./NearbySaved";
import { sharedItemsOf, type SharedItems } from "./SharedItems";

/**
 * What the nearby chat shared, kept on the player's account (#1424): what the chat shows is sent to Orbit as it
 * arrives, with who else was there. A person's direct chat reads back what you and they shared nearby (#1615) and
 * lists it beside its own. Guests keep nothing.
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
            if (!saved) {
                retry();
                return;
            }
            batch.forEach((row) => retried.delete(row));
            forgetPeopleIn(batch);
        })
        .catch(retry);
}

// Messages that arrived before the game knew the player's account (the bots module starts with the map): kept as
// soon as it does, or let go if the player turns out to be a guest.
const MAX_WAITING = 500;
const waiting = new Map<ChatMessage, readonly string[]>();
botApiService.onInitialize(() => {
    const messages = Array.from(waiting);
    waiting.clear();
    if (botApiService.canKeepNearbyShared()) messages.forEach(([message, present]) => keep(message, present));
});

/** Keeps what a message shared. `present` are the chat accounts of the others in the chat when it came. */
function keep(message: ChatMessage, present: readonly string[]): void {
    if (!botApiService.canKeepNearbyShared()) {
        if (waiting.size < MAX_WAITING) waiting.set(message, present);
        return;
    }
    const shared = sharedItemsOf(
        [message],
        (one) => get(one.content).body,
        () => false,
        (one) => getSaveableFiles(one.type, get(one.content))
    );
    const rows = savedRowsOf(
        shared,
        (item) => get(item.message.content).url,
        get(LL).chat.details.you(),
        new Date(),
        present
    ).filter((row) => !sentKeys.has(row.itemKey));
    if (rows.length === 0) return;
    rows.forEach((row) => sentKeys.add(row.itemKey));
    queue.push(...rows);
    sendTimer ??= setTimeout(flush, SEND_DELAY_MS);
}

function presentChatIds(room: ProximityChatRoom): string[] {
    if (!room.participants) return [];
    return get(room.participants).flatMap((participant) => (participant.chatId ? [participant.chatId] : []));
}

function isConversation(message: ProximityChatMessage): boolean {
    return !message.session && !message.notSent && message.type !== "incoming" && message.type !== "outcoming";
}

interface Settling {
    timer?: ReturnType<typeof setTimeout>;
    unsubscribe?: Unsubscriber;
}

/** Sends what this nearby chat shows to the player's account as it arrives. Returns how to stop. */
export function keepNearbyShared(room: ProximityChatRoom): Unsubscriber {
    const watched = new Set<ChatMessage>();
    const settling = new Map<ChatMessage, Settling>();

    // A text can still grow after a pause (a slow reply, an edit), so each quiet spell keeps what is new in it.
    const settle = (message: ChatMessage, present: readonly string[]) => {
        const entry: Settling = {};
        settling.set(message, entry);
        entry.unsubscribe = message.content.subscribe(() => {
            clearTimeout(entry.timer);
            entry.timer = setTimeout(() => keep(message, present), SETTLE_MS);
        });
    };

    const unsubscribeMessages = room.messages.subscribe((messages) => {
        for (const message of messages as ProximityChatMessage[]) {
            if (watched.has(message)) continue;
            watched.add(message);
            if (!isConversation(message)) continue;
            // Who was there when it came, before anyone walks off while a reply is still arriving.
            const present = presentChatIds(room);
            if (message.type === "text" || message.type === "proximity") settle(message, present);
            else keep(message, present);
        }
    });

    return () => {
        unsubscribeMessages();
        for (const { timer, unsubscribe } of settling.values()) {
            clearTimeout(timer);
            unsubscribe?.();
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

export interface NearbySaved {
    items: Readable<SharedItems>;
    /** An older page is kept in Orbit. */
    hasMore: Readable<boolean>;
    loadMore: () => Promise<void>;
}

const EMPTY: SharedItems = { media: [], links: [], files: [] };

/** One person's kept items, read from Orbit the first time they're asked for, one page at a time. */
function savedWith(chatId: string, name: string | undefined): NearbySaved {
    const state = writable<NearbySavedState>({ rows: [], next: null, loaded: false, loading: false });

    async function loadPage(first: boolean): Promise<void> {
        const current = get(state);
        if (current.loading || (!first && !current.next)) return;
        state.update((value) => ({ ...value, loading: true }));
        const page = await botApiService.getNearbyShared(first ? undefined : current.next ?? undefined, {
            chatId,
            name,
        });
        state.update((value) => {
            // Not read this time: asked again when the profile next opens, or on "Look further back".
            if (!page) return { ...value, loading: false };
            const rows = first ? page.items : [...value.rows, ...page.items];
            return { rows, next: page.next, loaded: true, loading: false };
        });
    }

    const items = derived(state, ($state) => savedItemsOf($state.rows, UPLOADER_URL), EMPTY);
    return {
        items: {
            subscribe(run) {
                if (!get(state).loaded && botApiService.canKeepNearbyShared()) {
                    loadPage(true).catch((error) => console.error("Failed to read the kept nearby items", error));
                }
                return items.subscribe(run);
            },
        },
        hasMore: derived(state, ($state) => $state.next !== null),
        loadMore: () => loadPage(false),
    };
}

// One list per person for the tab: their profile opens again without asking Orbit again.
const MAX_PEOPLE = 50;
const byPerson = new Map<string, NearbySaved>();

/** The people a batch was shared with read their list from Orbit again, the next time their profile opens. */
function forgetPeopleIn(rows: readonly SavedNearbyItem[]): void {
    for (const row of rows) {
        if (row.senderChatId) byPerson.delete(row.senderChatId);
        row.withChatIds?.forEach((chatId) => byPerson.delete(chatId));
    }
}

function savedFor(chatId: string, name: string | undefined): NearbySaved {
    let saved = byPerson.get(chatId);
    if (!saved) {
        if (byPerson.size >= MAX_PEOPLE) byPerson.delete(byPerson.keys().next().value as string);
        saved = savedWith(chatId, name);
        byPerson.set(chatId, saved);
    }
    return saved;
}

/** The other person of a direct chat, by chat account, with the name the chat knows them by. */
function partnerOf(room: ChatRoom): Readable<{ chatId: string; name: string } | undefined> {
    const members = "members" in room ? (room as { members: Readable<ChatRoomMember[]> }).members : undefined;
    if (!members) return readable(undefined);
    const me = localUserStore.getChatId();
    return derived(members, ($members, set) => {
        const partner = $members.find((member) => member.id !== me);
        if (!partner) {
            set(undefined);
            return;
        }
        return partner.name.subscribe((name) => set({ chatId: partner.id, name }));
    });
}

/**
 * For a direct chat: what you and the other person shared in proximity chats, kept on your account (#1615). Nothing for
 * any other chat: a proximity chat lists only what it shows, and a group chat only its own messages.
 */
export function nearbySavedFor(room: ChatRoom): NearbySaved | undefined {
    if (room instanceof ProximityChatRoom || room.type !== "direct") return undefined;
    const partner = partnerOf(room);
    const current = derived(partner, ($partner) => ($partner ? savedFor($partner.chatId, $partner.name) : undefined));
    return {
        items: derived(current, ($saved, set) => ($saved ? $saved.items.subscribe(set) : set(EMPTY)), EMPTY),
        hasMore: derived(current, ($saved, set) => ($saved ? $saved.hasMore.subscribe(set) : set(false)), false),
        loadMore: () => get(current)?.loadMore() ?? Promise.resolve(),
    };
}
