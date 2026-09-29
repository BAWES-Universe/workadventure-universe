/** Every quest transition is instant when the person asked for less motion. */
export function prefersReducedMotion(): boolean {
    try {
        return (
            typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
        );
    } catch {
        return false;
    }
}

/** A Svelte transition duration: `ms`, or 0 under reduced motion. */
export function motionMs(ms: number): number {
    return prefersReducedMotion() ? 0 : ms;
}
