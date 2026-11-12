/**
 * Bringing a Brick along (game #2005): what a Brick's page says about visiting, as Orbit tells it. Nothing in here talks
 * to a server or reads a store, so every rule can be unit tested.
 */

/**
 * What the page shows for the room the person is in: nothing to say yet (offer "Bring along"), this Brick walks beside
 * them (say where, offer "End visit"), or the place does not take visiting Bricks (one line; direct messages still work).
 */
export type BrickVisit =
    | { state: "none"; place: string | null }
    | { state: "visiting"; place: string }
    | { state: "blocked"; place: string };

const PLACE_MAX = 100;

const placeOf = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, PLACE_MAX) : null;

/** Orbit's answer to "what about visiting?" (GET, POST and DELETE of a Brick's visit). Undefined when it is not one. */
export function parseBrickVisit(value: unknown): BrickVisit | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { state, place } = value as { state?: unknown; place?: unknown };
    const name = placeOf(place);
    if (state === "visiting") return { state, place: name ?? "" };
    // A place that does not take visits is always named: its line is "{place} doesn't take visiting Bricks"
    if (state === "blocked") return name ? { state, place: name } : undefined;
    if (state === "none") return { state, place: name };
    return undefined;
}

/** What Orbit refuses a "Bring along" with: the place does not take visits, or the Brick is switched off. */
export type BringAlongRefusal = "not_taken" | "off" | "failed";

/** Whether the "Bring along" button is there: a Brick that is off cannot walk anywhere, and no room means no "here". */
export function canOfferBringAlong(brick: { enabled: boolean }, visit: BrickVisit | undefined): boolean {
    return brick.enabled && visit?.state === "none";
}

/** The tag a visiting Brick's player carries (`visiting:Khalid`), which the map reads to say who it walks with. */
export const VISITING_TAG_PREFIX = "visiting:";

/** The person a Brick walks with, read from a player's tags; undefined for anyone who is not a visiting Brick. */
export function visitingWith(tags: readonly string[] | undefined): string | undefined {
    const tag = tags?.find((candidate) => candidate.startsWith(VISITING_TAG_PREFIX));
    const name = tag?.slice(VISITING_TAG_PREFIX.length).trim();
    return name ? name.slice(0, PLACE_MAX) : undefined;
}
