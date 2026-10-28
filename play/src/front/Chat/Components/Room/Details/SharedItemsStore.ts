import { derived, get } from "svelte/store";
import type { Readable, Unsubscriber } from "svelte/store";
import type { ChatMessage, ChatRoom } from "../../../Connection/ChatConnection";
import { getSaveableFiles } from "../MessageActions/messageActions";
import { sharedItemsOf, type SharedItems } from "./SharedItems";
import { mergeShared } from "./NearbySaved";
import { nearbySavedFor } from "./NearbySavedStore";

/**
 * What the chat shared among the messages loaded so far, kept up to date as messages arrive, are edited or deleted.
 * Only text messages are listened to (their links can change with an edit): listening to a picture or file message
 * would download it. A gallery (nearby chat only) carries its links in the open, so reading it downloads nothing.
 */
export function sharedItemsStore(room: ChatRoom): Readable<SharedItems> {
    const live = liveSharedItemsStore(room);
    // The nearby chat forgets what it showed when the tab closes: what was kept on the player's account joins in.
    const saved = nearbySavedFor(room);
    return saved ? derived([live, saved.items], ([$live, $saved]) => mergeShared($live, $saved)) : live;
}

function liveSharedItemsStore(room: ChatRoom): Readable<SharedItems> {
    // The room's list is an array store: derived() would take it for an array of stores.
    const messages: Readable<readonly ChatMessage[]> = { subscribe: (run) => room.messages.subscribe(run) };
    return derived(messages, ($messages, set) => {
        const build = () =>
            set(
                sharedItemsOf(
                    $messages,
                    (message) => get(message.content).body,
                    (message) => get(message.isDeleted),
                    (message) => getSaveableFiles(message.type, get(message.content))
                )
            );
        let ready = false;
        const unsubscribers = $messages.flatMap((message) => [
            message.isDeleted.subscribe(() => {
                if (ready) build();
            }),
            ...(isText(message)
                ? [
                      listenToText(message, () => {
                          if (ready) build();
                      }),
                  ]
                : []),
        ]);
        ready = true;
        build();
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    });
}

/**
 * Listens to a text message's content. One that turns out to be a picture or file once decrypted is let go at once,
 * before it would start its download: listening on would count as it being shown.
 */
function listenToText(message: ChatMessage, changed: () => void): Unsubscriber {
    let stop: Unsubscriber | undefined;
    let stopped = false;
    const unsubscribe = () => {
        stopped = true;
        stop?.();
        stop = undefined;
    };
    stop = message.content.subscribe(() => {
        if (!isText(message)) unsubscribe();
        changed();
    });
    if (stopped) unsubscribe();
    return unsubscribe;
}

function isText(message: ChatMessage): boolean {
    return message.type === "text" || message.type === "proximity";
}
