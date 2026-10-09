import { readable } from "svelte/store";

/**
 * The `mobile:` Tailwind variant (libs/tailwind/tailwind.config.js): a small touch screen, where the action bar sits
 * at the bottom of the screen instead of the top. Keep both queries the same.
 */
export const MOBILE_LAYOUT_QUERY =
    "(((max-height: 960px) and (max-width: 480px)) or ((max-height: 480px) and (max-width: 960px))) and (pointer: coarse)";

/** Whether the `mobile:` layout applies right now (it changes when a phone turns). */
export const mobileLayoutStore = readable(false, (set) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return;
    }
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    set(query.matches);
    const onChange = (event: MediaQueryListEvent) => set(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
});
