import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../external-modules/bots/services/BotApiService";
import {
    livesHere,
    parseBrickHome,
    parseRoomBricks,
    type BrickHome,
} from "../../external-modules/bots/roomBricksModel";

/**
 * Where the Brick the page is open on lives (game #2005): its room, or null when it lives nowhere. Undefined until Orbit
 * answered, or when it can't be told: the page then says nothing about a home rather than offer a button that might fail.
 */
const home = writable<BrickHome | null | undefined>(undefined);
export const brickHomeStore: Readable<BrickHome | null | undefined> = { subscribe: home.subscribe };

/** The Brick the stored answer is about, so a page opened on another Brick never shows the last one's. */
let forBrick: string | undefined;

/** Which read is the latest, so a slow read never puts an older answer back over a newer one or over a take-out. */
let newest = 0;

/** Finds the Brick on this room's map and points the camera at it; false when it is not on this map. The game gives it. */
let locate: (brickId: string) => boolean = () => false;
/** Points the camera at a spot of this room's map; false when the game cannot. The game gives it. */
let goToSpot: (spot: { x: number; y: number }) => boolean = () => false;

export function provideBrickLocator(
    find: (brickId: string) => boolean,
    toSpot: (spot: { x: number; y: number }) => boolean = () => false
): void {
    locate = find;
    goToSpot = toSpot;
}

/** Reads where the Brick lives. Resolves either way. */
export async function loadBrickHome(brickId: string): Promise<void> {
    if (forBrick !== brickId) {
        forBrick = brickId;
        home.set(undefined);
    }
    const mine = ++newest;
    try {
        const answer = parseBrickHome(await botApiService.getBrickHome(brickId));
        if (forBrick === brickId && mine === newest) home.set(answer);
    } catch (error) {
        console.warn("Could not read where a Brick lives", error);
    }
}

/**
 * Reads the home again for a page that is still open on this Brick, e.g. after Orbit refused something because it has one.
 * Never switches the page to this Brick: when another is shown by now, the answer is not wanted.
 */
export async function refreshBrickHome(brickId: string): Promise<void> {
    if (forBrick !== brickId) return;
    const mine = ++newest;
    try {
        const answer = parseBrickHome(await botApiService.getBrickHome(brickId));
        if (forBrick === brickId && mine === newest) home.set(answer);
    } catch (error) {
        console.warn("Could not read where a Brick lives", error);
    }
}

/** "Take it out of this room": the Brick goes back to its owner's Bricks. True when it did. */
export async function takeBrickOutOfHome(brickId: string): Promise<boolean> {
    try {
        // The room it lived in is the one to tell, which is not always the room the person is in
        let lived = forBrick === brickId ? get(home) : undefined;
        // Not read yet: asked now, as the room to tell is the one it lived in, not the one the person stands in
        if (lived === undefined)
            lived = await Promise.resolve()
                .then(() => botApiService.getBrickHome(brickId))
                .then(parseBrickHome, () => undefined);
        await botApiService.takeBrickOut(brickId);
        if (forBrick === brickId) {
            // A read of this Brick that began before it was taken out is about a home it no longer has. A read of another
            // Brick, a page opened meanwhile, is not touched
            newest++;
            home.set(null);
        }
        // The bot server takes it off the map of the room it was standing in
        const roomUrl = lived?.roomUrl ?? botApiService.getRoomId();
        if (roomUrl) void botApiService.notifyRoomEnter(roomUrl).catch((error: unknown) => console.warn(error));
        return true;
    } catch (error) {
        console.warn("Could not take a Brick out of its room", error);
        return false;
    }
}

/**
 * "Show on map": the camera goes to the Brick. The game only knows the Bricks it has been sent, which are those near the
 * view, so one far away is found by the spot Orbit keeps for it. False when it is not on this map (yet).
 */
export async function showBrickOnMap(brickId: string): Promise<boolean> {
    if (locate(brickId)) return true;
    const roomUrl = botApiService.getRoomId();
    const here = forBrick === brickId ? get(home) : undefined;
    if (!roomUrl || !livesHere(here, roomUrl)) return false;
    try {
        const bricks = parseRoomBricks(await botApiService.getRoomBricks(roomUrl));
        const spot = bricks?.here.find((row) => row.id === brickId)?.spot;
        return !!spot && goToSpot(spot);
    } catch (error) {
        console.warn("Could not read where a Brick stands", error);
        return false;
    }
}

/** For tests and for a person who signs out without a reload. */
export function forgetBrickHome(): void {
    forBrick = undefined;
    newest++;
    home.set(undefined);
}

export const currentBrickHome = () => get(home);
