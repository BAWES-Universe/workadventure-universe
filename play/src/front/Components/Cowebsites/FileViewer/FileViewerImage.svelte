<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { writable } from "svelte/store";
    import { createAttachmentUrl, revokeAttachmentUrl } from "../../../Utils/AttachmentUrls";
    import { imageMimeTypeOf } from "../../../FileViewer/fileKinds";
    import type { ViewerController } from "../../../FileViewer/viewerController";

    export let bytes: ArrayBuffer;
    export let name: string;
    export let controller: ViewerController | undefined = undefined;

    const dispatch = createEventDispatcher<{ loaded: void; failed: void }>();

    let container: HTMLDivElement;
    let picture: HTMLImageElement | undefined;
    let url: string | undefined;
    /** How big the picture shows, as a fraction of its own size. */
    let scale = 1;
    let fitScale = 1;
    let naturalWidth = 0;
    let naturalHeight = 0;
    const zoomPercent = writable(100);

    const MIN_SCALE = 0.1;
    const MAX_SCALE = 8;

    function setScale(next: number): void {
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        zoomPercent.set(Math.round(scale * 100));
    }

    function fitToView(): number {
        if (!naturalWidth || !naturalHeight) return 1;
        // Never bigger than the picture's own size, so a small picture is not blurred up.
        return Math.min(1, container.clientWidth / naturalWidth, container.clientHeight / naturalHeight);
    }

    function onLoad(): void {
        if (!picture) return;
        naturalWidth = picture.naturalWidth || 1;
        naturalHeight = picture.naturalHeight || 1;
        fitScale = fitToView();
        setScale(fitScale);
        dispatch("loaded");
    }

    // --- Pinch (two fingers) and Ctrl + wheel zoom ---
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;

    function distance(): number {
        const [first, second] = [...pointers.values()];
        return Math.hypot(first.x - second.x, first.y - second.y);
    }

    function onPointerDown(event: PointerEvent): void {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2) pinchDistance = distance();
    }

    function onPointerMove(event: PointerEvent): void {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2 && pinchDistance > 0) {
            const next = distance();
            setScale(scale * (next / pinchDistance));
            pinchDistance = next;
        }
    }

    function onPointerEnd(event: PointerEvent): void {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinchDistance = 0;
    }

    function onWheel(event: WheelEvent): void {
        if (!event.ctrlKey) return;
        event.preventDefault();
        setScale(scale * Math.exp(-event.deltaY * 0.01));
    }

    onMount(() => {
        url = createAttachmentUrl(bytes, imageMimeTypeOf(name));
        controller = {
            zoomPercent: { subscribe: zoomPercent.subscribe },
            zoomIn: () => setScale(scale * 1.25),
            zoomOut: () => setScale(scale / 1.25),
            fitWidth: () => setScale(naturalWidth ? container.clientWidth / naturalWidth : 1),
        };
    });

    onDestroy(() => {
        if (url) revokeAttachmentUrl(url);
    });
</script>

<div
    bind:this={container}
    class="image-area"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerEnd}
    on:pointercancel={onPointerEnd}
    on:wheel={onWheel}
>
    {#if url}
        <img
            bind:this={picture}
            src={url}
            alt={name}
            draggable="false"
            style:width={naturalWidth ? `${Math.round(naturalWidth * scale)}px` : undefined}
            style:height={naturalHeight ? `${Math.round(naturalHeight * scale)}px` : undefined}
            on:load={onLoad}
            on:error={() => dispatch("failed")}
        />
    {/if}
</div>

<style>
    .image-area {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: #3a3950;
        display: flex;
        touch-action: pan-x pan-y;
    }

    img {
        /* Centred while smaller than the panel, scrollable from the corner once bigger. */
        margin: auto;
        flex: none;
        max-width: none;
        border-radius: 3px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        user-select: none;
    }
</style>
