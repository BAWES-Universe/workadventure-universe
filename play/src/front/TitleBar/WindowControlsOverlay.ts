import { get, writable } from "svelte/store";

/**
 * The installed app's own title bar (#1019).
 *
 * On a computer, Chrome and Edge can hand the app the strip where they draw their grey title bar and keep only their
 * own buttons (the manifest asks for it with `display_override: ["window-controls-overlay"]`; the player switches it
 * on once with Chrome's small arrow, and Chrome remembers). This module watches that strip, tells the rest of the app
 * how tall it is, and moves the whole page under it so nothing is drawn behind it. Phones, the iPhone app, browser
 * tabs and full screen never have a strip: nothing changes there.
 */

export interface TitleBarGeometry {
    /** Where the free part of the strip starts: Chrome's own buttons are on the other side of it. */
    x: number;
    width: number;
    height: number;
}

/** The part of `navigator.windowControlsOverlay` that is used (not in TypeScript's DOM library yet). */
export interface WindowControlsOverlayApi {
    readonly visible: boolean;
    getTitlebarAreaRect(): { x: number; y: number; width: number; height: number };
    addEventListener(type: "geometrychange", listener: () => void): void;
    removeEventListener(type: "geometrychange", listener: () => void): void;
}

export const TITLE_BAR_CLASS = "u-titlebar";
const HEIGHT_PROPERTY = "--u-titlebar-h";

/** Where the strip is, or undefined when the app has none (the default, and everywhere but an installed computer app). */
export const titleBarGeometryStore = writable<TitleBarGeometry | undefined>(undefined);

/** How tall the strip is: 0 without one. The game and every window are laid out in what is left below it. */
export const titleBarHeightStore = writable(0);

/** The height of the page's usable area: the window's, minus the strip. */
export function appViewportHeight(win: Pick<Window, "innerHeight"> = window): number {
    return Math.max(0, win.innerHeight - get(titleBarHeightStore));
}

/**
 * Shows the strip while the browser says the app owns it, and keeps it in step with its size (the window being
 * resized, the browser's buttons changing). Returns a function that stops watching.
 */
export function startTitleBar(win: Window = window, doc: Document = document): () => void {
    const overlay = (win.navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayApi })
        .windowControlsOverlay;
    if (!overlay) return () => {};

    function update() {
        const rect = overlay?.visible && !doc.fullscreenElement ? overlay.getTitlebarAreaRect() : undefined;
        const height = rect && rect.height > 0 ? Math.round(rect.height) : 0;
        const root = doc.documentElement;
        if (rect && height > 0) {
            root.classList.add(TITLE_BAR_CLASS);
            root.style.setProperty(HEIGHT_PROPERTY, `${height}px`);
            titleBarGeometryStore.set({ x: Math.round(rect.x), width: Math.round(rect.width), height });
        } else {
            root.classList.remove(TITLE_BAR_CLASS);
            root.style.removeProperty(HEIGHT_PROPERTY);
            titleBarGeometryStore.set(undefined);
        }
        if (get(titleBarHeightStore) !== height) {
            titleBarHeightStore.set(height);
            // Nothing in the window itself changed size, but everything is laid out in less (or more) room now.
            win.requestAnimationFrame(() => win.dispatchEvent(new Event("resize")));
        }
    }

    update();
    overlay.addEventListener("geometrychange", update);
    doc.addEventListener("fullscreenchange", update);
    return () => {
        overlay.removeEventListener("geometrychange", update);
        doc.removeEventListener("fullscreenchange", update);
        titleBarGeometryStore.set(undefined);
        titleBarHeightStore.set(0);
        doc.documentElement.classList.remove(TITLE_BAR_CLASS);
        doc.documentElement.style.removeProperty(HEIGHT_PROPERTY);
    };
}
