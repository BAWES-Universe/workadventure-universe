import { computePosition, flip, offset, platform, shift } from "@floating-ui/dom";

// Positions in screen coordinates, whatever the menu is `fixed` to; see placePersonMenu.
const screenPlatform = { ...platform, getOffsetParent: () => window };

/**
 * Places a person's ⋯ menu (People tab, Friends list) under its button, its right edge on the button's, inside the
 * chat panel. Near the bottom of the panel it opens upward instead, and it never leaves the panel sideways.
 *
 * The menu is `fixed`, but the phone chat sheet has a backdrop-filter, which makes it the menu's containing block:
 * `fixed` then counts from the sheet, not the screen. Whether floating-ui sees that depends on the browser (Safari
 * says no for backdrop-filter), so it places the menu on the screen, and the menu is then measured and moved by
 * whatever the browser put it off by.
 */
export function placePersonMenu(button: HTMLElement, menu: HTMLElement): void {
    const boundary = button.closest<HTMLElement>("#chat") ?? "clippingAncestors";
    computePosition(button, menu, {
        strategy: "fixed",
        platform: screenPlatform,
        placement: "bottom-end",
        middleware: [offset(4), flip({ boundary, padding: 8 }), shift({ boundary, padding: 8 })],
    })
        .then(({ x, y }) => {
            Object.assign(menu.style, { left: `${x}px`, top: `${y}px` });
            const placed = menu.getBoundingClientRect();
            const offX = x - placed.left;
            const offY = y - placed.top;
            if (Math.abs(offX) > 0.5 || Math.abs(offY) > 0.5)
                Object.assign(menu.style, { left: `${x + offX}px`, top: `${y + offY}px` });
        })
        .catch((error) => console.error("Failed to place the person menu", error));
}
