import { get, writable } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import type { FriendAction } from "../../Stores/FriendsStore";
import { friendsStore } from "../../Stores/FriendsStore";

/** A short line at the top of the People list after a friend action that didn't go through. Clears itself. */
export const friendNoticeStore = writable<string | undefined>(undefined);

const NOTICE_MS = 6000;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function showFriendNotice(text: string): void {
    friendNoticeStore.set(text);
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => friendNoticeStore.set(undefined), NOTICE_MS);
}

const KNOWN_ERRORS = [
    "not_accepting_requests",
    "no_shared_world",
    "too_many_open_requests",
    "blocked",
    "rate_limited",
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

/** The words for a refused friend action. */
export function friendErrorText(code: string, userName: string): string {
    const errors = get(LL).chat.friends.errors;
    if ((KNOWN_ERRORS as readonly string[]).includes(code)) return errors[code as KnownError]({ userName });
    return errors.generic();
}

/** Sends a friend action; a refusal or a failure shows a notice. Resolves whether it went through. */
export async function runFriendAction(uuid: string, userName: string, action: FriendAction): Promise<boolean> {
    try {
        const answer = await friendsStore.act(uuid, action);
        if (answer.error) {
            showFriendNotice(friendErrorText(answer.error, userName));
            return false;
        }
        return true;
    } catch (e) {
        console.error("Friends: action failed", action, e);
        showFriendNotice(friendErrorText(e instanceof Error ? e.message : "", userName));
        return false;
    }
}
