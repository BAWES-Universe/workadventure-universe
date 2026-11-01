import type { MatrixClient, MatrixEvent, User } from "matrix-js-sdk";
import { SetPresence, UserEvent } from "matrix-js-sdk";
import type { Readable } from "svelte/store";
import { readable } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";
import type { ChatPresence, ChatUser } from "../ChatConnection";
import { matrixAvatarStore } from "./MatrixMedia";

export const chatUserFactory: (matrixChatUser: User, matrixClient: MatrixClient) => ChatUser = (
    matrixChatUser,
    matrixClient
) => {
    return {
        chatId: matrixChatUser.userId,
        username: matrixChatUser.rawDisplayName,
        roomName: undefined,
        playUri: undefined,
        pictureStore: matrixAvatarStore(matrixClient, matrixChatUser.avatarUrl, 48),
        color: undefined,
        spaceUserId: undefined,
        availabilityStatus: livePresenceStore(matrixChatUser, matrixClient),
    };
};

/**
 * Their chat status, followed live: someone who leaves chat reads as offline in the People list too, as the direct chat
 * header already says, instead of keeping the status they had when the list was first built.
 */
export function livePresenceStore(matrixChatUser: User, matrixClient: MatrixClient): Readable<AvailabilityStatus> {
    const userId = matrixChatUser.userId;
    // The SDK keeps one User per account and updates its presence in place.
    const current = () => mapMatrixPresenceToAvailabilityStatus(matrixChatUser.presence);
    return readable<AvailabilityStatus>(current(), (set) => {
        set(current());
        const onPresence = (_event: MatrixEvent | undefined, user: User) => {
            if (user.userId === userId) set(mapMatrixPresenceToAvailabilityStatus(user.presence));
        };
        matrixClient.on(UserEvent.Presence, onPresence);
        return () => {
            matrixClient.off(UserEvent.Presence, onPresence);
        };
    });
}

export function mapMatrixPresenceToAvailabilityStatus(presence: string = SetPresence.Offline): AvailabilityStatus {
    switch (presence) {
        case SetPresence.Offline:
            return AvailabilityStatus.UNCHANGED;
        case SetPresence.Online:
            return AvailabilityStatus.ONLINE;
        case SetPresence.Unavailable:
            return AvailabilityStatus.AWAY;
        //TODO : use SetPresence.Busy after matrix-js-sdk update
        //case SetPresence.Busy:
        case "busy":
            return AvailabilityStatus.BUSY;
        default:
            console.error(`Do not handle the status ${presence}`);
            return AvailabilityStatus.UNCHANGED;
    }
}

/** Online on chat from any app; "busy" and unavailable both read as away. */
export function toChatPresence(presence: string | undefined): ChatPresence {
    if (presence === SetPresence.Online) return "online";
    if (presence === SetPresence.Unavailable || presence === "busy") return "away";
    return "offline";
}
