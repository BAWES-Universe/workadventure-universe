/**
 * Keeps the app pinned to the screen on phones.
 *
 * The app is one fixed screen and never scrolls or zooms. Phones don't fully agree:
 * - When the on-screen keyboard opens, iOS shrinks the visual viewport and pans the page to show the focused field,
 *   whatever the CSS says. While it is open, a thumb drag pans it further, dragging the app off-screen; when the
 *   keyboard closes, iOS doesn't pan back, and the app stays shifted with nothing to scroll it back with.
 * - iOS ignores `user-scalable=no`: a pinch on the interface zooms the whole page, and the zoom can outlive a
 *   page restore, so the app can open enlarged and cut off at the edges until a refresh.
 *
 * This guard lets iOS pan the page only to reveal the field being typed in (right after the keyboard opens or focus
 * moves) and holds it there while the keyboard is up: a drag outside anything scrollable is ignored, and a pan that
 * still gets through (a drag on an embedded page, which this page can't see) is undone. It puts the page back when
 * the keyboard closes, blocks the page pinch-zoom (the game's own pinch-to-zoom is untouched) and undoes a page zoom
 * found on load or on coming back to the app. Lists and text fields scroll as always. Desktop and Android don't pan
 * or zoom the page this way, so there it has nothing to do.
 */

/** How close (in CSS px) the visual viewport must be to the window's height to count as "keyboard closed". */
const KEYBOARD_CLOSED_TOLERANCE = 2;
/** After the keyboard opens or focus moves, how long iOS may move the page to reveal the field. */
export const REVEAL_WINDOW_MS = 1_000;
/** After a finger lifts, how long a pan still counts as the user's (the page may glide on). */
export const MOMENTUM_MS = 800;
/** A page zoom further from 1 than this is a zoom, not rounding. */
const ZOOM_TOLERANCE = 0.01;

type ViewportLike = Pick<VisualViewport, "height" | "addEventListener" | "removeEventListener"> &
    Partial<Pick<VisualViewport, "scale" | "pageLeft" | "pageTop">>;

export interface ViewportGuardWindow {
    readonly innerHeight: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly visualViewport: ViewportLike | null;
    readonly document: Document;
    scrollTo(x: number, y: number): void;
    setTimeout(handler: () => void, timeout?: number): number;
    addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void;
}

export interface ViewportGuardOptions {
    /** Called after a page zoom was found and undone, with the zoom found and when it was found. */
    onZoomReset?: (scale: number, reason: "load" | "resume" | "pageshow" | "orientation") => void;
    now?: () => number;
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

/** Where the visible part of the page is: iOS reports a keyboard pan on the visual viewport, others on the window. */
function pagePosition(win: ViewportGuardWindow): { x: number; y: number } {
    const viewport = win.visualViewport;
    return {
        x: viewport?.pageLeft ?? win.scrollX,
        y: viewport?.pageTop ?? win.scrollY,
    };
}

/**
 * Whether the main input is a touch screen (phones, tablets): where the on-screen keyboard and page pinch-zoom
 * move the page. A laptop with a touch screen has a mouse or trackpad as its main pointer, and is left alone.
 */
export function isTouchScreen(win: Pick<Window, "matchMedia">): boolean {
    try {
        return win.matchMedia?.("(pointer: coarse)").matches ?? false;
    } catch {
        return false;
    }
}

/** Scrolls the page (and its root elements) back to the top-left corner if anything moved it. */
export function resetPagePosition(win: ViewportGuardWindow): void {
    const { x, y } = pagePosition(win);
    if (x !== 0 || y !== 0 || win.scrollX !== 0 || win.scrollY !== 0) {
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
 * Whether a drag from this element in this direction moves something on the page (a list, a text field, a slider)
 * rather than the page itself.
 */
function dragMovesSomethingInside(target: EventTarget | null, dx: number, dy: number, doc: Document): boolean {
    let element = target instanceof Element ? target : null;
    const view = doc.defaultView;
    while (element && element !== doc.body && element !== doc.documentElement) {
        if (element instanceof HTMLInputElement || isTextField(element)) return true;
        if (view && element instanceof HTMLElement) {
            const style = view.getComputedStyle(element);
            const scrollsY = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
            const scrollsX = /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
            // A finger moving down scrolls the content back towards its start.
            if (scrollsY && dy > 0 && element.scrollTop > 0) return true;
            if (scrollsY && dy < 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true;
            if (scrollsX && dx > 0 && element.scrollLeft > 0) return true;
            if (scrollsX && dx < 0 && element.scrollLeft + element.clientWidth < element.scrollWidth - 1) return true;
        }
        element = element.parentElement;
    }
    return false;
}

/** Makes iOS drop a page zoom: a changed viewport meta is applied again, and it allows no zoom. */
function resetPageZoom(win: ViewportGuardWindow): void {
    const meta = win.document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const content = meta.getAttribute("content") ?? "";
    meta.setAttribute("content", `${content}, shrink-to-fit=no`);
    win.setTimeout(() => meta.setAttribute("content", content), 50);
}

/**
 * Starts guarding the page position and zoom. Returns a function that stops it.
 */
export function installViewportGuard(
    win: ViewportGuardWindow = window as unknown as ViewportGuardWindow,
    options: ViewportGuardOptions = {}
): () => void {
    const viewport = win.visualViewport;
    const doc = win.document;
    const now = options.now ?? (() => Date.now());

    const pageZoom = () => viewport?.scale ?? 1;
    const isZoomed = () => Math.abs(pageZoom() - 1) > ZOOM_TOLERANCE;
    // A zoomed page also has a smaller visual viewport: that is not a keyboard.
    const keyboardOpen = () =>
        viewport !== null && !isZoomed() && viewport.height < win.innerHeight - KEYBOARD_CLOSED_TOLERANCE;

    // Where the page is held while the keyboard is up: where iOS put it to show the field.
    let anchor: { x: number; y: number } | undefined;
    let revealUntil = 0;
    let fingersDown = 0;
    let userPanUntil = 0;
    let lastTouch: { x: number; y: number } | undefined;
    let wasKeyboardOpen = keyboardOpen();

    const allowReveal = () => {
        revealUntil = now() + REVEAL_WINDOW_MS;
    };
    const userIsPanning = () => fingersDown > 0 || now() < userPanUntil;

    const undoZoom = (reason: "load" | "resume" | "pageshow" | "orientation") => {
        if (!isZoomed() || fingersDown > 0) return;
        const scale = pageZoom();
        resetPageZoom(win);
        resetPagePosition(win);
        options.onZoomReset?.(scale, reason);
    };

    const holdPage = () => {
        if (!keyboardOpen()) {
            // Nothing should move the page itself. With the keyboard closed and no text field focused, any page
            // scroll is a leftover pan: undo it.
            if (!isZoomed() && !isTextField(activeElementDeep(doc))) resetPagePosition(win);
            return;
        }
        const position = pagePosition(win);
        if (anchor === undefined || (now() < revealUntil && !userIsPanning())) {
            // iOS revealing the field: that is where the page stays.
            anchor = position;
            return;
        }
        if (position.x !== anchor.x || position.y !== anchor.y) {
            win.scrollTo(anchor.x, anchor.y);
        }
    };

    // The keyboard opened, closed or changed height (the visual viewport resized).
    const onViewportResize = () => {
        const open = keyboardOpen();
        if (open && !wasKeyboardOpen) {
            anchor = pagePosition(win);
            allowReveal();
        } else if (open) {
            // Another keyboard (a password bar, emoji): iOS may reveal the field again.
            allowReveal();
        } else if (wasKeyboardOpen) {
            anchor = undefined;
            resetPagePosition(win);
        }
        wasKeyboardOpen = open;
    };

    // Focus moves: iOS may pan to show the new field. When a text field lost focus and none took it (focus may be
    // moving to another field, where the keyboard stays up), put the page back once the new focus has landed.
    const onFocusChange = () => {
        allowReveal();
        win.setTimeout(() => {
            const active = activeElementDeep(doc);
            // Focus inside an embedded page shows as the frame itself: its field may still have the keyboard.
            if (!isTextField(active) && !(active instanceof HTMLIFrameElement) && !keyboardOpen()) {
                resetPagePosition(win);
            }
        }, 0);
    };

    const onTouchStart = (event: Event) => {
        const touches = (event as TouchEvent).touches;
        fingersDown = touches?.length ?? 1;
        const touch = touches?.[0];
        lastTouch = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    };

    const onTouchMove = (event: Event) => {
        const touches = (event as TouchEvent).touches;
        if (touches && touches.length > 1) {
            // Two fingers: a pinch. The game zooms itself from its own touch handling; the page never zooms.
            if (event.cancelable) event.preventDefault();
            return;
        }
        const touch = touches?.[0];
        if (!touch) return;
        const dx = lastTouch ? touch.clientX - lastTouch.x : 0;
        const dy = lastTouch ? touch.clientY - lastTouch.y : 0;
        lastTouch = { x: touch.clientX, y: touch.clientY };
        if (!keyboardOpen() || (dx === 0 && dy === 0)) return;
        // With the keyboard up, a drag that moves nothing on the page would drag the page itself.
        if (!dragMovesSomethingInside(event.target, dx, dy, doc) && event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event: Event) => {
        fingersDown = (event as TouchEvent).touches?.length ?? 0;
        if (fingersDown === 0) {
            lastTouch = undefined;
            userPanUntil = now() + MOMENTUM_MS;
        }
    };

    // Safari's own pinch gesture events: cancelling them keeps the page from zooming.
    const onGesture = (event: Event) => {
        if (event.cancelable) event.preventDefault();
    };

    const onVisibilityChange = () => {
        if (doc.visibilityState === "visible") undoZoom("resume");
    };
    const onPageShow = () => undoZoom("pageshow");
    const onOrientationChange = () => {
        win.setTimeout(() => undoZoom("orientation"), 300);
    };

    viewport?.addEventListener("resize", onViewportResize);
    viewport?.addEventListener("scroll", holdPage);
    win.addEventListener("scroll", holdPage, { passive: true });
    win.addEventListener("focusin", onFocusChange, true);
    win.addEventListener("focusout", onFocusChange, true);
    // Focus going into (or out of) an embedded page blurs (or focuses) this window.
    win.addEventListener("blur", allowReveal);
    win.addEventListener("focus", allowReveal);
    win.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    win.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    win.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    win.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });
    win.addEventListener("gesturestart", onGesture, { passive: false });
    win.addEventListener("gesturechange", onGesture, { passive: false });
    win.addEventListener("pageshow", onPageShow);
    win.addEventListener("orientationchange", onOrientationChange);
    doc.addEventListener("visibilitychange", onVisibilityChange);

    undoZoom("load");

    return () => {
        viewport?.removeEventListener("resize", onViewportResize);
        viewport?.removeEventListener("scroll", holdPage);
        win.removeEventListener("scroll", holdPage);
        win.removeEventListener("focusin", onFocusChange, true);
        win.removeEventListener("focusout", onFocusChange, true);
        win.removeEventListener("blur", allowReveal);
        win.removeEventListener("focus", allowReveal);
        win.removeEventListener("touchstart", onTouchStart, true);
        win.removeEventListener("touchmove", onTouchMove, true);
        win.removeEventListener("touchend", onTouchEnd, true);
        win.removeEventListener("touchcancel", onTouchEnd, true);
        win.removeEventListener("gesturestart", onGesture);
        win.removeEventListener("gesturechange", onGesture);
        win.removeEventListener("pageshow", onPageShow);
        win.removeEventListener("orientationchange", onOrientationChange);
        doc.removeEventListener("visibilitychange", onVisibilityChange);
    };
}
