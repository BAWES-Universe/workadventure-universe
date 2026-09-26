/**
 * Keeps the app sized to the screen it's really on when coming back to it.
 *
 * The app sizes the game and the interface from the window size, and updates it on `resize`. A phone can report a
 * wrong size to a page that loaded or was restored in the background (a hidden tab, a reload onto a new version),
 * and not send `resize` once the right size is known. The app then stays laid out for a wider screen: the game drawn
 * too large and cut off, and the interface in its desktop layout, until something (switching tabs, rotating) sends
 * `resize`. This checks the size each time the page is shown again, and a little later while the phone settles, and
 * sends `resize` itself when it changed without one. When the size is as the app last saw it, it does nothing.
 */

/** When to check again after the page is shown (ms): at once, and while the phone settles its viewport. */
export const RESYNC_DELAYS_MS = [0, 300, 1000];
/** Differences smaller than this (CSS px) are rounding, not a new size. */
const SIZE_TOLERANCE = 1;

export interface ViewportResyncWindow {
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
    setTimeout(handler: () => void, timeout?: number): number;
    clearTimeout(id: number): void;
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, listener: EventListener): void;
    dispatchEvent(event: Event): boolean;
}

export interface ViewportResyncOptions {
    /** Called when the size had changed without a `resize` and the app was resized, with both sizes. */
    onResync?: (properties: {
        fromWidth: number;
        fromHeight: number;
        toWidth: number;
        toHeight: number;
        reason: "visible" | "pageshow";
    }) => void;
}

/**
 * Starts checking the window size when the page is shown again. Returns a function that stops it.
 */
export function installViewportResync(
    win: ViewportResyncWindow = window as unknown as ViewportResyncWindow,
    options: ViewportResyncOptions = {}
): () => void {
    // The size the app last sized itself to: the size at start, then each `resize`.
    let known = { width: win.innerWidth, height: win.innerHeight };
    let timers: number[] = [];

    const onResize = () => {
        known = { width: win.innerWidth, height: win.innerHeight };
    };

    const check = (reason: "visible" | "pageshow") => {
        if (win.document.visibilityState === "hidden") return;
        const width = win.innerWidth;
        const height = win.innerHeight;
        if (width < 1 || height < 1) return;
        if (Math.abs(width - known.width) < SIZE_TOLERANCE && Math.abs(height - known.height) < SIZE_TOLERANCE) {
            return;
        }
        const from = known;
        // The same as the phone's own `resize`: everything sized from the window updates (and `known` with it).
        win.dispatchEvent(new Event("resize"));
        known = { width, height };
        options.onResync?.({
            fromWidth: from.width,
            fromHeight: from.height,
            toWidth: width,
            toHeight: height,
            reason,
        });
    };

    const scheduleChecks = (reason: "visible" | "pageshow") => {
        for (const timer of timers) win.clearTimeout(timer);
        timers = RESYNC_DELAYS_MS.map((delay) => win.setTimeout(() => check(reason), delay));
    };

    const onVisibilityChange = () => {
        if (win.document.visibilityState === "visible") scheduleChecks("visible");
    };
    const onPageShow = () => scheduleChecks("pageshow");

    win.addEventListener("resize", onResize);
    win.addEventListener("pageshow", onPageShow);
    win.document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
        for (const timer of timers) win.clearTimeout(timer);
        timers = [];
        win.removeEventListener("resize", onResize);
        win.removeEventListener("pageshow", onPageShow);
        win.document.removeEventListener("visibilitychange", onVisibilityChange);
    };
}
