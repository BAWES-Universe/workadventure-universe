/**
 * The prefix every space of a room gets on the servers (`${namespace}.${localSpaceName}`).
 *
 * The admin only gives the world's slug, and two universes can each have a world with the same slug. Orbit rooms
 * live at /@/{universe}/{world}/{room}, so the universe is taken from the room URL to keep those worlds apart:
 * otherwise players of both worlds would share the world's people list, chat IDs and every other space.
 *
 * Each part is escaped so it never contains "/", "@" or ".": an Orbit namespace is "@{universe}/{world}", any other
 * room keeps its (escaped) world, and the namespace always ends at the first "." of a space name. So no two
 * universes, worlds or spaces can end up with the same name, whatever characters their slugs use.
 */
export function worldSpaceNamespace(roomUrl: string, world: string): string {
    let pathname: string;
    try {
        pathname = new URL(roomUrl).pathname;
    } catch {
        return escapeNamespacePart(world);
    }
    const [, kind, universe, roomWorld] = pathname.split("/");
    if (kind !== "@" || !universe || !roomWorld) {
        return escapeNamespacePart(world);
    }
    return `@${escapeNamespacePart(universe)}/${escapeNamespacePart(world)}`;
}

function escapeNamespacePart(part: string): string {
    return encodeURIComponent(part).replace(/\./g, "%2E");
}
