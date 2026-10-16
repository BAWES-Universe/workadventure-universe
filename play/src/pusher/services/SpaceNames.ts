import { WAMSettingsUtils } from "@workadventure/map-editor";
import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";

/**
 * The namespace of the one space a universe shares. It cannot collide with a world's namespace, since a world slug
 * never contains ":".
 */
const UNIVERSE_SPACE_PREFIX = "universe:";

/**
 * The name a space goes by on the back, from the name the browser asked for.
 *
 * Spaces are namespaced per world: two worlds asking for the same name get two spaces, so nothing leaks between
 * worlds. The universe broadcast channel is the one exception. Every room of a universe must land in the same space,
 * whatever its world, so that channel is namespaced by the universe instead. Only the channel of the user's own
 * universe qualifies; a made-up name for another universe stays in the user's world, where no one listens to it.
 */
export function toGlobalSpaceName(socketData: { world: string; roomId: string }, localSpaceName: string): string {
    const universe = getUniverseSlug(socketData.roomId);
    if (universe && localSpaceName === slugify(WAMSettingsUtils.getUniverseMegaphoneSpaceName(universe))) {
        return `${UNIVERSE_SPACE_PREFIX}${localSpaceName}`;
    }
    return `${socketData.world}.${localSpaceName}`;
}

/** The universe of an Orbit room (its url is "/@/universe/world/room"); a plain room has none. */
function getUniverseSlug(roomId: string): string | undefined {
    let pathname: string;
    try {
        pathname = new URL(roomId).pathname;
    } catch {
        return undefined;
    }
    const [marker, universe, world, room] = pathname.split("/").filter(Boolean);
    if (marker !== "@" || !universe || !world || !room) {
        return undefined;
    }
    return universe;
}
