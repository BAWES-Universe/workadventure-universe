import { cubicOut } from "svelte/easing";
import { slide } from "svelte/transition";
import type { SlideParams, TransitionConfig } from "svelte/transition";

/**
 * A section folding open or shut under its header (the people tab's groups, Explore's worlds): a quick slide, eased
 * out like Express, and none for players who ask for less motion.
 */
export function fold(node: Element, params: SlideParams = {}): TransitionConfig {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    return slide(node, { duration: reducedMotion ? 0 : 220, easing: cubicOut, ...params });
}
