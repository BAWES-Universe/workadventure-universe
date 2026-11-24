import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { refreshBrickHome } from "./BrickHomeStore";
import { parseBrickVisit, type BrickVisit, type BringAlongOutcome } from "./BrickVisit";

/** How long the bot server gets before it is asked again whether the Brick is on the map. */
const RETRY_SYNC_MS = 1000;
/** How long before the page's visit read is tried once more after it failed (or timed out). */
const RETRY_READ_MS = 3000;

/**
 * What the Brick page shows about visiting (game #2005): for the Brick it is open on, in the room the person is in now.
 * Undefined until Orbit answered once, or when it can't be told (no room, or Orbit could not be reached): the page then
 * shows nothing about visiting rather than a button that might not work.
 */
const visit = writable<BrickVisit | undefined>(undefined);
export const brickVisitStore: Readable<BrickVisit | undefined> = { subscribe: visit.subscribe };

/** The Brick the stored answer is about, so a page opened on another Brick never shows the last one's. */
let forBrick: string | undefined;

/**
 * Which write to the stored answer is the newest. A read that was slow, and answers after a newer one (another read, or the
 * visit this person just began) wrote, would put an older state back over it, so it is dropped.
 */
let newest = 0;

type Position = { x: number; y: number };

/** Where the person stands now (the game gives it, so this file stays free of the scene): undefined without a scene yet. */
let ownPosition: () => Position | undefined = () => undefined;

/** The game tells where the person stands, so a Brick brought along appears beside them. */
export function provideOwnPosition(read: () => Position | undefined): void {
    ownPosition = read;
}

/**
 * Reads what a Brick's page says about visiting. The answer is kept only while that Brick is still the one the page shows
 * (a read for a Brick the person has since left changes nothing, not even which read counts as newest), and only if nothing
 * newer was written. Gives the answer it read, or undefined when it could not be read, and whether the read failed.
 */
async function tryReadBrickVisit(brickId: string): Promise<{ answer: BrickVisit | undefined; failed: boolean }> {
    const roomUrl = botApiService.getRoomId();
    if (!roomUrl) return { answer: undefined, failed: false };
    const shown = forBrick === brickId;
    const mine = shown ? ++newest : newest;
    try {
        const answer = parseBrickVisit(await botApiService.getBrickVisit(brickId, roomUrl));
        if (shown && forBrick === brickId && mine === newest) visit.set(answer);
        return { answer, failed: false };
    } catch (error) {
        console.warn("Could not read whether a Brick visits", error);
        return { answer: undefined, failed: true };
    }
}

async function readBrickVisit(brickId: string): Promise<BrickVisit | undefined> {
    return (await tryReadBrickVisit(brickId)).answer;
}

/** Reads what the Brick's page says about visiting. Resolves either way; a failure leaves the page with nothing to say. */
export async function loadBrickVisit(brickId: string): Promise<void> {
    if (forBrick !== brickId) {
        forBrick = brickId;
        visit.set(undefined);
    }
    const first = await tryReadBrickVisit(brickId);
    // A read that failed or timed out would leave the visit controls hidden until the page is opened again: tried once more
    if (first.failed && forBrick === brickId) {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, RETRY_READ_MS);
        });
        if (forBrick === brickId) await readBrickVisit(brickId);
    }
}

/**
 * "Bring along": Orbit swaps whichever Brick walked with the person for this one, then the bot server puts it beside
 * them on the map. Undefined when it worked; otherwise why not, so the page can say it. "not_yet" is a visit that began
 * (it is Orbit's, and the Brick joins on the next room) while the bot server did not put the Brick on this map.
 */
export async function bringBrickAlong(brickId: string): Promise<BringAlongOutcome | undefined> {
    const roomUrl = botApiService.getRoomId();
    if (!roomUrl) return "failed";
    try {
        const answer = parseBrickVisit(await botApiService.startBrickVisit(brickId, roomUrl));
        if (!answer) return "failed";
        if (forBrick === brickId) {
            newest++;
            visit.set(answer);
        }
        // Said only once the bot server says the Brick is on the map; asked once more, as it may be a moment behind
        let present = await botApiService.syncVisitingBrick(ownPosition());
        if (present !== true) {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, RETRY_SYNC_MS);
            });
            present = await botApiService.syncVisitingBrick(ownPosition());
        }
        return present === true ? undefined : "not_yet";
    } catch (error) {
        const status = (error as { status?: number } | undefined)?.status;
        const refusal = error as { status?: number; reason?: string; place?: string } | undefined;
        if (status === 409 && refusal?.reason === "lives_in") {
            // It has a home in a room (made so since the page was read): the page now shows where, and what to do first
            refreshBrickHome(brickId).catch((failure: unknown) => console.warn(failure));
            return { livesIn: refusal.place ?? "" };
        }
        if (status === 409) {
            // The place stopped taking visits, or the Brick was switched off, since the page was read
            const answer = await readBrickVisit(brickId);
            return answer?.state === "blocked" ? "not_taken" : "off";
        }
        console.warn("Could not bring a Brick along", error);
        return "failed";
    }
}

/** "End visit": the Brick goes home and leaves this room's map. False when it could not be ended. */
export async function endBrickVisit(brickId: string): Promise<boolean> {
    try {
        await botApiService.endBrickVisit(brickId);
        // The visit is over in Orbit, so the page stops saying the Brick walks here whatever the next read does
        if (forBrick === brickId) {
            const before = get(visit);
            newest++;
            visit.set({ state: "none", place: before?.place ? before.place : null });
        }
        // Read again rather than guess: the answer to an ended visit names no place, and the page says where it would walk
        await readBrickVisit(brickId);
        // The visit is over in Orbit; the Brick is taken off the map, asked once more when the bot server did not answer
        if ((await botApiService.syncVisitingBrick(undefined, { ending: true })) === undefined) {
            await botApiService.syncVisitingBrick(undefined, { ending: true });
        }
        return true;
    } catch (error) {
        console.warn("Could not end a Brick's visit", error);
        return false;
    }
}

/** For tests and for a person who signs out without a reload. */
export function forgetBrickVisit(): void {
    forBrick = undefined;
    newest++;
    visit.set(undefined);
}
