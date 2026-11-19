import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../services/BotApiService";
import {
    parseBrickHome,
    parsePlaced,
    parseRoomBricks,
    placementOf,
    type OwnBrickChoice,
    type RoomBricks,
} from "../roomBricksModel";

/**
 * The Bricks of the room being edited (game #2005): the ones that live here and the person's own that can be added.
 * Undefined until Orbit answered once, or when it refuses (the person cannot manage bots here, or it cannot be reached):
 * the list then shows nothing about Bricks rather than a row that might not work.
 */
const bricks = writable<RoomBricks | undefined>(undefined);
export const roomBricksStore: Readable<RoomBricks | undefined> = { subscribe: bricks.subscribe };

/** The room the stored answer is for, so a list opened in another room never shows the last one's. */
let forRoom: string | null = null;

/** Which read is the latest, so one that is slow never puts an older list over a newer one (a Brick just taken out comes back). */
let newest = 0;

/** Reads the room's Bricks again. Resolves either way. */
export async function loadRoomBricks(): Promise<void> {
    const roomUrl = botApiService.getRoomId();
    if (!roomUrl) return;
    if (forRoom !== roomUrl) {
        forRoom = roomUrl;
        bricks.set(undefined);
    }
    const mine = ++newest;
    try {
        const answer = parseRoomBricks(await botApiService.getRoomBricks(roomUrl));
        if (forRoom === roomUrl && mine === newest) bricks.set(answer);
    } catch (error) {
        console.warn("Could not read the Bricks of this room", error);
        if (forRoom === roomUrl && mine === newest) bricks.set(undefined);
    }
}

export type PlaceAnswer = { ok: true; keyNotLent: boolean } | { ok: false };

/** "Add here": the Brick gets a home in this room at the spot the person picked. */
export async function placeBrickHere(
    brick: Pick<OwnBrickChoice, "id">,
    spot: { behaviorConfig?: unknown }
): Promise<PlaceAnswer> {
    const roomUrl = botApiService.getRoomId();
    if (!roomUrl) return { ok: false };
    // A Brick that already stands in this room is moved, and keeps how it behaves here
    const standingHere = get(bricks)?.here.find((row) => row.id === brick.id);
    try {
        // A Brick has one home: placing it here moves it out of the room it lived in, which is told too
        const before = await Promise.resolve()
            .then(() => botApiService.getBrickHome(brick.id))
            .then(parseBrickHome, () => undefined);
        const placed = parsePlaced(
            await botApiService.placeBrickHome(brick.id, roomUrl, placementOf(standingHere, spot))
        );
        if (!placed) return { ok: false };
        await loadRoomBricks();
        // The bot server puts it on this room's map: asked the way a room bot's spawn is
        void botApiService.notifyRoomEnter(roomUrl).catch((error: unknown) => console.warn(error));
        if (before && before.roomUrl !== roomUrl) {
            void botApiService.notifyRoomEnter(before.roomUrl).catch((error: unknown) => console.warn(error));
        }
        return { ok: true, keyNotLent: placed.keyNotLent };
    } catch (error) {
        console.warn("Could not give a Brick a home here", error);
        return { ok: false };
    }
}

/** "Take out": the Brick goes back to its owner's Bricks. True when it did. */
export async function takeBrickOut(brickId: string): Promise<boolean> {
    // The room it is taken out of, read before anything is awaited: the person may walk to another room meanwhile
    const roomUrl = botApiService.getRoomId();
    try {
        await botApiService.takeBrickOut(brickId);
        await loadRoomBricks();
        // The bot server takes it off the map in its own time: the button does not wait for a room with nobody in it
        if (roomUrl) void botApiService.notifyRoomEnter(roomUrl).catch((error: unknown) => console.warn(error));
        return true;
    } catch (error) {
        console.warn("Could not take a Brick out of this room", error);
        return false;
    }
}

/** For tests and for a person who signs out without a reload. */
export function forgetRoomBricks(): void {
    forRoom = null;
    newest++;
    bricks.set(undefined);
}
