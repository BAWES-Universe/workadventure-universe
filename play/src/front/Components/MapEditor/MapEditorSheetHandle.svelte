<script lang="ts">
    import { onDestroy } from "svelte";
    import { MAP_EDITOR_SHEET_PEEK_HEIGHT, MAP_EDITOR_SHEET_TAP_TOLERANCE } from "./MapEditorSheet";

    export let title: string;
    /** Current sheet height in px, read when a drag starts. */
    export let sheetHeight: number;
    export let onDrag: (height: number) => void;
    export let onRelease: (height: number) => void;
    export let onTap: () => void;

    let startY = 0;
    let startHeight = 0;
    let lastHeight = 0;
    let moved = false;
    let activePointerId: number | undefined;

    function onPointerDown(event: PointerEvent) {
        if (event.button !== 0) return;
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
        if (!moved && Math.abs(delta) < MAP_EDITOR_SHEET_TAP_TOLERANCE) return;
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
    class="flex w-full shrink-0 touch-none select-none flex-col items-center gap-1 px-4 pb-2 pt-2 m-0 bg-transparent text-white"
    style="height: {MAP_EDITOR_SHEET_PEEK_HEIGHT}px"
    data-testid="mapEditorSheetHandle"
    aria-label={title}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerCancel}
>
    <span class="block h-1.5 w-12 rounded-full bg-white/40" aria-hidden="true" />
    <span class="text-base font-bold truncate max-w-full">{title}</span>
</button>
