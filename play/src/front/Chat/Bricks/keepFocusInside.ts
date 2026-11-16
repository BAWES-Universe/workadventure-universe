import type { Action } from "svelte/action";

/**
 * A dialog keeps the keyboard inside it, closes on Escape, and gives focus back to what had it when it closes (the same
 * as New Brick's dialog). `onClose` is called for Escape.
 */
export const keepFocusInside: Action<HTMLElement, () => void> = (node, onClose) => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const stops = () => Array.from(node.querySelectorAll<HTMLElement>("button:not([disabled]), input"));
    stops()[0]?.focus();

    function onKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            onClose?.();
            return;
        }
        if (event.key !== "Tab") return;
        const all = stops();
        const first = all[0];
        const last = all[all.length - 1];
        if (!first || !last) return;
        if (!node.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    document.addEventListener("keydown", onKeydown);
    return {
        destroy() {
            document.removeEventListener("keydown", onKeydown);
            before?.focus();
        },
    };
};
