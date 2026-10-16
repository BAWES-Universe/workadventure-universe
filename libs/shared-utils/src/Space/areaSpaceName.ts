import { slugifyJitsiRoomName } from "../Jitsi/slugify";
import { shortHash } from "../String/shortHash";

/**
 * Meeting rooms and speaker zones are voice and video spaces named after the room they are in. Their names start
 * with this prefix so the server can tell them apart from map script spaces, whose names are free, and keep them
 * inside the room of the player who joins them (see toServerSpaceName in the pusher). The prefix only uses
 * characters slugify keeps, because speaker zones go through slugify again on their way to the space registry.
 */
export const AREA_SPACE_PREFIX = "area__";

// Letters slugify keeps (once accents are taken off), digits, dashes, underscores and spaces.
const SLUG_SAFE = /^[a-z0-9_\-\s]*$/i;

/** The space name of a meeting room or speaker zone called `name` in the room at `roomUrl`. */
export function areaSpaceName(name: string, roomUrl: string): string {
    const trimmed = name.trim();
    const withoutAccents = trimmed.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (SLUG_SAFE.test(withoutAccents)) {
        return AREA_SPACE_PREFIX + slugifyJitsiRoomName(trimmed, roomUrl);
    }
    // Slugify drops what it can't spell in plain letters (Arabic, emoji, "!"), so two names that only differ there
    // would share a space ("مسرح" and "قاعة" both become empty). A hash of the whole name keeps them apart.
    return AREA_SPACE_PREFIX + slugifyJitsiRoomName(`${trimmed} n${shortHash(trimmed)}`, roomUrl);
}

export function isAreaSpaceName(spaceName: string): boolean {
    return spaceName.startsWith(AREA_SPACE_PREFIX);
}
