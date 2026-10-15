/**
 * Whether the pointer can hover, which a mouse can and a finger cannot.
 * Putting the cursor in the message box on a phone or tablet opens the keyboard, so the box is only focused
 * for the player when this is true (the GIF picker uses the same test for its search box).
 */
export function canHover(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(hover: hover)").matches;
}
