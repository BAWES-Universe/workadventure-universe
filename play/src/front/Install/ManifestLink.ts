/**
 * Points the page's `<link rel="manifest">` at the room the player is in now.
 *
 * The page's first answer links the manifest of the address it was opened at. A player who opens "/" is taken to the
 * last room, and walking through an exit moves to another map, both without loading the page again, so the link
 * must follow or the app gets installed with the room it was first opened at (or none).
 */
export function pointManifestAtRoom(roomPath: string): void {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link === null) return;
    const current = new URL(link.href, window.location.href);
    // Only the path of the room goes into the manifest, never a query or a hash (see roomPathOfPage).
    current.searchParams.set("url", window.location.origin + roomPath);
    if (current.href !== link.href) {
        link.href = current.href;
    }
}
