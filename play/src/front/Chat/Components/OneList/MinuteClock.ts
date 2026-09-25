import { readable } from "svelte/store";

/** "Now", refreshed every 30 seconds while a row shows a relative time ("2m"). Per tab, stops when unused. */
export const minuteClock = readable(Date.now(), (set) => {
    set(Date.now());
    const interval = setInterval(() => set(Date.now()), 30_000);
    return () => clearInterval(interval);
});
