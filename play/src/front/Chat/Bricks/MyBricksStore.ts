import { derived, get, readable, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { localUserStore } from "../../Connection/LocalUserStore";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { userIsConnected } from "../../Stores/MenuStore";
import type { BrickChange } from "../../external-modules/bots/types";
import type { ChatPerson } from "../Stores/ChatPeopleStore";
import {
    brickChatId,
    parseBrickCard,
    parseBrickCards,
    parseDeletedBricks,
    parseUndoDays,
    type BrickCard,
    type DeletedBrickCard,
} from "./Brick";
import { brickPicture } from "./BrickLookPicture";

export { brickPicture };

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

/** The Bricks the person deleted that can still be brought back (#1996), the one gone soonest first. */
const deleted = writable<DeletedBrickCard[]>([]);
export const myDeletedBricksStore: Readable<DeletedBrickCard[]> = { subscribe: deleted.subscribe };

/** How many days a deleted Brick waits, as Orbit last said. Undefined until it did: the page then names no day. */
const undoDays = writable<number | undefined>(undefined);
export const brickUndoDays: Readable<number | undefined> = { subscribe: undoDays.subscribe };

let loading: Promise<void> | undefined;

async function load(): Promise<void> {
    // Orbit makes the Brick everyone gets the first time this account asks, and never again: asking is safe from every
    // device, as often as the chat opens. An account whose owner deleted it gets none.
    const own = (await botApiService.ensureMyBrick()) as { brick?: unknown } | null;
    const first = parseBrickCard(own?.brick);
    // The Bricks they made come with the list; when it can't be read, the one everyone gets still shows.
    const list = await botApiService.listMyBricks().catch(() => undefined);
    refreshMyChatId();
    bricks.set(list === undefined ? (first ? [first] : []) : parseBrickCards(list));
    if (list !== undefined) {
        deleted.set(parseDeletedBricks(list));
        undoDays.set(parseUndoDays(list));
    }
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

/**
 * Saves a change from a Brick's own page (#1996): its name, line, Personality or switch. Its card in the list and in
 * Chats follows at once when Orbit saved it, and the bot server reads the Brick again now. False when it was not saved.
 */
export async function changeMyBrick(brickId: string, change: BrickChange): Promise<boolean> {
    try {
        const saved = parseBrickCard(
            ((await botApiService.changeMyBrick(brickId, change)) as { brick?: unknown })?.brick
        );
        if (saved) bricks.update((list) => list?.map((brick) => (brick.id === brickId ? saved : brick)));
        await botApiService.tellBrickChanged(brickId);
        return true;
    } catch (error) {
        console.warn("Could not save a change to a Brick", error);
        return false;
    }
}

/**
 * Makes another Brick (#1996): New Brick on the Bricks page. It is in the list, and so in Chats, as soon as Orbit made
 * it. Undefined when Orbit refused or could not be reached: nothing was made.
 */
export async function makeMyBrick(name: string, look: string): Promise<BrickCard | undefined> {
    try {
        const made = parseBrickCard(
            ((await botApiService.makeMyBrick({ name, characterTextureId: look })) as { brick?: unknown })?.brick
        );
        if (!made) return undefined;
        bricks.update((list) => [...(list ?? []).filter((brick) => brick.id !== made.id), made]);
        return made;
    } catch (error) {
        console.warn("Could not make a Brick", error);
        return undefined;
    }
}

/**
 * Deletes one of the person's Bricks (#1996). It leaves the list and Chats at once and waits under Deleted, where Undo
 * brings it back. False when Orbit refused: the Brick is still there.
 */
export async function deleteMyBrick(brickId: string): Promise<boolean> {
    try {
        const answer = (await botApiService.deleteMyBrick(brickId)) as { brick?: unknown };
        const gone = parseDeletedBricks({ deleted: [answer?.brick] })[0];
        bricks.update((list) => list?.filter((brick) => brick.id !== brickId));
        if (gone) deleted.update((list) => [...list.filter((brick) => brick.id !== brickId), gone]);
        // The bot server stops the Brick now, not within the minute
        await botApiService.tellBrickChanged(brickId);
        // The answer says the Brick but not always the day: the list does
        if (!gone) loadMyBricks().catch((error: unknown) => console.warn(error));
        return true;
    } catch (error) {
        console.warn("Could not delete a Brick", error);
        return false;
    }
}

/** Brings a deleted Brick back (#1996), with its chat and what it remembers. False when it could not be. */
export async function undoMyBrick(brickId: string): Promise<boolean> {
    try {
        const back = parseBrickCard(((await botApiService.undoMyBrick(brickId)) as { brick?: unknown })?.brick);
        deleted.update((list) => list.filter((brick) => brick.id !== brickId));
        if (back) bricks.update((list) => [...(list ?? []).filter((brick) => brick.id !== back.id), back]);
        await botApiService.tellBrickChanged(brickId);
        if (!back) loadMyBricks().catch((error: unknown) => console.warn(error));
        return true;
    } catch (error) {
        console.warn("Could not bring a Brick back", error);
        return false;
    }
}

/** For tests and for a person who signs out without a reload. */
export function forgetMyBricks(): void {
    bricks.set(undefined);
    deleted.set([]);
    undoDays.set(undefined);
    settled.set(false);
}

/**
 * The person's own chat address, which a Brick's chat address is made from. It is known only once the chat has signed
 * in, which can be after the Bricks were read: the chat says so (refreshMyChatId), and the addresses below follow.
 */
const myChatIdNow = writable<string | null>(null);

/** Reads the person's chat address again: called when the chat comes online and whenever the Bricks are read. */
export function refreshMyChatId(): void {
    myChatIdNow.set(localUserStore.getChatId());
}

/** The chat addresses of the Bricks that wait under Deleted: their chats are out of Chats until Undo. */
export const myDeletedBrickChatIds: Readable<ReadonlySet<string>> = derived([deleted, myChatIdNow], ([$deleted]) => {
    const myChatId = localUserStore.getChatId();
    const chatIds = new Set<string>();
    for (const brick of $deleted) {
        const chatId = brickChatId(brick.id, myChatId);
        if (chatId) chatIds.add(chatId);
    }
    return chatIds;
});

/** The person's Bricks by chat address, so the chat knows which of its direct chats are with one of them. */
export const myBricksByChatId: Readable<Map<string, BrickCard>> = derived([bricks, myChatIdNow], ([$bricks]) => {
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
