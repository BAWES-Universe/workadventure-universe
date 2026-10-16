/**
 * Calls `onOutside` for a click that lands outside `node`.
 *
 * A click on something the click itself removes (a category tile: the picker swaps its screen) reaches the document
 * after Svelte has already taken that tile off the page, so "is the target inside the picker" says no. That click is
 * not outside: the path it took (taken when the click started) and whether the target is still on the page say so.
 */
export function outsideClick(node: HTMLElement, onOutside: (event: Event) => void) {
    let callback = onOutside;
    const handler = (event: MouseEvent) => {
        if (event.composedPath().includes(node)) return;
        if (event.target instanceof Node && !event.target.isConnected) return;
        callback(event);
    };
    document.addEventListener("click", handler);
    return {
        update(next: (event: Event) => void) {
            callback = next;
        },
        destroy() {
            document.removeEventListener("click", handler);
        },
    };
}
