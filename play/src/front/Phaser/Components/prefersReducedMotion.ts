/** True when the player asked their system to reduce motion; the name pill then skips its small animations. */
export function prefersReducedMotion(): boolean {
    try {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}
