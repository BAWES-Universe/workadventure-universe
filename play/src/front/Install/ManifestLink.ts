/**
 * Points the page's `<link rel="manifest">` at the room the player is in now.
 *
 * The page's first answer links the manifest of the address it was opened at. A player who opens "/" is taken to the
 * last room, and walking through an exit moves to another map, both without loading the page again, so the link
 * must follow or the app gets installed with the room it was first opened at (or none).
 *
 * `roomPath` is a room's path, with or without its leading "/": the game's `Room.id` has none ("@/world/room").
 */
export function pointManifestAtRoom(roomPath: string): void {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link === null) return;
    // Joined as a path of this site. "https://site" + "@/world/room" is not an address, and the manifest of an address
    // that is not one starts the app at "/", which opens the start room instead of the last room.
    const room = new URL(roomPath.startsWith("/") ? roomPath : `/${roomPath}`, window.location.origin);
    // A "//other.site/x" never leaves this site.
    if (room.origin !== window.location.origin) return;
    const current = new URL(link.href, window.location.href);
    // Only the path of the room goes into the manifest, never a query or a hash (see roomPathOfPage).
    current.searchParams.set("url", room.origin + room.pathname);
    if (current.href !== link.href) {
        link.href = current.href;
    }
}
