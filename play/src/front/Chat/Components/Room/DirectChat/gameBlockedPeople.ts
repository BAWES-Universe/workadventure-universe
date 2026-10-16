import type { Readable } from "svelte/store";
import { readable } from "svelte/store";
import { blackListManager } from "../../../../WebRtc/BlackListManager";

/**
 * The account ids of the people blocked in the game (from the meeting's Moderation menu, or because they are blocked in
 * chat). Follows the game's block and unblock, so what shows or hides on a block does not need the chat reopened.
 */
export const gameBlockedPeople: Readable<ReadonlySet<string>> = readable<ReadonlySet<string>>(new Set(), (set) => {
    const update = () => set(new Set(blackListManager.getBlackListedUsers()));
    update();
    const subscriptions = [
        blackListManager.onBlockStream.subscribe(update),
        blackListManager.onUnBlockStream.subscribe(update),
    ];
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
});
