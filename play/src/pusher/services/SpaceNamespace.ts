/**
 * The prefix every space of a room gets on the servers (`${namespace}.${localSpaceName}`).
 *
 * The admin only gives the world's slug, and two universes can each have a world with the same slug. Orbit rooms
 * live at /@/{universe}/{world}/{room}, so the universe is taken from the room URL to keep those worlds apart:
 * otherwise players of both worlds would share the world's people list, chat IDs and every other space.
 * Rooms outside Orbit (such as /_/ rooms on a plain host) keep the world as it is.
 */
export function worldSpaceNamespace(roomUrl: string, world: string): string {
    let pathname: string;
    try {
        pathname = new URL(roomUrl).pathname;
    } catch {
        return world;
    }
    const [, kind, universe, roomWorld] = pathname.split("/");
    if (kind !== "@" || !universe || !roomWorld) {
        return world;
    }
    return `${universe}~${world}`;
}
