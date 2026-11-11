import { derived, get, readable, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { localUserStore } from "../../Connection/LocalUserStore";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import type { PictureStore } from "../../Stores/PictureStore";
import { userIsConnected } from "../../Stores/MenuStore";
import type { ChatPerson } from "../Stores/ChatPeopleStore";
import { brickChatId, brickPictureUrl, parseBrickCard, parseBrickCards, type BrickCard } from "./Brick";

/**
 * The signed-in person's own Bricks (game #1995), as Orbit lists them: the one everyone gets, then the ones they made.
 * Undefined until Orbit answered once. Guests have none (their Brick is its own thing, #1997), so nothing is asked for
 * them.
 */
const bricks = writable<BrickCard[] | undefined>(undefined);
export const myBricksStore: Readable<BrickCard[] | undefined> = { subscribe: bricks.subscribe };

/** True once the first read has ended, whether Orbit answered or not: what waits for the Bricks can go on. */
const settled = writable(false);
export const myBricksSettled: Readable<boolean> = { subscribe: settled.subscribe };

let loading: Promise<void> | undefined;

async function load(): Promise<void> {
    // Orbit makes the Brick everyone gets the first time this account asks, and never again: asking is safe from every
    // device, as often as the chat opens. An account whose owner deleted it gets none.
    const own = (await botApiService.ensureMyBrick()) as { brick?: unknown } | null;
    const first = parseBrickCard(own?.brick);
    // The Bricks they made come with the list; when it can't be read, the one everyone gets still shows.
    const listed = await botApiService
        .listMyBricks()
        .then(parseBrickCards)
        .catch(() => undefined);
    bricks.set(listed ?? (first ? [first] : []));
}

/**
 * Reads the person's Bricks from Orbit. One request at a time; a failure leaves what was known and is tried again the
 * next time the chat list or the Bricks page opens. Resolves either way.
 */
export function loadMyBricks(): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    if (!loading) {
        loading = load()
            .catch((error: unknown) => console.warn("Could not read your Bricks", error))
            .finally(() => {
                loading = undefined;
                settled.set(true);
            });
    }
    return loading;
}

/**
 * Turns one of the person's Bricks on or off. The switch moves at once and goes back when Orbit refuses.
 * A Brick that is off stays in Chats and keeps its chat; it says it is resting instead of answering.
 */
export async function setMyBrickEnabled(brickId: string, enabled: boolean): Promise<boolean> {
    const before = get(bricks);
    const put = (change: (brick: BrickCard) => BrickCard) =>
        bricks.update((list) => list?.map((brick) => (brick.id === brickId ? change(brick) : brick)));
    put((brick) => ({ ...brick, enabled }));
    try {
        const saved = parseBrickCard(
            ((await botApiService.setBrickEnabled(brickId, enabled)) as { brick?: unknown })?.brick
        );
        if (saved) put(() => saved);
        return true;
    } catch (error) {
        console.warn("Could not turn a Brick on or off", error);
        const was = before?.find((brick) => brick.id === brickId);
        if (was) put((brick) => ({ ...brick, enabled: was.enabled }));
        return false;
    }
}

/** For tests and for a person who signs out without a reload. */
export function forgetMyBricks(): void {
    bricks.set(undefined);
    settled.set(false);
}

/** One picture store per picture, so a list that reads it again does not redraw. */
const pictures = new Map<string, PictureStore>();
export function brickPicture(look: string | null | undefined): PictureStore {
    const url = brickPictureUrl(look);
    let picture = pictures.get(url);
    if (!picture) {
        picture = readable<string | undefined>(url);
        pictures.set(url, picture);
    }
    return picture;
}

/** The person's Bricks by chat address, so the chat knows which of its direct chats are with one of them. */
export const myBricksByChatId: Readable<Map<string, BrickCard>> = derived(bricks, ($bricks) => {
    const byChatId = new Map<string, BrickCard>();
    const myChatId = localUserStore.getChatId();
    for (const brick of $bricks ?? []) {
        const chatId = brickChatId(brick.id, myChatId);
        if (chatId) byChatId.set(chatId, brick);
    }
    return byChatId;
});

/**
 * What the chat knows about people it only meets in a direct chat (their name and picture, asked of Orbit), with the
 * person's own Bricks added: a Brick stands in no room, so nothing else says what it looks like or is called now.
 */
export function withMyBricks(people: Readable<Map<string, ChatPerson>> | undefined): Readable<Map<string, ChatPerson>> {
    return derived([people ?? readable(new Map<string, ChatPerson>()), myBricksByChatId], ([$people, $byChatId]) => {
        if ($byChatId.size === 0) return $people;
        const all = new Map($people);
        for (const [chatId, brick] of $byChatId) {
            all.set(chatId, { name: brick.name, picture: brickPicture(brick.characterTextureId) });
        }
        return all;
    });
}
