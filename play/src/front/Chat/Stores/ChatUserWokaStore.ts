import { derived, readable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ChatUser } from "../Connection/ChatConnection";
import type { PictureStore } from "../../Stores/PictureStore";
import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";

type UsersByRoom = Map<string | undefined, { roomName: string | undefined; users: ChatUser[] }>;

/**
 * The woka of every known person, by chat id: people online in the world and the members the admin lists.
 * The first entry that has a picture wins, so a person with several tabs still gets one woka.
 */
export function indexWokasByChatId(usersByRoom: UsersByRoom): Map<string, PictureStore> {
    const wokas = new Map<string, PictureStore>();
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (!user.chatId || !user.pictureStore || wokas.has(user.chatId)) continue;
            wokas.set(user.chatId, user.pictureStore);
        }
    }
    return wokas;
}

/** Woka pictures by chat id, empty until the game scene's user providers are ready. */
export function createWokaByChatIdStore(merger: Promise<UserProviderMerger>): Readable<Map<string, PictureStore>> {
    return derived(
        readable<UserProviderMerger | undefined>(undefined, (set) => {
            let cancelled = false;
            merger
                .then((value) => {
                    if (!cancelled) set(value);
                })
                .catch((e) => console.error(e));
            return () => {
                cancelled = true;
            };
        }),
        ($merger, set) => {
            if (!$merger) {
                set(new Map());
                return;
            }
            return $merger.usersByRoomStore.subscribe((usersByRoom) => set(indexWokasByChatId(usersByRoom)));
        },
        new Map<string, PictureStore>()
    );
}

/** Context key under which the chat list shares one woka lookup with its rows. */
export const WOKA_BY_CHAT_ID_CONTEXT = Symbol("wokaByChatId");
