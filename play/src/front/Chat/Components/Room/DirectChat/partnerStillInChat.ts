import type { Readable } from "svelte/store";
import { derived } from "svelte/store";
import type { ChatRoomMember, ChatRoomMembership } from "../../../Connection/ChatConnection";

/** Someone who is joined, or invited and so able to join, still has the chat. */
export function holdsTheChat(membership: ChatRoomMembership): boolean {
    return membership === "join" || membership === "invite";
}

/**
 * Whether the other person of a direct chat still has the room. False once they have left it: deleting the chat
 * then leaves nobody in it. True while the members are not known yet, so the usual text shows rather than a wrong one.
 */
export function partnerStillInChat(
    members: Readable<ChatRoomMember[]>,
    myChatId: string | null | undefined
): Readable<boolean> {
    return derived(
        members,
        (all, set) => {
            const others = all.filter((member) => member.id !== myChatId);
            if (others.length === 0) {
                set(true);
                return;
            }
            return derived(
                others.map((member) => member.membership),
                (memberships) => memberships.some(holdsTheChat)
            ).subscribe(set);
        },
        true
    );
}
