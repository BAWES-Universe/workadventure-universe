<script lang="ts">
    import { onDestroy } from "svelte";
    import { SHEET_TAP_TOLERANCE } from "./BottomSheet";

    /** Current sheet height in px, read when a drag starts. */
    export let sheetHeight: number;
    export let onDrag: (height: number) => void;
    export let onRelease: (height: number) => void;
    export let onTap: () => void;
    export let label: string;
    export let testId: string;
    let className = "";
    export { className as class };
    export let style = "";

    let startY = 0;
    let startHeight = 0;
    let lastHeight = 0;
    let moved = false;
    let activePointerId: number | undefined;

    function onPointerDown(event: PointerEvent) {
        if (event.button !== 0) return;
        // Only the first finger drives the sheet; a second one must not take over mid-drag.
        if (activePointerId !== undefined) return;
        activePointerId = event.pointerId;
        startY = event.clientY;
        startHeight = sheetHeight;
        lastHeight = sheetHeight;
        moved = false;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
        if (event.pointerId !== activePointerId) return;
        const delta = startY - event.clientY;
        if (!moved && Math.abs(delta) < SHEET_TAP_TOLERANCE) return;
        moved = true;
        lastHeight = startHeight + delta;
        onDrag(lastHeight);
    }

    function onPointerUp(event: PointerEvent) {
        if (event.pointerId !== activePointerId) return;
        activePointerId = undefined;
        if (moved) {
            onRelease(lastHeight);
        } else {
            onTap();
        }
    }

    function onPointerCancel(event: PointerEvent) {
        if (event.pointerId !== activePointerId) return;
        activePointerId = undefined;
        if (moved) {
            onRelease(lastHeight);
        }
    }

    onDestroy(() => {
        activePointerId = undefined;
    });
</script>

<button
    type="button"
    class="touch-none select-none m-0 bg-transparent text-white {className}"
    {style}
    data-testid={testId}
    aria-label={label}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerCancel}
    on:lostpointercapture={onPointerCancel}
>
    <slot />
</button>
