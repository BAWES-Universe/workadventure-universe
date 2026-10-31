/** One room an upload is placed in, as the box that confirms deleting it lists it (#1690). */
export interface PlacedIn {
    /** "This room", or the room's name. */
    name: string | undefined;
    thisRoom: boolean;
    count: number;
}

/** What "Delete this upload" does: delete at once when it is placed nowhere, else ask first, listing the rooms. */
export type DeleteStep = { ask: false } | { ask: true; total: number; rooms: PlacedIn[] };

/** The room a map file belongs to, as its folder name: ".../lounge/map.wam" is "lounge". */
function roomFolder(wamUrl: string): string {
    const parts = new URL(wamUrl, "http://localhost").pathname.split("/").filter((part) => part.length > 0);
    const folder = parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1] ?? wamUrl;
    try {
        return decodeURIComponent(folder);
    } catch {
        return folder;
    }
}

function sameMapFile(a: string, b: string): boolean {
    try {
        return new URL(a, "http://localhost").pathname === new URL(b, "http://localhost").pathname;
    } catch {
        return a === b;
    }
}

/**
 * Puts the rooms an upload is placed in in the order the box shows: this room first, then the others by name.
 * @param rooms Where map-storage found copies, by map file.
 * @param knownRooms The rooms of the world with the name people see for them elsewhere in the game.
 * @param currentWamUrl The map file of the room the person is in.
 */
export function describePlacedIn(
    rooms: readonly { wamUrl: string; count: number }[],
    knownRooms: readonly { name: string; wamUrl?: string }[],
    currentWamUrl: string | undefined
): PlacedIn[] {
    const placed = rooms
        .filter((room) => room.count > 0)
        .map((room): PlacedIn => {
            const thisRoom = currentWamUrl !== undefined && sameMapFile(room.wamUrl, currentWamUrl);
            const known = knownRooms.find((each) => each.wamUrl !== undefined && sameMapFile(each.wamUrl, room.wamUrl));
            return {
                name: thisRoom ? undefined : known?.name ?? roomFolder(room.wamUrl),
                thisRoom,
                count: room.count,
            };
        });
    return placed.sort((a, b) =>
        a.thisRoom === b.thisRoom ? (a.name ?? "").localeCompare(b.name ?? "") : a.thisRoom ? -1 : 1
    );
}

export function deleteStep(rooms: readonly PlacedIn[]): DeleteStep {
    const total = rooms.reduce((sum, room) => sum + room.count, 0);
    return total === 0 ? { ask: false } : { ask: true, total, rooms: [...rooms] };
}
