/**
 * A Brick that lives in a room (game #2005): what the map editor's list of a room's bots says about Bricks, and what a
 * Brick's page says about where it lives, as Orbit tells it. Nothing in here talks to a server or reads a store, so every
 * rule can be unit tested.
 */

/** One Brick standing in this room, as a manager of the room sees it. */
export interface RoomBrickRow {
    id: string;
    name: string;
    look: string | null;
    /** Whose Brick it is, by name only. */
    ownerName: string | null;
    mine: boolean;
    /** Since when it has lived here (an ISO date), or null when Orbit did not say. */
    since: string | null;
}

/** One of the person's own Bricks that can be added to this room. */
export interface OwnBrickChoice {
    id: string;
    name: string;
    description: string | null;
    look: string | null;
    /** It lives in another room now: adding it here moves it. */
    homeElsewhere: boolean;
}

export interface RoomBricks {
    /** The room's name, for "It stands at a spot you choose in {room}". Empty when Orbit did not say. */
    roomName: string;
    here: RoomBrickRow[];
    mine: OwnBrickChoice[];
}

const text = (value: unknown, max = 200): string | null =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Orbit's answer to "which Bricks live in this room?". Undefined when it is not one: the list then shows nothing about Bricks. */
export function parseRoomBricks(value: unknown): RoomBricks | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { here, mine, roomName } = value as { here?: unknown; mine?: unknown; roomName?: unknown };
    if (!Array.isArray(here) || !Array.isArray(mine)) return undefined;
    const rows: RoomBrickRow[] = [];
    for (const one of here) {
        const row = one as Record<string, unknown> | null;
        const id = text(row?.id);
        const name = text(row?.name, 64);
        if (!row || !id || !name) continue;
        rows.push({
            id,
            name,
            look: text(row.characterTextureId),
            ownerName: text(row.ownerName, 100),
            mine: row.mine === true,
            since: text(row.since),
        });
    }
    const choices: OwnBrickChoice[] = [];
    for (const one of mine) {
        const card = one as Record<string, unknown> | null;
        const id = text(card?.id);
        const name = text(card?.name, 64);
        if (!card || !id || !name) continue;
        choices.push({
            id,
            name,
            description: text(card.description),
            look: text(card.characterTextureId),
            homeElsewhere: card.homeElsewhere === true,
        });
    }
    return { roomName: text(roomName, 100) ?? "", here: rows, mine: choices };
}

/** The Bricks placed by someone else: what the list shows under "Placed by others", each with Take out. */
export function placedByOthers(bricks: RoomBricks | undefined): RoomBrickRow[] {
    return bricks?.here.filter((row) => !row.mine) ?? [];
}

/** Where a Brick lives, for its page. */
export interface BrickHome {
    roomUrl: string;
    roomName: string;
    universeName: string;
}

/** Orbit's answer to "where does this Brick live?": null when it lives nowhere, undefined when it is not an answer. */
export function parseBrickHome(value: unknown): BrickHome | null | undefined {
    if (!value || typeof value !== "object" || !("home" in value)) return undefined;
    const home = (value as { home: unknown }).home;
    if (home === null) return null;
    const card = home as Record<string, unknown> | undefined;
    const roomUrl = text(card?.roomUrl, 2000);
    const roomName = text(card?.roomName, 100);
    if (!card || !roomUrl || !roomName) return undefined;
    return { roomUrl, roomName, universeName: text(card.universeName, 100) ?? "" };
}

/** Orbit's answer to "Add here": where it lives now, and whether others cannot talk to it yet because its key is not lent. */
export function parsePlaced(value: unknown): { home: BrickHome; keyNotLent: boolean } | undefined {
    const home = parseBrickHome(value);
    if (!home) return undefined;
    return { home, keyNotLent: (value as { keyNote?: unknown }).keyNote === "not_lent" };
}

/** Whether a Brick's home is the room the person is in now: its page then offers Show on map. */
export function livesHere(home: BrickHome | null | undefined, roomUrl: string | null | undefined): boolean {
    return !!home && !!roomUrl && sameRoom(home.roomUrl, roomUrl);
}

function sameRoom(a: string, b: string): boolean {
    const clean = (url: string) => {
        try {
            const parsed = new URL(url, "http://room.invalid");
            return `${parsed.pathname.replace(/\/+$/, "")}`;
        } catch {
            return url;
        }
    };
    return clean(a) === clean(b);
}
