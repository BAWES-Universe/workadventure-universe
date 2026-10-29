import { derived, get, readable, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { tick } from "svelte";
import { hasPins, type ChatMessage, type ChatRoom, type ChatRoomPins } from "../../../Connection/ChatConnection";
import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
import { drawEveryHeldMessage } from "../DrawnMessages";

export type PinAction = "pin" | "unpin";

/**
 * Whether a message in the open chat can be pinned or unpinned by this person, for its menus. Nothing for a chat
 * without pins (nearby chat) or for someone who may not pin there.
 */
export function pinActionOf(message: ChatMessage): Readable<PinAction | undefined> {
    return derived(selectedRoomStore, (room, set) => {
        if (!hasPins(room)) {
            set(undefined);
            return;
        }
        return derived([room.canPinMessages, room.pinnedMessageIds], ([$canPin, $pinned]) =>
            $canPin ? ($pinned.includes(message.id) ? "unpin" : "pin") : undefined
        ).subscribe(set);
    });
}

/** Pins or unpins a message of the open chat. */
export async function runPinAction(message: ChatMessage, action: PinAction): Promise<void> {
    const room = get(selectedRoomStore);
    if (!hasPins(room)) return;
    await room.setMessagePinned(message.id, action === "pin");
}

const FETCH_RETRY_MS = 3000;
// The wait between tries grows to this many times FETCH_RETRY_MS (30 seconds), then stays there.
const MAX_RETRY_STEPS = 10;

/** The server says the message isn't there (deleted for good, or never seen by this person). */
function isNotFound(error: unknown): boolean {
    const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
    return status === 404 || status === 403;
}

export interface PinnedEntry {
    id: string;
    /** Undefined while a pinned message that is not loaded is fetched, or when it can't be found any more. */
    message: ChatMessage | undefined;
}

const pinnedEntriesByRoom = new WeakMap<ChatRoom, Readable<PinnedEntry[]>>();

/**
 * The chat's pinned messages, the most recently pinned first. One already loaded is used as it is; an older one is
 * fetched on its own, once for the chat rather than each time its profile or details open (#1585). A deleted one is
 * left out.
 */
export function pinnedEntriesStore(room: ChatRoom & ChatRoomPins): Readable<PinnedEntry[]> {
    let entries = pinnedEntriesByRoom.get(room);
    if (!entries) {
        entries = makePinnedEntriesStore(room);
        pinnedEntriesByRoom.set(room, entries);
    }
    return entries;
}

function makePinnedEntriesStore(room: ChatRoom & ChatRoomPins): Readable<PinnedEntry[]> {
    const fetched = writable(new Map<string, ChatMessage | null>());
    const messages: Readable<readonly ChatMessage[]> = { subscribe: (run) => room.messages.subscribe(run) };
    const asking = new Set<string>();
    const failures = new Map<string, number>();
    return derived([room.pinnedMessageIds, messages, fetched], ([$ids, $messages, $fetched], set) => {
        const loaded = new Map($messages.map((message) => [message.id, message]));
        const entries: PinnedEntry[] = [];
        for (const id of [...$ids].reverse()) {
            const message = loaded.get(id) ?? $fetched.get(id) ?? undefined;
            if (!message && !$fetched.has(id) && !asking.has(id)) {
                asking.add(id);
                room.getMessageById(id)
                    .then(
                        (found) => {
                            asking.delete(id);
                            fetched.update((map) => new Map(map).set(id, found ?? null));
                        },
                        (error: unknown) => {
                            if (isNotFound(error)) {
                                asking.delete(id);
                                fetched.update((map) => new Map(map).set(id, null));
                                return;
                            }
                            // Offline for a moment: asked again a little later, less and less often.
                            const tries = (failures.get(id) ?? 0) + 1;
                            failures.set(id, tries);
                            setTimeout(() => {
                                asking.delete(id);
                                fetched.update((map) => new Map(map));
                            }, FETCH_RETRY_MS * Math.min(tries, MAX_RETRY_STEPS));
                        }
                    )
                    .catch((error) => console.error(error));
            }
            if ($fetched.get(id) === null && !loaded.has(id)) continue;
            entries.push({ id, message });
        }
        const deletions = entries.map((entry) => entry.message?.isDeleted ?? readable(false));
        return derived(deletions, ($deleted) => entries.filter((_, index) => !$deleted[index])).subscribe(set);
    });
}

const MAX_LOADS_TO_FIND = 10;

/**
 * Scrolls the conversation to a message and flashes it, as tapping a quote does. A message further back is loaded
 * first, a page at a time. Returns whether it was found.
 */
export async function jumpToMessage(room: ChatRoom, messageId: string): Promise<boolean> {
    const find = () => document.querySelector(`[data-event-id="${CSS.escape(messageId)}"]`);
    // Loaded but not drawn yet (a long chat that just opened draws its older messages a little later).
    if (!find()) await drawEveryHeldMessage();
    let target = find();
    for (let load = 0; !target && load < MAX_LOADS_TO_FIND && get(room.hasPreviousMessage); load++) {
        // eslint-disable-next-line no-await-in-loop
        await room.loadMorePreviousMessages();
        // eslint-disable-next-line no-await-in-loop
        await tick();
        target = find();
    }
    if (!(target instanceof HTMLElement)) return false;
    flashMessage(target);
    return true;
}

export function flashMessage(target: HTMLElement): void {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.remove("quote-flash");
    void target.offsetWidth;
    target.classList.add("quote-flash");
    setTimeout(() => target.classList.remove("quote-flash"), 1600);
}
