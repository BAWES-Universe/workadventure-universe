/** What is open over the game that asks something of you, or lists things, and must not be hidden under the window of files and links. */
export type CardsOpen = {
    /** A bar menu: the profile menu, the apps menu or the map menu. */
    barMenu: boolean;
    /** Settings, the Explore list or the broadcast panel. */
    panel: boolean;
    /** A person's card, a visit request, Block or report, a ring, a follow request or a new device (not a toast like "link copied"). */
    card: boolean;
};

/**
 * A menu or card opened while the window of files and links shows was opened last, so it comes in front: the window
 * stays open under it, as Orbit's does for a menu opened from the bar.
 */
export function cardOverWindow(open: CardsOpen): boolean {
    return open.barMenu || open.panel || open.card;
}
