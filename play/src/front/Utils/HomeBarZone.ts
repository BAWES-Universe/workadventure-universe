/**
 * The strip at the bottom of an iPhone that belongs to the system (#1000).
 *
 * Swiping up from the very bottom edge goes Home or switches apps. The installed app draws under that strip, so the
 * same touch also landed on the map: the joystick showed up and walked the player north, and a short one walked to
 * where it lifted. A touch that starts in the strip is the phone's, not the map's.
 *
 * The strip is the bottom safe-area inset, which iOS only reports in the installed app held upright (#941). Anywhere
 * else it is 0 and nothing here changes.
 */

/** The bottom safe-area inset in CSS px: 0 unless the page is drawn under the home bar. */
export function bottomSafeAreaInset(doc: Document = document, win: Window = window): number {
    const probe = doc.createElement("div");
    probe.style.cssText =
        "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
        "padding-bottom:env(safe-area-inset-bottom, 0px)";
    doc.body.appendChild(probe);
    const inset = parseFloat(win.getComputedStyle(probe).paddingBottom);
    probe.remove();
    return Number.isFinite(inset) && inset > 0 ? inset : 0;
}

/** Whether a point on the page is inside the bottom strip that the phone keeps for its own swipe. */
export function isInHomeBarZone(y: number, inset: number, viewportHeight: number): boolean {
    return inset > 0 && y >= viewportHeight - inset;
}

/** Whether a touch that started at this page point is the phone's home-bar swipe, not a touch on the map. */
export function startsInHomeBarZone(y: number, doc: Document = document, win: Window = window): boolean {
    return isInHomeBarZone(y, bottomSafeAreaInset(doc, win), win.innerHeight);
}
