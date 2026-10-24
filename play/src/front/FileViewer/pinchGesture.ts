/**
 * Two fingers pinching a viewer. Touch events, as the PDF viewer reads them: a phone's browser takes a two-finger
 * gesture over a scrolling area for its own and cancels the pointer events, so pointer events never see it through.
 */

export interface PinchCentre {
    x: number;
    y: number;
}

/**
 * Calls `onPinch` as two fingers move, with how much the distance between them changed since the last call (more than
 * 1 is wider apart) and where they are, in the target's own coordinates (the page's, for a document). One finger is a
 * scroll and is left alone. Returns how to stop listening.
 */
export function listenForPinch(
    target: Document | HTMLElement,
    onPinch: (factor: number, centre: PinchCentre) => void
): () => void {
    let last = 0;

    // The distance is read on the screen: inside a page that is drawn scaled (a document in a frame), the page's own
    // coordinates change with every zoom step, and the factor would swing from one step to the next.
    const distance = (event: TouchEvent): number =>
        Math.hypot(
            event.touches[0].screenX - event.touches[1].screenX,
            event.touches[0].screenY - event.touches[1].screenY
        );

    const onStart = (event: Event): void => {
        const touches = (event as TouchEvent).touches;
        last = touches.length === 2 ? distance(event as TouchEvent) : 0;
    };

    const onMove = (event: Event): void => {
        const touchEvent = event as TouchEvent;
        if (touchEvent.touches.length !== 2 || last === 0) return;
        // The browser must not zoom or scroll the page under the fingers.
        touchEvent.preventDefault();
        const next = distance(touchEvent);
        if (next === 0) return;
        onPinch(next / last, {
            x: (touchEvent.touches[0].clientX + touchEvent.touches[1].clientX) / 2,
            y: (touchEvent.touches[0].clientY + touchEvent.touches[1].clientY) / 2,
        });
        last = next;
    };

    const onEnd = (event: Event): void => {
        if ((event as TouchEvent).touches.length < 2) last = 0;
    };

    target.addEventListener("touchstart", onStart, { passive: true });
    target.addEventListener("touchmove", onMove, { passive: false });
    target.addEventListener("touchend", onEnd, { passive: true });
    target.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
        target.removeEventListener("touchstart", onStart);
        target.removeEventListener("touchmove", onMove);
        target.removeEventListener("touchend", onEnd);
        target.removeEventListener("touchcancel", onEnd);
    };
}
