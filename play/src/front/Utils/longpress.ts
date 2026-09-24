import type { Action } from "svelte/action";

export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/**
 * Calls `callback` after a 500ms hold on a touch screen, or on right-click with a mouse.
 * Moving the finger, cancelling the pointer or unmounting cancels the hold.
 * The click that follows a long press is swallowed, so it never also triggers the normal action.
 */
export const longpress: Action<HTMLElement, () => void> = (node, callback) => {
    let onLongPress = callback;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startX = 0;
    let startY = 0;
    let fired = false;

    function cancel() {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    }

    function fire() {
        cancel();
        fired = true;
        onLongPress?.();
    }

    function onPointerDown(event: PointerEvent) {
        fired = false;
        cancel();
        if (event.pointerType === "mouse") return;
        startX = event.clientX;
        startY = event.clientY;
        timer = setTimeout(fire, LONG_PRESS_MS);
    }

    function onPointerMove(event: PointerEvent) {
        if (timer === undefined) return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) {
            cancel();
        }
    }

    function onContextMenu(event: MouseEvent) {
        // Right-click with a mouse, or the browser's own long-press menu on touch screens.
        event.preventDefault();
        if (!fired) {
            fire();
        }
    }

    function onClick(event: MouseEvent) {
        if (fired) {
            fired = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", cancel);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("pointerleave", cancel);
    node.addEventListener("contextmenu", onContextMenu);
    node.addEventListener("click", onClick, true);

    return {
        update(newCallback: () => void) {
            onLongPress = newCallback;
        },
        destroy() {
            cancel();
            node.removeEventListener("pointerdown", onPointerDown);
            node.removeEventListener("pointermove", onPointerMove);
            node.removeEventListener("pointerup", cancel);
            node.removeEventListener("pointercancel", cancel);
            node.removeEventListener("pointerleave", cancel);
            node.removeEventListener("contextmenu", onContextMenu);
            node.removeEventListener("click", onClick, true);
        },
    };
};
