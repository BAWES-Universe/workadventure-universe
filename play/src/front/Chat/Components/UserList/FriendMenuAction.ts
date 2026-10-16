import type { ComponentType } from "svelte";
import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import type { Relationship } from "../../Stores/FriendsStore";
import { runFriendAction } from "./FriendActions";
import { IconCheck, IconUserMinus, IconUserPlus, IconX } from "@wa-icons";

export interface FriendMenuAction {
    label: string;
    icon: ComponentType;
    danger: boolean;
    act: () => void;
}

/**
 * The one friends entry of a person's menu or card, from how you stand with them: Add friend, Cancel friend
 * request, Accept friend request or Remove friend. Nothing for someone you blocked (Settings › Friends undoes it)
 * or who blocked you.
 */
export function friendMenuAction(
    relationship: Relationship,
    uuid: string,
    userName: string,
    ll: TranslationFunctions
): FriendMenuAction | undefined {
    const run = (action: "request" | "cancel" | "accept" | "remove") => () => {
        runFriendAction(uuid, userName, action).catch((e) => console.error(e));
    };
    switch (relationship) {
        case "none":
            return { label: ll.chat.friends.addFriend(), icon: IconUserPlus, danger: false, act: run("request") };
        case "request_sent":
            return { label: ll.chat.friends.cancelRequest(), icon: IconX, danger: false, act: run("cancel") };
        case "request_received":
            return { label: ll.chat.friends.acceptRequest(), icon: IconCheck, danger: false, act: run("accept") };
        case "friends":
            return { label: ll.chat.friends.removeFriend(), icon: IconUserMinus, danger: true, act: run("remove") };
        default:
            return undefined;
    }
}
