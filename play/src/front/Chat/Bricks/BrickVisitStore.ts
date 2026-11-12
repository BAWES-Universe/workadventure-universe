import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { parseBrickVisit, type BrickVisit, type BringAlongOutcome } from "./BrickVisit";

/** How long the bot server gets before it is asked again whether the Brick is on the map. */
const RETRY_SYNC_MS = 1000;

/**
 * What the Brick page shows about visiting (game #2005): for the Brick it is open on, in the room the person is in now.
 * Undefined until Orbit answered once, or when it can't be told (no room, or Orbit could not be reached): the page then
 * shows nothing about visiting rather than a button that might not work.
 */
const visit = writable<BrickVisit | undefined>(undefined);
export const brickVisitStore: Readable<BrickVisit | undefined> = { subscribe: visit.subscribe };

/** The Brick the stored answer is about, so a page opened on another Brick never shows the last one's. */
let forBrick: string | undefined;

type Position = { x: number; y: number };

/** Where the person stands now (the game gives it, so this file stays free of the scene): undefined without a scene yet. */
let ownPosition: () => Position | undefined = () => undefined;

/** The game tells where the person stands, so a Brick brought along appears beside them. */
export function provideOwnPosition(read: () => Position | undefined): void {
    ownPosition = read;
}

/** Reads what the Brick's page says about visiting. Resolves either way; a failure leaves the page with nothing to say. */
export async function loadBrickVisit(brickId: string): Promise<void> {
    if (forBrick !== brickId) {
        forBrick = brickId;
        visit.set(undefined);
    }
    const roomUrl = botApiService.getRoomId();
    if (!roomUrl) return;
    try {
        const answer = parseBrickVisit(await botApiService.getBrickVisit(brickId, roomUrl));
        if (forBrick === brickId) visit.set(answer);
    } catch (error) {
        console.warn("Could not read whether a Brick visits", error);
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
        if (forBrick === brickId) visit.set(answer);
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
        if (status === 409) {
            // The place stopped taking visits, or the Brick was switched off, since the page was read
            await loadBrickVisit(brickId);
            return get(visit)?.state === "blocked" ? "not_taken" : "off";
        }
        console.warn("Could not bring a Brick along", error);
        return "failed";
    }
}

/** "End visit": the Brick goes home and leaves this room's map. False when it could not be ended. */
export async function endBrickVisit(brickId: string): Promise<boolean> {
    try {
        await botApiService.endBrickVisit(brickId);
        // Read again rather than guess: the answer to an ended visit names no place, and the page says where it would walk
        await loadBrickVisit(brickId);
        await botApiService.syncVisitingBrick();
        return true;
    } catch (error) {
        console.warn("Could not end a Brick's visit", error);
        return false;
    }
}

/** For tests and for a person who signs out without a reload. */
export function forgetBrickVisit(): void {
    forBrick = undefined;
    visit.set(undefined);
}
