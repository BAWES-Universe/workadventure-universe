import type { ActionReturn } from "svelte/action";

export interface MessageGesturesOptions {
    /** Press and hold with a finger, or right-click with a mouse. */
    onOpenMenu: () => void;
    /** Swipe the message right with a finger. Undefined when replying isn't offered. */
    onSwipeReply?: () => void;
    /** How far the swipe is from triggering a reply, 0 to 1, while the finger moves; 0 when it ends. */
    onSwipeProgress?: (progress: number) => void;
    disabled?: boolean;
}

export const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
const SWIPE_TRIGGER_PX = 56;
const SWIPE_MAX_PX = 72;

/**
 * Touch gestures on a chat message, like WhatsApp and iMessage: press and hold opens the message menu, a swipe right
 * replies. Vertical moves are left to the browser so the timeline still scrolls. A right-click opens the same menu,
 * except on a link or over selected text, where the browser's own menu is more useful.
 */
export function messageGestures(
    node: HTMLElement,
    initialOptions: MessageGesturesOptions
): ActionReturn<MessageGesturesOptions> {
    let options = initialOptions;
    let pointerId: number | undefined;
    let startX = 0;
    let startY = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let longPressed = false;
    let swiping = false;
    let swipeOffset = 0;

    node.style.touchAction = "pan-y";

    function clearTimer() {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    }

    function setOffset(offset: number, animate: boolean) {
        swipeOffset = offset;
        node.style.transition = animate ? "transform 180ms ease-out" : "none";
        node.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
        options.onSwipeProgress?.(Math.min(offset / SWIPE_TRIGGER_PX, 1));
    }

    function reset() {
        clearTimer();
        pointerId = undefined;
        // A mouse doesn't go through onPointerDown: a long press must not outlive its finger and swallow a right-click.
        longPressed = false;
        if (swiping || swipeOffset !== 0) setOffset(0, true);
        swiping = false;
    }

    function swallowNextClick() {
        // The finger lifting after a long press must not also open the photo, follow a link, or tap whatever the
        // menu that just opened put under it.
        const swallow = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            window.removeEventListener("click", swallow, { capture: true });
        };
        window.addEventListener("click", swallow, { capture: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
    }

    function onPointerDown(event: PointerEvent) {
        if (options.disabled || event.pointerType === "mouse" || !event.isPrimary) return;
        // In the field you edit a message in, holding selects text and moves the cursor, as in any other field.
        if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']"))
            return;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        longPressed = false;
        swiping = false;
        clearTimer();
        timer = setTimeout(() => {
            timer = undefined;
            if (pointerId === undefined || swiping) return;
            longPressed = true;
            navigator.vibrate?.(10);
            options.onOpenMenu();
        }, LONG_PRESS_MS);
    }

    function onPointerMove(event: PointerEvent) {
        if (event.pointerId !== pointerId || longPressed) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!swiping) {
            if (Math.abs(dy) > MOVE_TOLERANCE_PX && Math.abs(dy) >= Math.abs(dx)) {
                // Scrolling: the browser takes over and sends pointercancel.
                clearTimer();
                return;
            }
            if (options.onSwipeReply && dx > MOVE_TOLERANCE_PX && dx > Math.abs(dy) * 1.5) {
                swiping = true;
                clearTimer();
            } else if (Math.abs(dx) > MOVE_TOLERANCE_PX) {
                clearTimer();
                return;
            }
        }
        if (swiping) {
            setOffset(Math.min(Math.max(dx - MOVE_TOLERANCE_PX, 0) * 0.75, SWIPE_MAX_PX), false);
        }
    }

    function onPointerUp(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        if (longPressed) swallowNextClick();
        if (swiping && swipeOffset >= SWIPE_TRIGGER_PX * 0.75) {
            navigator.vibrate?.(10);
            options.onSwipeReply?.();
            swallowNextClick();
        }
        reset();
    }

    function onPointerCancel(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        reset();
    }

    function onContextMenu(event: MouseEvent) {
        if (options.disabled) return;
        if (longPressed || pointerId !== undefined) {
            // Android sends a context menu for a long press: our menu replaces it.
            event.preventDefault();
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const selection = window.getSelection();
        const hasSelection = !!selection && !selection.isCollapsed && node.contains(selection.anchorNode);
        if (target?.closest("a[href], input, textarea, [contenteditable='true']") || hasSelection) return;
        event.preventDefault();
        options.onOpenMenu();
    }

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", onPointerUp);
    node.addEventListener("pointercancel", onPointerCancel);
    node.addEventListener("contextmenu", onContextMenu);

    return {
        update(newOptions) {
            options = newOptions;
        },
        destroy() {
            clearTimer();
            node.removeEventListener("pointerdown", onPointerDown);
            node.removeEventListener("pointermove", onPointerMove);
            node.removeEventListener("pointerup", onPointerUp);
            node.removeEventListener("pointercancel", onPointerCancel);
            node.removeEventListener("contextmenu", onContextMenu);
        },
    };
}
