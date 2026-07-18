<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { fade } from "svelte/transition";

    export let src: string | undefined;
    export let alt: string | undefined;
    export let show: boolean;
    export let hasPrev: boolean = false;
    export let hasNext: boolean = false;

    const dispatch = createEventDispatcher<{
        close: void;
        prev: void;
        next: void;
    }>();

    const MIN_SCALE = 1;
    const MAX_SCALE = 5;
    const ZOOM_STEP = 2.5;

    let scale = 1;
    let tx = 0;
    let ty = 0;

    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let startY = 0;

    // Pinch zoom
    let initialPinchDist = 0;
    let initialPinchScale = 1;

    // Double-tap detection
    let lastTapTime = 0;
    let tapX = 0;
    let tapY = 0;

    // Swipe-to-dismiss (vertical) and swipe-to-navigate (horizontal)
    let swipeDy = 0;
    let swipeDx = 0;
    let swipeStartX = 0;

    // Portal: move lightbox DOM to body so position:fixed escapes chat sidebar transforms
    let lightboxEl: HTMLElement | undefined;

    // Reset transform state whenever the lightbox opens or src changes
    $: if (show) {
        scale = 1;
        tx = 0;
        ty = 0;
    }
    $: if (show && src) {
        scale = 1;
        tx = 0;
        ty = 0;
    }

    function close(): void {
        dispatch("close");
    }

    function prev(): void {
        if (hasPrev) dispatch("prev");
    }

    function next(): void {
        if (hasNext) dispatch("next");
    }

    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === "Escape") close();
        if (e.key === "ArrowLeft") prev();
        if (e.key === "ArrowRight") next();
    }

    // Svelte portal action — teleports element to document.body
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            },
        };
    }

    function setScale(newScale: number, cx = 0, cy = 0): void {
        // Zoom toward a point on the image
        const ratio = newScale / scale;
        tx = cx - ratio * (cx - tx);
        ty = cy - ratio * (cy - ty);
        scale = newScale;
    }

    /** Get cursor position relative to the image element's top-left (in image-local coords) */
    function imageLocalCoords(e: { clientX: number; clientY: number }): { cx: number; cy: number } {
        const container = document.querySelector("[data-lightbox] img");
        if (!container) return { cx: 0, cy: 0 };
        const rect = container.getBoundingClientRect();
        return {
            cx: e.clientX - rect.left,
            cy: e.clientY - rect.top,
        };
    }

    // --- Zoom (scroll wheel) ---
    function onWheel(e: WheelEvent): void {
        e.preventDefault();
        const delta = -e.deltaY * 0.002;
        if (delta === 0) return;
        const { cx, cy } = imageLocalCoords(e);
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + delta));
        setScale(newScale, cx, cy);
        // Re-center when scrolled all the way out
        if (scale === MIN_SCALE) {
            tx = 0;
            ty = 0;
        }
    }

    function onPointerDown(e: PointerEvent): void {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        startY = e.clientY;
        swipeDy = 0;
        swipeDx = 0;
        swipeStartX = e.clientX;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent): void {
        if (!isDragging) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        if (scale > 1) {
            tx += dx;
            ty += dy;
        } else {
            // Track both vertical (dismiss) and horizontal (navigate) swipe
            swipeDy = e.clientY - startY;
            swipeDx = e.clientX - swipeStartX;
            ty = swipeDy * 0.4;
            const backdrop = lightboxEl;
            if (backdrop) {
                const opacity = Math.max(0.3, 1 - Math.abs(swipeDy) / (window.innerHeight * 0.3));
                backdrop.style.opacity = String(opacity);
            }
        }
    }

    function onPointerUp(e: PointerEvent): void {
        isDragging = false;

        if (scale <= 1) {
            // Vertical swipe to dismiss
            if (Math.abs(swipeDy) > window.innerHeight * 0.15) {
                close();
                return;
            }
            // Horizontal swipe to navigate (must be more horizontal than vertical)
            if (Math.abs(swipeDx) > 80 && Math.abs(swipeDx) > Math.abs(swipeDy) * 1.5) {
                if (swipeDx > 0) {
                    prev();
                } else {
                    next();
                }
                return;
            }
            tx = 0;
            ty = 0;
            if (lightboxEl) lightboxEl.style.opacity = "";
        }

        // Double-tap detection (toggle zoom at any scale)
        const now = Date.now();
        const dx = e.clientX - tapX;
        const dy = e.clientY - tapY;
        if (now - lastTapTime < 300 && Math.abs(dx) < 30 && Math.abs(dy) < 30) {
            if (scale <= 1.1) {
                // Zoom in toward cursor
                const { cx, cy } = imageLocalCoords(e);
                setScale(ZOOM_STEP, cx, cy);
            } else {
                // Zoom out to 1x and re-center
                scale = 1;
                tx = 0;
                ty = 0;
            }
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;
        tapX = e.clientX;
        tapY = e.clientY;

        swipeDy = 0;
        swipeDx = 0;
    }

    function onTouchStart(e: TouchEvent): void {
        if (e.touches.length === 2) {
            initialPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialPinchScale = scale;
        }
    }

    function onTouchMove(e: TouchEvent): void {
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const ratio = dist / initialPinchDist;
            const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, initialPinchScale * ratio));
            scale = newScale;
        }
    }

    function onBackdropClick(e: MouseEvent): void {
        // Close when clicking on the backdrop but NOT on the image or its controls
        const target = e.target as HTMLElement;
        if (!target.closest("[data-lightbox-content]")) {
            close();
        }
    }
</script>

<svelte:window on:keydown={onKeyDown} />

{#if show}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label="Image lightbox"
        use:portal
        bind:this={lightboxEl}
        data-lightbox
        class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 w-full h-full m-0"
        style="opacity: 1; background: rgba(0,0,0,0.8);"
        transition:fade={{ duration: 200 }}
        on:click={onBackdropClick}
        on:keydown={onKeyDown}
    >
        <div data-lightbox-content class="relative w-full h-full flex items-center justify-center" role="none">
            <!-- Close button -->
            <button
                class="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-white/20 transition-colors"
                on:click={close}
                aria-label="Close"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    fill="none"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M18 6l-12 12" />
                    <path d="M6 6l12 12" />
                </svg>
            </button>

            <!-- Previous button (only if multiple images) -->
            {#if hasPrev}
                <button
                    class="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-white/20 transition-colors"
                    on:click={prev}
                    aria-label="Previous image"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        fill="none"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M15 18l-6 -6l6 -6" />
                    </svg>
                </button>
            {/if}

            <!-- Next button (only if multiple images) -->
            {#if hasNext}
                <button
                    class="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 text-white hover:bg-white/20 transition-colors"
                    on:click={next}
                    aria-label="Next image"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="28"
                        height="28"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        fill="none"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    >
                        <path d="M9 18l6 -6l-6 -6" />
                    </svg>
                </button>
            {/if}

            <!-- Image with zoom/pan -->
            <div
                class="flex items-center justify-center w-full h-full select-none touch-none"
                style="cursor: {scale > 1 ? 'grab' : isDragging ? 'grabbing' : 'zoom-in'};"
                on:wheel|preventDefault={onWheel}
                on:pointerdown={onPointerDown}
                on:pointermove={onPointerMove}
                on:pointerup={onPointerUp}
                on:pointercancel={onPointerUp}
                on:touchstart|preventDefault={onTouchStart}
                on:touchmove|preventDefault={onTouchMove}
                role="presentation"
                tabindex="-1"
            >
                {#key src}
                    <img
                        {src}
                        {alt}
                        draggable="false"
                        class="max-h-[90vh] max-w-[90vw] object-contain rounded-sm"
                        class:shadow-2xl={scale === 1}
                        style="transform: translate({tx}px, {ty}px) scale({scale});"
                        transition:fade={{ duration: 150 }}
                    />
                {/key}
            </div>

            <!-- Zoom indicator -->
            {#if scale > 1}
                <div
                    class="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-xs"
                >
                    {scale.toFixed(1)}×
                </div>
            {/if}
        </div>
    </div>
{/if}

<style>
    [data-lightbox] img {
        touch-action: none;
        transition: transform 0.05s linear, box-shadow 0.2s ease;
        transform-origin: 0 0;
    }
</style>
