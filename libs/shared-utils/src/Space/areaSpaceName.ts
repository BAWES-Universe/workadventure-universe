import { slugifyJitsiRoomName } from "../Jitsi/slugify";

/**
 * Meeting rooms and speaker zones are voice and video spaces named after the room they are in. Their names start
 * with this prefix so the server can tell them apart from map script spaces, whose names are free, and keep them
 * inside the room of the player who joins them (see toServerSpaceName in the pusher). The prefix only uses
 * characters slugify keeps, because speaker zones go through slugify again on their way to the space registry.
 */
export const AREA_SPACE_PREFIX = "area__";

/** The space name of a meeting room or speaker zone called `name` in the room at `roomUrl`. */
export function areaSpaceName(name: string, roomUrl: string): string {
    return AREA_SPACE_PREFIX + slugifyJitsiRoomName(name.trim(), roomUrl);
}

export function isAreaSpaceName(spaceName: string): boolean {
    return spaceName.startsWith(AREA_SPACE_PREFIX);
}
