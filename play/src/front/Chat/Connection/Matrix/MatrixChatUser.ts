import type { MatrixClient, User } from "matrix-js-sdk";
import { SetPresence } from "matrix-js-sdk";
import { writable } from "svelte/store";
import { AvailabilityStatus } from "@workadventure/messages";
import type { ChatUser } from "../ChatConnection";
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
        availabilityStatus: writable(mapMatrixPresenceToAvailabilityStatus(matrixChatUser.presence)),
    };
};

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
