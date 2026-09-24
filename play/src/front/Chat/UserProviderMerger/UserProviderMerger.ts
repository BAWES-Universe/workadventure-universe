import { AvailabilityStatus } from "@workadventure/messages";
import type { Readable } from "svelte/store";
import { derived, writable } from "svelte/store";
import type { UserProviderInterface } from "../UserProvider/UserProviderInterface";
import type { AnyKindOfUser, ChatId, ChatUser, PartialAnyKindOfUser, UserUuid } from "../Connection/ChatConnection";

/**
 * Merges several UserProviders into one store that sorts users by room.
 */
export type playUri = string;

export class UserProviderMerger {
    usersByRoomStore: Readable<
        Map<
            playUri | undefined,
            {
                roomName: string | undefined;
                users: ChatUser[];
            }
        >
    >;

    constructor(private userProviders: UserProviderInterface[]) {
        this.usersByRoomStore = derived(
            this.userProviders.map((up) => up.users),
            (users) => {
                const usersByChatId = new Map<ChatId | UserUuid, PartialAnyKindOfUser[]>();

                // Step one: sort users by chatId
                for (const usersList of users) {
                    for (const user of usersList) {
                        const uniqueId = (user.chatId as ChatId) ?? (user.uuid as UserUuid);
                        if (!uniqueId) {
                            throw new Error("Impossible. A user must have at least a chatId or a uuid.");
                        }
                        const chatUserList = usersByChatId.get(uniqueId);
                        if (!chatUserList) {
                            usersByChatId.set(uniqueId, [user]);
                        } else {
                            chatUserList.push(user);
                        }
                    }
                }

                // Step 2: merge users with same chatId
                // Keyed by chat id or uuid, suffixed with the space user id for extra tabs of the same account.
                const mergedUsers = new Map<string, AnyKindOfUser>();
                for (const [uniqueId, chatUserList] of usersByChatId.entries()) {
                    for (const [key, entries] of splitBySpaceUser(uniqueId, chatUserList)) {
                        mergedUsers.set(key, mergeEntries(entries));
                    }
                }

                // Step 3: sort users by room
                const usersByRoom = new Map<
                    playUri | undefined,
                    {
                        roomName: string | undefined;
                        users: AnyKindOfUser[];
                    }
                >();
                for (const user of mergedUsers.values()) {
                    const playUri = user.playUri;
                    const usersInRoom = usersByRoom.get(playUri);
                    if (usersInRoom) {
                        usersInRoom.users.push(user);
                    } else {
                        usersByRoom.set(playUri, {
                            roomName: user.roomName,
                            users: [user],
                        });
                    }
                }

                return usersByRoom;
            },
            new Map()
        );
    }

    setFilter(searchText: string): Promise<void[]> {
        return Promise.all(this.userProviders.map((userProvider) => userProvider.setFilter(searchText)));
    }
}

/**
 * One account can be in the world several times, once per open tab (a "clone"). Each tab has its own space user id.
 * Entries sharing a chat id or uuid are merged into one person, except that each distinct space user id stays a
 * separate person, so clones see and can reach each other. Entries without a space user id (chat or admin data)
 * are merged into every clone.
 */
function splitBySpaceUser(
    uniqueId: ChatId | UserUuid,
    entries: PartialAnyKindOfUser[]
): [string, PartialAnyKindOfUser[]][] {
    const spaceUserIds = new Set<string>();
    for (const entry of entries) {
        if (entry.spaceUserId) spaceUserIds.add(entry.spaceUserId);
    }
    if (spaceUserIds.size <= 1) {
        return [[uniqueId, entries]];
    }
    const result: [string, PartialAnyKindOfUser[]][] = [];
    let first = true;
    for (const spaceUserId of spaceUserIds) {
        // The first clone keeps the plain id so that lookups by chat id or uuid behave as before.
        const key = first ? uniqueId : `${uniqueId}#${spaceUserId}`;
        first = false;
        result.push([key, entries.filter((entry) => !entry.spaceUserId || entry.spaceUserId === spaceUserId)]);
    }
    return result;
}

function mergeEntries(chatUserList: PartialAnyKindOfUser[]): AnyKindOfUser {
    const mergedUser = chatUserList.reduce((acc, user) => {
        return {
            chatId: user.chatId || acc.chatId,
            uuid: user.uuid || acc.uuid,
            username: user.username || acc.username,
            availabilityStatus: user.availabilityStatus || acc.availabilityStatus,
            pictureStore: user.pictureStore || acc.pictureStore,
            roomName: user.roomName || acc.roomName,
            playUri: user.playUri || acc.playUri,
            isAdmin: user.isAdmin || acc.isAdmin,
            isMember: user.isMember || acc.isMember,
            visitCardUrl: user.visitCardUrl || acc.visitCardUrl,
            color: user.color || acc.color,
            spaceUserId: user.spaceUserId || acc.spaceUserId,
        } as AnyKindOfUser;
    });

    const defaultUser = {
        chatId: undefined,
        username: "",
        pictureStore: writable(undefined),
        roomName: undefined,
        playUri: undefined,
        color: undefined,
        spaceUserId: undefined,
    };

    const fullUser = {
        ...defaultUser,
        ...mergedUser,
        username: mergedUser.username ?? "",
        availabilityStatus: mergedUser.availabilityStatus ?? writable(AvailabilityStatus.UNCHANGED),
    };

    return fullUser;
}
