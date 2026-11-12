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

/** True when the last read could not list the Bricks they made: the page says so, with Try again, instead of "none". */
const listFailed = writable(false);
export const myBricksListFailed: Readable<boolean> = { subscribe: listFailed.subscribe };

let loading: Promise<void> | undefined;
// Counts sign-outs: a read or a change that was asked for before the person signed out changes nothing when it ends.
let generation = 0;
// Counts changes made here (a switch, a save, a new Brick, a delete, an Undo): a list Orbit read before one of them is
// older than what the page shows, so it is read again rather than put back over it.
let changes = 0;
/** How many times a read is tried when changes keep coming meanwhile; then what the page shows stays. */
const READS_WHILE_CHANGING = 3;

async function load(asked: number, read = 1): Promise<void> {
    const seen = changes;
    // Orbit makes the Brick everyone gets the first time this account asks, and never again: asking is safe from
    // every device, as often as the chat opens. An account whose owner deleted it gets none.
    let ownFailed = false;
    const own = (await botApiService.ensureMyBrick().catch(() => {
        ownFailed = true;
        return null;
    })) as { brick?: unknown } | null;
    const first = parseBrickCard(own?.brick);
    // The Bricks they made come with the list; when it can't be read, the one everyone gets still shows.
    const list = await botApiService.listMyBricks().catch(() => undefined);
    if (asked !== generation) return;
    if (seen !== changes) {
        if (read < READS_WHILE_CHANGING) await load(asked, read + 1);
        return;
    }
    refreshMyChatId();
    const known = get(bricks);
    // Orbit could not be asked for the Brick everyone gets: the read failed. What was known stays, and the page says
    // the read failed, with Try again, rather than show the Bricks as freshly read.
    if (ownFailed) {
        if (known === undefined) {
            // A list that came with Bricks still shows them, with the failed line and Try again. An empty or unread
            // one does not: it could say "You have no Brick" to someone whose Brick could not be made just now.
            const listed = list === undefined ? [] : parseBrickCards(list);
            if (listed.length === 0) throw new Error("Could not read the Brick everyone gets");
            bricks.set(listed);
            deleted.set(parseDeletedBricks(list));
            undoDays.set(parseUndoDays(list));
        }
        listFailed.set(true);
        return;
    }
    if (list !== undefined) {
        bricks.set(parseBrickCards(list));
        deleted.set(parseDeletedBricks(list));
        undoDays.set(parseUndoDays(list));
        listFailed.set(false);
        return;
    }
    // What was already known stays: a list that could not be read again does not take Bricks out of Chats
    if (known === undefined && !first) throw new Error("Could not list the Bricks");
    if (known === undefined) bricks.set(first ? [first] : []);
    else if (first && !known.some((brick) => brick.id === first.id)) bricks.set([first, ...known]);
    listFailed.set(true);
}

/** A change made here: a list read before it is not put back over it. */
function changed(): void {
    changes++;
}

/**
 * Reads the person's Bricks from Orbit. One request at a time; a failure leaves what was known and is tried again the
 * next time the chat list or the Bricks page opens. Resolves either way.
 */
export function loadMyBricks(): Promise<void> {
    if (!get(userIsConnected)) return Promise.resolve();
    if (!loading) {
        const asked = generation;
        const run: Promise<void> = load(asked)
            .catch((error: unknown) => {
                if (asked === generation) console.warn("Could not read your Bricks", error);
            })
            .finally(() => {
                if (loading === run) loading = undefined;
                if (asked === generation) settled.set(true);
            });
        loading = run;
    }
    return loading;
}

/**
 * Turns one of the person's Bricks on or off. The switch moves at once and goes back when Orbit refuses.
 * A Brick that is off stays in Chats and keeps its chat; it says it is resting instead of answering.
 */
export async function setMyBrickEnabled(brickId: string, enabled: boolean): Promise<boolean> {
    const asked = generation;
    const before = get(bricks);
    const put = (change: (brick: BrickCard) => BrickCard) => {
        changed();
        bricks.update((list) => list?.map((brick) => (brick.id === brickId ? change(brick) : brick)));
    };
    put((brick) => ({ ...brick, enabled }));
    try {
        const saved = parseBrickCard(
            ((await botApiService.setBrickEnabled(brickId, enabled)) as { brick?: unknown })?.brick
        );
        // Signed out meanwhile: what Orbit said belongs to the person before, and goes nowhere
        if (asked !== generation) return false;
        if (saved) put(() => saved);
        return true;
    } catch (error) {
        console.warn("Could not turn a Brick on or off", error);
        if (asked !== generation) return false;
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
    const asked = generation;
    try {
        const saved = parseBrickCard(
            ((await botApiService.changeMyBrick(brickId, change)) as { brick?: unknown })?.brick
        );
        tellBrickChanged(brickId);
        if (asked !== generation) return false;
        changed();
        if (saved) bricks.update((list) => list?.map((brick) => (brick.id === brickId ? saved : brick)));
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
    const asked = generation;
    try {
        const made = parseBrickCard(
            ((await botApiService.makeMyBrick({ name, characterTextureId: look })) as { brick?: unknown })?.brick
        );
        if (!made || asked !== generation) return undefined;
        changed();
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
    const asked = generation;
    try {
        const answer = (await botApiService.deleteMyBrick(brickId)) as { brick?: unknown };
        // The bot server stops the Brick now, not within the minute
        tellBrickChanged(brickId);
        if (asked !== generation) return false;
        const gone = parseDeletedBricks({ deleted: [answer?.brick] })[0];
        changed();
        bricks.update((list) => list?.filter((brick) => brick.id !== brickId));
        if (gone) deleted.update((list) => [...list.filter((brick) => brick.id !== brickId), gone]);
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
    const asked = generation;
    let back: BrickCard | undefined;
    try {
        back = parseBrickCard(((await botApiService.undoMyBrick(brickId)) as { brick?: unknown })?.brick);
    } catch (error) {
        console.warn("Could not bring a Brick back", error);
        return false;
    }
    tellBrickChanged(brickId);
    // Signed out meanwhile: the Brick that came back is the person before's, and never shows to whoever is here now
    if (asked !== generation) return false;
    if (back) {
        const card = back;
        changed();
        deleted.update((list) => list.filter((brick) => brick.id !== brickId));
        bricks.update((list) => [...(list ?? []).filter((brick) => brick.id !== card.id), card]);
        return true;
    }
    // The answer did not say the Brick: the list says whether it is back, and Undo stays until it does. A list read
    // still out from before the Undo is older than it, so it reads again rather than answer for it.
    changed();
    await loadMyBricks();
    if (asked !== generation) return false;
    return (get(bricks) ?? []).some((brick) => brick.id === brickId);
}

/** Tells the bot server a Brick changed so it reads it again now. Best effort: the operation is done either way. */
function tellBrickChanged(brickId: string): void {
    Promise.resolve(botApiService.tellBrickChanged(brickId)).catch((error: unknown) =>
        console.warn("Could not tell the bot server a Brick changed", error)
    );
}

/** For tests and for a person who signs out without a reload. */
export function forgetMyBricks(): void {
    generation++;
    loading = undefined;
    bricks.set(undefined);
    listFailed.set(false);
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
