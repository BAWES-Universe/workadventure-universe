import { readable } from "svelte/store";

/** The `md:` breakpoint the join screens size their WOKA canvases by. It changes when the window or a tablet turns. */
export const joinDesktopStore = readable(false, (set) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return;
    }
    const query = window.matchMedia("(min-width: 768px)");
    set(query.matches);
    const onChange = (event: MediaQueryListEvent) => set(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
});
