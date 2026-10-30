import { derived, readable } from "svelte/store";
import type { Readable } from "svelte/store";
import { Color } from "@workadventure/shared-utils";
import type { ChatUser } from "../Connection/ChatConnection";
import type { PictureStore } from "../../Stores/PictureStore";
import type { UserProviderMerger } from "../UserProviderMerger/UserProviderMerger";
import type { ChatPerson } from "./ChatPeopleStore";
import { firstPicture } from "./ChatPeopleStore";

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

/**
 * The pictures behind an entry `withFetchedWokas` made: the world's own (if any) and Orbit's. `personPicture` reads it
 * so the chat account's picture comes before Orbit's Woka (Orbit's only fills in where the person has no chat picture).
 */
const fetchedParts = new WeakMap<PictureStore, { world: PictureStore | undefined; orbit: PictureStore }>();

/**
 * Adds what Orbit said about people outside the world: where the world has a picture for someone it keeps it, and
 * Orbit's Woka fills in when that has none (a letter, before); where the world knows nothing, Orbit's Woka is the picture.
 */
export function withFetchedWokas(
    wokas: Map<string, PictureStore>,
    fetched: Map<string, ChatPerson>
): Map<string, PictureStore> {
    let result = wokas;
    for (const [chatId, person] of fetched) {
        if (!person.picture) continue;
        if (result === wokas) result = new Map(wokas);
        const known = wokas.get(chatId);
        const picture = known ? firstPicture(known, person.picture) : person.picture;
        fetchedParts.set(picture, { world: known, orbit: person.picture });
        result.set(chatId, picture);
    }
    return result;
}

/**
 * Woka pictures by chat id, empty until the game scene's user providers are ready. With `fetched` (people the chat
 * asked Orbit about, who are not in the world) they fill in for people the world has no picture for.
 */
export function createWokaByChatIdStore(
    merger: Promise<UserProviderMerger>,
    fetched?: Readable<Map<string, ChatPerson>>
): Readable<Map<string, PictureStore>> {
    const wokas = createByChatIdStore(merger, indexWokasByChatId);
    return fetched ? derived([wokas, fetched], ([$wokas, $fetched]) => withFetchedWokas($wokas, $fetched)) : wokas;
}

/**
 * The name each known person goes by in Universe, by chat id: their name in the world right now, else the one the
 * world's member list has (the name picked in the game). The chat account's name is not in it: it is copied once when
 * the account is made and never follows a rename.
 */
export function indexNamesByChatId(usersByRoom: UsersByRoom): Map<string, string> {
    const names = new Map<string, string>();
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (!user.chatId || !user.gameName || names.has(user.chatId)) continue;
            names.set(user.chatId, user.gameName);
        }
    }
    return names;
}

/** Names in Universe by chat id; with `fetched`, people outside the world whom Orbit named fill in where the world has none. */
export function createNameByChatIdStore(
    merger: Promise<UserProviderMerger>,
    fetched?: Readable<Map<string, ChatPerson>>
): Readable<Map<string, string>> {
    const names = createByChatIdStore(merger, indexNamesByChatId);
    return fetched
        ? derived([names, fetched], ([$names, $fetched]) => {
              let result = $names;
              for (const [chatId, person] of $fetched) {
                  if (!person.name || $names.has(chatId)) continue;
                  if (result === $names) result = new Map($names);
                  result.set(chatId, person.name);
              }
              return result;
          })
        : names;
}

/** Context key under which the chat shares one lookup of names in Universe with its direct chats. */
export const NAME_BY_CHAT_ID_CONTEXT = Symbol("nameByChatId");

/**
 * The one name rule for a person in a direct chat: the name they go by in Universe now, else the chat room's name (so a
 * rename in the game shows in the chat, and someone Universe does not know keeps the name they had).
 */
export function personName(names: Map<string, string>, chatId: string | undefined, roomName: string): string {
    return (chatId ? names.get(chatId) : undefined) ?? roomName;
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
 * The one picture rule for a person everywhere in the chat: their woka as the world sees it (live, or saved in its
 * member list), else the picture their chat account carries (the Woka their own game saved, as Element shows it), else
 * the Woka Orbit describes for someone outside the world, else nothing (the caller shows a letter). Every place picks
 * the same way, so a person never shows two different pictures. The account picture also shows while the world's woka
 * has no picture: it is still being drawn, or its pictures can't be loaded (a saved Woka then stays empty instead of
 * the plain stand-in).
 */
export function personPicture(
    wokas: Map<string, PictureStore>,
    chatId: string | undefined,
    accountPicture: PictureStore
): PictureStore;
export function personPicture(
    wokas: Map<string, PictureStore>,
    chatId: string | undefined,
    accountPicture: PictureStore | undefined
): PictureStore | undefined;
export function personPicture(
    wokas: Map<string, PictureStore>,
    chatId: string | undefined,
    accountPicture: PictureStore | undefined
): PictureStore | undefined {
    const woka = chatId ? wokas.get(chatId) : undefined;
    if (!woka || !accountPicture) return woka ?? accountPicture;
    const parts = fetchedParts.get(woka);
    if (!parts) return firstPicture(woka, accountPicture);
    // Someone Orbit described: the chat account's picture comes before Orbit's Woka.
    const beforeOrbit = parts.world ? firstPicture(parts.world, accountPicture) : accountPicture;
    return firstPicture(beforeOrbit, parts.orbit);
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

/** Each person's People colour, as the chat list, a direct chat and a proximity chat show it. */
export function createPersonColourOf(merger: Promise<UserProviderMerger> | undefined): Readable<PersonColourOf> {
    if (!merger) return readable((chatId, name) => personColour(new Map(), chatId, name));
    return derived(
        createColourByChatIdStore(merger),
        ($colourByChatId) => (chatId: string | undefined, name: string | undefined) =>
            personColour($colourByChatId, chatId, name)
    );
}
