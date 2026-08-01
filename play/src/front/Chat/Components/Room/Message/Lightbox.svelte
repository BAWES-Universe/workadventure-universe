<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { fade } from "svelte/transition";
    import { lightboxOpenStore } from "../../../../Stores/UserInputStore";

    export let src: string | undefined;
    export let alt: string | undefined;
    export let show: boolean;
    export let hasPrev: boolean = false;
    export let hasNext: boolean = false;
    export let thumbnails: string[] = [];
    export let currentIndex: number = 0;
    export let isVideo: boolean = false;

    const dispatch = createEventDispatcher<{
        close: void;
        prev: void;
        next: void;
        jump: number;
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

    // Some mobile browsers fire BOTH pointerup and pointercancel for a single
    // gesture (or cancel mid-gesture and up on release). Without this guard the
    // swipe finalizer would run twice — navigating two images per swipe.
    let gestureConsumed = false;

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

    let thumbnailEls: HTMLElement[] = [];

    $: showThumbnails = thumbnails.length >= 2;

    // Reset transform state whenever the lightbox opens or src changes
    $: if (show) {
        scale = 1;
        tx = 0;
        ty = 0;
    }
    $: lightboxOpenStore.set(show);

    // Reset transform on image navigation so zoom/pan doesn't persist between images
    $: if (show && src) {
        scale = 1;
        tx = 0;
        ty = 0;
    }

    // Clean up store on destroy so input doesn't stay blocked after unmount
    onDestroy(() => {
        lightboxOpenStore.set(false);
    });

    // Scroll active thumbnail into view
    $: if (show && showThumbnails && currentIndex >= 0 && thumbnailEls[currentIndex]) {
        thumbnailEls[currentIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
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

    function jumpTo(index: number): void {
        dispatch("jump", index);
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
        const container = document.querySelector("[data-lightbox] img, [data-lightbox] video");
        if (!container) return { cx: 0, cy: 0 };
        const rect = container.getBoundingClientRect();
        return {
            cx: e.clientX - rect.left,
            cy: e.clientY - rect.top,
        };
    }

    // --- Zoom (scroll wheel) — images only ---
    function onWheel(e: WheelEvent): void {
        if (isVideo) return;
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
        gestureConsumed = false;
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

        if (scale > 1 && !isVideo) {
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
        // Finalize a gesture exactly once. Mobile browsers can fire pointerup
        // and pointercancel for the same gesture (or cancel mid-swipe and up on
        // release) — without this, the swipe below would navigate twice.
        if (gestureConsumed) return;
        gestureConsumed = true;
        isDragging = false;

        if (scale <= 1 || isVideo) {
            // Vertical swipe to dismiss
            if (Math.abs(swipeDy) > window.innerHeight * 0.15) {
                swipeDy = 0;
                swipeDx = 0;
                close();
                return;
            }
            // Horizontal swipe to navigate (must be more horizontal than vertical)
            if (Math.abs(swipeDx) > 80 && Math.abs(swipeDx) > Math.abs(swipeDy) * 1.5) {
                const dx = swipeDx;
                // Consume the swipe state before dispatching so a duplicate
                // pointerup/pointercancel cannot re-trigger navigation.
                swipeDx = 0;
                swipeDy = 0;
                // Restore the visual state the move handler applied while
                // dragging (vertical translate + dimmed backdrop) before the
                // image changes — otherwise the backdrop stays darkened and the
                // next image renders offset until the next gesture.
                ty = 0;
                if (lightboxEl) lightboxEl.style.opacity = "";
                if (dx > 0) {
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

        // Double-tap detection (toggle zoom — images only)
        if (!isVideo) {
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
        }

        tapX = e.clientX;
        tapY = e.clientY;

        swipeDy = 0;
        swipeDx = 0;
    }

    function onTouchStart(e: TouchEvent): void {
        if (e.touches.length === 2 && !isVideo) {
            initialPinchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialPinchScale = scale;
        }
    }

    function onTouchMove(e: TouchEvent): void {
        if (e.touches.length === 2 && !isVideo) {
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
        // Close when clicking on the backdrop but NOT on the image/video, controls, or thumbnail strip
        const target = e.target as HTMLElement;
        if (!target.closest("[data-lightbox-content]") && !target.closest("[data-thumbnail-strip]")) {
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

            <!-- Image or Video with zoom/pan -->
            <div
                class="flex items-center justify-center w-full h-full select-none touch-none"
                style="cursor: {isVideo ? 'default' : scale > 1 ? 'grab' : isDragging ? 'grabbing' : 'zoom-in'};"
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
                    {#if isVideo}
                        <!-- svelte-ignore a11y-media-has-caption -->
                        <video
                            {src}
                            controls
                            autoplay
                            draggable="false"
                            class="max-h-[90vh] max-w-[90vw] rounded-sm shadow-2xl"
                            transition:fade={{ duration: 150 }}
                        />
                    {:else}
                        <img
                            {src}
                            {alt}
                            draggable="false"
                            class="max-h-[90vh] max-w-[90vw] object-contain rounded-sm"
                            class:shadow-2xl={scale === 1}
                            style="transform: translate({tx}px, {ty}px) scale({scale});"
                            transition:fade={{ duration: 150 }}
                        />
                    {/if}
                {/key}
            </div>

            <!-- Image counter (top center) -->
            {#if showThumbnails}
                <div
                    class="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-white text-xs font-medium"
                >
                    {currentIndex + 1} / {thumbnails.length}
                </div>
            {/if}

            <!-- Zoom indicator -->
            {#if scale > 1 && !isVideo}
                <div
                    class="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-xs"
                >
                    {scale.toFixed(1)}×
                </div>
            {/if}

            <!-- Thumbnail strip (bottom) — only for 2+ items -->
            {#if showThumbnails}
                <div
                    data-thumbnail-strip
                    class="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 p-2 rounded-xl bg-black/40 max-w-[90vw] overflow-x-auto thumbnail-strip"
                >
                    {#each thumbnails as thumb, i (thumb)}
                        <button
                            class="relative flex-shrink-0 rounded-md overflow-hidden transition-all duration-200 {i ===
                            currentIndex
                                ? 'ring-2 ring-white scale-105 z-10'
                                : 'ring-1 ring-white/20 opacity-50 hover:opacity-80'}"
                            on:click={(e) => {
                                e.stopPropagation();
                                jumpTo(i);
                            }}
                            aria-label="Go to image {i + 1}"
                            bind:this={thumbnailEls[i]}
                        >
                            <img src={thumb} alt="" class="w-12 h-12 object-cover" draggable="false" />
                        </button>
                    {/each}
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

    [data-lightbox] video {
        touch-action: none;
    }

    .thumbnail-strip {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
    }

    .thumbnail-strip::-webkit-scrollbar {
        height: 4px;
    }

    .thumbnail-strip::-webkit-scrollbar-track {
        background: transparent;
    }

    .thumbnail-strip::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 2px;
    }
</style>
