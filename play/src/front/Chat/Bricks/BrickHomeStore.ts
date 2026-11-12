import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { parseBrickHome, type BrickHome } from "../../external-modules/bots/roomBricksModel";

/**
 * Where the Brick the page is open on lives (game #2005): its room, or null when it lives nowhere. Undefined until Orbit
 * answered, or when it can't be told: the page then says nothing about a home rather than offer a button that might fail.
 */
const home = writable<BrickHome | null | undefined>(undefined);
export const brickHomeStore: Readable<BrickHome | null | undefined> = { subscribe: home.subscribe };

/** The Brick the stored answer is about, so a page opened on another Brick never shows the last one's. */
let forBrick: string | undefined;

/** Finds the Brick on this room's map and points the camera at it; false when it is not on this map. The game gives it. */
let locate: (brickId: string) => boolean = () => false;

export function provideBrickLocator(find: (brickId: string) => boolean): void {
    locate = find;
}

/** Reads where the Brick lives. Resolves either way. */
export async function loadBrickHome(brickId: string): Promise<void> {
    if (forBrick !== brickId) {
        forBrick = brickId;
        home.set(undefined);
    }
    try {
        const answer = parseBrickHome(await botApiService.getBrickHome(brickId));
        if (forBrick === brickId) home.set(answer);
    } catch (error) {
        console.warn("Could not read where a Brick lives", error);
    }
}

/** "Take it out of this room": the Brick goes back to its owner's Bricks. True when it did. */
export async function takeBrickOutOfHome(brickId: string): Promise<boolean> {
    try {
        await botApiService.takeBrickOut(brickId);
        if (forBrick === brickId) home.set(null);
        // The bot server takes it off the map of the room it was standing in
        const roomUrl = botApiService.getRoomId();
        if (roomUrl) await botApiService.notifyRoomEnter(roomUrl).catch((error: unknown) => console.warn(error));
        return true;
    } catch (error) {
        console.warn("Could not take a Brick out of its room", error);
        return false;
    }
}

/** "Show on map": the camera goes to the Brick. False when it is not on this map (yet). */
export function showBrickOnMap(brickId: string): boolean {
    return locate(brickId);
}

/** For tests and for a person who signs out without a reload. */
export function forgetBrickHome(): void {
    forBrick = undefined;
    home.set(undefined);
}

export const currentBrickHome = () => get(home);
