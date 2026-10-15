/**
 * The installed app on an iPhone (#1016): with the see-through status bar (#969), iOS draws the page from the top
 * edge of the screen but still gives it a viewport (`innerHeight`, `100dvh`, `position: fixed; inset: 0`) as tall as
 * the screen less the status bar. The last 47pt at the bottom then show only the page's background: an empty band
 * under the action bar. The large viewport unit (`100lvh`) still measures the whole screen, so in the installed app
 * the app takes its height from that, and the `u-full-viewport` class sizes the page to it (style.scss).
 *
 * Browsers, Android and an installed app that iOS sizes right are left as they are: there `lvh` and `innerHeight` are
 * the same, or the page is not an installed iOS app.
 */

/** The most the large viewport may exceed `innerHeight` by and still be the status bar (CSS px); more is not it. */
const MAX_STATUS_BAR = 100;
/** Differences smaller than this (CSS px) are rounding. */
const TOLERANCE = 1;

export interface FullViewportWindow {
    readonly innerHeight: number;
    readonly navigator: { readonly standalone?: boolean };
    readonly document: Pick<Document, "createElement" | "documentElement">;
}

type FullViewportListeningWindow = FullViewportWindow & Pick<Window, "addEventListener" | "removeEventListener">;

/** The height of `100lvh` in CSS px, or 0 when it can't be measured. */
function largeViewportHeight(doc: FullViewportWindow["document"]): number {
    const probe = doc.createElement("div");
    probe.style.cssText = "position:absolute;top:0;left:0;width:0;height:100lvh;visibility:hidden;pointer-events:none";
    doc.documentElement.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return height;
}

/**
 * The height the app should fill: the whole screen in an installed iPhone app that iOS sizes short, else
 * `innerHeight`.
 */
export function fullViewportHeight(win: FullViewportWindow = window as unknown as FullViewportWindow): number {
    const inner = win.innerHeight;
    if (win.navigator.standalone !== true) {
        return inner;
    }
    const large = largeViewportHeight(win.document);
    const gap = large - inner;
    return gap > TOLERANCE && gap <= MAX_STATUS_BAR ? Math.round(large) : inner;
}

/**
 * Sizes the page to the whole screen while iOS gives it a short viewport, and keeps it so as the phone turns.
 * Returns a function that stops it.
 */
export function installFullViewportHeight(
    win: FullViewportListeningWindow = window as unknown as FullViewportListeningWindow
): () => void {
    const root = win.document.documentElement;
    const apply = () => {
        const height = fullViewportHeight(win);
        if (height > win.innerHeight) {
            root.style.setProperty("--u-app-height", `${height}px`);
            root.classList.add("u-full-viewport");
        } else {
            root.classList.remove("u-full-viewport");
            root.style.removeProperty("--u-app-height");
        }
    };
    apply();
    win.addEventListener("resize", apply);
    win.addEventListener("orientationchange", apply);
    return () => {
        win.removeEventListener("resize", apply);
        win.removeEventListener("orientationchange", apply);
    };
}
