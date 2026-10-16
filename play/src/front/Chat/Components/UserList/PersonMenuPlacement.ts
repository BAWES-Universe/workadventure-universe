import { computePosition, flip, offset, shift } from "@floating-ui/dom";

/**
 * Places a person's ⋯ menu (People tab, Friends list) under its button, its right edge on the button's, inside the
 * chat panel. Near the bottom of the panel it opens upward instead, and it never leaves the panel sideways.
 */
export function placePersonMenu(button: HTMLElement, menu: HTMLElement): void {
    const boundary = button.closest<HTMLElement>("#chat") ?? "clippingAncestors";
    computePosition(button, menu, {
        strategy: "fixed",
        placement: "bottom-end",
        middleware: [offset(4), flip({ boundary, padding: 8 }), shift({ boundary, padding: 8 })],
    })
        .then(({ x, y }) => Object.assign(menu.style, { left: `${x}px`, top: `${y}px` }))
        .catch((error) => console.error("Failed to place the person menu", error));
}
