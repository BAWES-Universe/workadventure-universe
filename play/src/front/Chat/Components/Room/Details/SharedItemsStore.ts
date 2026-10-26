import { derived, get } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ChatMessage, ChatRoom } from "../../../Connection/ChatConnection";
import { getSaveableFiles } from "../MessageActions/messageActions";
import { sharedItemsOf, type SharedItems } from "./SharedItems";

/**
 * What the chat shared among the messages loaded so far, kept up to date as messages arrive, are edited or deleted.
 * Only text messages are listened to (their links can change with an edit): listening to a picture or file message
 * would download it. A gallery (nearby chat only) carries its links in the open, so reading it downloads nothing.
 */
export function sharedItemsStore(room: ChatRoom): Readable<SharedItems> {
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
            ...(message.type === "text" || message.type === "proximity"
                ? [
                      message.content.subscribe(() => {
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
