/**
 * Keeps the app pinned to the screen on phones.
 *
 * The app is one fixed screen and never scrolls. When the on-screen keyboard opens, iOS shrinks the visual
 * viewport and pans it (and the page) to show the focused field, whatever the CSS says; while it is open, a
 * thumb drag can pan it further. When the keyboard closes, iOS doesn't pan back, so the app stays shifted
 * off-screen with nothing to scroll it back with. This puts the page back in place whenever the keyboard
 * closes or no text field has focus any more. Desktop and Android never pan the page, so it does nothing there.
 */

/** How close (in CSS px) the visual viewport must be to the window's height to count as "keyboard closed". */
const KEYBOARD_CLOSED_TOLERANCE = 2;

export interface ViewportGuardWindow {
    readonly innerHeight: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly visualViewport: Pick<VisualViewport, "height" | "addEventListener" | "removeEventListener"> | null;
    readonly document: Document;
    scrollTo(x: number, y: number): void;
    setTimeout(handler: () => void, timeout?: number): number;
    addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void;
}

function isTextField(element: Element | null): boolean {
    if (!element) return false;
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLElement && element.isContentEditable) return true;
    if (element instanceof HTMLInputElement) {
        return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image"].includes(
            element.type
        );
    }
    return false;
}

function activeElementDeep(doc: Document): Element | null {
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active;
}

/** Scrolls the page (and its root elements) back to the top-left corner if anything moved it. */
export function resetPagePosition(win: ViewportGuardWindow): void {
    if (win.scrollX !== 0 || win.scrollY !== 0) {
        win.scrollTo(0, 0);
    }
    for (const element of [win.document.documentElement, win.document.body]) {
        if (element && (element.scrollTop !== 0 || element.scrollLeft !== 0)) {
            element.scrollTop = 0;
            element.scrollLeft = 0;
        }
    }
}

/**
 * Starts guarding the page position. Returns a function that stops it.
 */
export function installViewportGuard(win: ViewportGuardWindow = window as unknown as ViewportGuardWindow): () => void {
    const viewport = win.visualViewport;

    const keyboardClosed = () => viewport === null || viewport.height >= win.innerHeight - KEYBOARD_CLOSED_TOLERANCE;

    // The keyboard finished closing (the visual viewport grew back to the full window): put the page back.
    const onViewportResize = () => {
        if (keyboardClosed()) resetPagePosition(win);
    };

    // A text field lost focus. Focus may be moving to another field (the keyboard stays up, iOS keeps its pan),
    // so check once the new focus has landed.
    const onFocusOut = () => {
        win.setTimeout(() => {
            if (!isTextField(activeElementDeep(win.document))) resetPagePosition(win);
        }, 0);
    };

    // Nothing should scroll the page itself. With no text field focused and the keyboard closed, any page scroll
    // is a leftover pan: undo it.
    const onScroll = () => {
        if (keyboardClosed() && !isTextField(activeElementDeep(win.document))) resetPagePosition(win);
    };

    viewport?.addEventListener("resize", onViewportResize);
    win.addEventListener("focusout", onFocusOut, true);
    win.addEventListener("scroll", onScroll, { passive: true });

    return () => {
        viewport?.removeEventListener("resize", onViewportResize);
        win.removeEventListener("focusout", onFocusOut, true);
        win.removeEventListener("scroll", onScroll);
    };
}
