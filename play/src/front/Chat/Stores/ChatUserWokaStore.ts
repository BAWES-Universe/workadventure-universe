import { derived, readable } from "svelte/store";
import type { Readable } from "svelte/store";
import { Color } from "@workadventure/shared-utils";
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
    return createByChatIdStore(merger, indexWokasByChatId);
}

/**
 * The colour each known person's woka sits on in People, by chat id: the one the game gives them from their name.
 * The first entry with a colour wins, like the wokas.
 */
export function indexColoursByChatId(usersByRoom: UsersByRoom): Map<string, string> {
    const colours = new Map<string, string>();
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (!user.chatId || !user.color?.startsWith("#") || colours.has(user.chatId)) continue;
            colours.set(user.chatId, user.color);
        }
    }
    return colours;
}

/** Woka colours by chat id, empty until the game scene's user providers are ready. */
export function createColourByChatIdStore(merger: Promise<UserProviderMerger>): Readable<Map<string, string>> {
    return createByChatIdStore(merger, indexColoursByChatId);
}

function createByChatIdStore<T>(
    merger: Promise<UserProviderMerger>,
    index: (usersByRoom: UsersByRoom) => Map<string, T>
): Readable<Map<string, T>> {
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
            return $merger.usersByRoomStore.subscribe((usersByRoom) => set(index(usersByRoom)));
        },
        new Map<string, T>()
    );
}

/** Context key under which the chat list shares one woka lookup with its rows. */
export const WOKA_BY_CHAT_ID_CONTEXT = Symbol("wokaByChatId");

/**
 * The one picture rule for a person everywhere in the chat: their woka as the game sees it right now, else the
 * picture their chat account carries, else nothing (the caller shows a letter). Every place picks the same way, so a
 * person never shows two different pictures.
 */
export function personPicture(
    wokas: Map<string, PictureStore>,
    chatId: string | undefined,
    accountPicture: PictureStore | undefined
): PictureStore | undefined {
    return (chatId ? wokas.get(chatId) : undefined) ?? accountPicture;
}

/**
 * The colour a person's woka sits on, the same as in People: the one the game gave them, else the same rule applied to
 * the name we have for them (someone not in Universe right now).
 */
export function personColour(
    colours: Map<string, string>,
    chatId: string | undefined,
    name: string | undefined
): string | undefined {
    return (chatId ? colours.get(chatId) : undefined) ?? (name ? Color.getColorByString(name) : undefined);
}

/** A colour for a person's woka, by chat id and name, or nothing where the woka keeps its plain circle. */
export type PersonColourOf = (chatId: string | undefined, name: string | undefined) => string | undefined;

/** Context key under which a direct chat gives its header, profile and messages each person's People colour. */
export const PERSON_COLOUR_CONTEXT = Symbol("personColour");
