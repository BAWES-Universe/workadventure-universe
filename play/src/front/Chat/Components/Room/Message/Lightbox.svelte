<script lang="ts">
    import { createEventDispatcher, onDestroy } from "svelte";
    import { fade } from "svelte/transition";
    import { lightboxOpenStore } from "../../../../Stores/UserInputStore";
    import LL from "../../../../../i18n/i18n-svelte";
    import { saveMessageFiles } from "../MessageActions/availableActions";
    import {
        MIN_SCALE,
        clamp,
        doubleTapScaleFor,
        maxScaleFor,
        panBounds,
        realSizeScale,
        rubberBand,
        settleView,
        shouldCloseByDrag,
        zoomAround,
    } from "./lightboxGestures";

    export let src: string | undefined;
    export let alt: string | undefined;
    export let show: boolean;
    export let hasPrev: boolean = false;
    export let hasNext: boolean = false;
    export let thumbnails: string[] = [];
    export let currentIndex: number = 0;
    export let isVideo: boolean = false;
    /** The name the shown file was uploaded under, used when saving it. */
    export let filename: string | undefined = undefined;

    function save() {
        if (!src) return;
        const name = filename && filename.trim() !== "" ? filename : src.split("?")[0].split("/").pop() || "file";
        saveMessageFiles([{ url: src, name }]).catch((error) => console.error(error));
    }

    const dispatch = createEventDispatcher<{
        close: void;
        prev: void;
        next: void;
        jump: number;
    }>();

    let scale = 1;
    let tx = 0;
    let ty = 0;
    /** How much of the dark background is left while the picture is dragged to close (1 = all of it). */
    let backdropOpacity = 1;
    /** True while the picture eases to a resting place (after a pinch, a double tap or a drag that springs back). */
    let animating = false;
    let animatingTimer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;

    // One handler tracks every finger that is down, so a pinch is never read as two separate drags.
    type Mode = "idle" | "pending" | "pan" | "dismiss" | "swipe" | "pinch";
    const MOVE_THRESHOLD = 8;
    const fingers = new Map<number, { x: number; y: number }>();
    let mode: Mode = "idle";
    let start = { x: 0, y: 0 };
    // The pan before the stretchy edge is applied, so pulling past an edge and coming back is smooth.
    let rawX = 0;
    let rawY = 0;
    let pinch = { distance: 1, scale: 1, px: 0, py: 0 };
    // The last moments of a one-finger drag, to tell a quick flick from a slow drag.
    const RECENT_MS = 100;
    let recentMoves: { y: number; t: number }[] = [];
    let lastTap: { x: number; y: number; t: number } | undefined;

    // Portal: move lightbox DOM to body so position:fixed escapes chat sidebar transforms
    let stageEl: HTMLElement | undefined;
    let imgEl: HTMLImageElement | undefined;

    let thumbnailEls: HTMLElement[] = [];

    $: showThumbnails = thumbnails.length >= 2;

    // Reset transform state whenever the lightbox opens or src changes
    $: if (show) resetView();
    // Every picture and GIF in the chat has its own viewer, mostly closed. Only the one that is open speaks for the
    // game's keys, so a closed viewer mounting or leaving never hands them back while another one is on screen.
    let openedStore = false;
    $: if (show) {
        lightboxOpenStore.set(true);
        openedStore = true;
    } else if (openedStore) {
        lightboxOpenStore.set(false);
        openedStore = false;
    }

    // Reset transform on image navigation so zoom/pan doesn't persist between images
    $: if (show && src) resetView();

    function resetView(): void {
        scale = 1;
        tx = 0;
        ty = 0;
        backdropOpacity = 1;
        animating = false;
        dragging = false;
        mode = "idle";
        fingers.clear();
        lastTap = undefined;
    }

    // Clean up store on destroy so input doesn't stay blocked after unmount
    onDestroy(() => {
        clearTimeout(animatingTimer);
        if (openedStore) lightboxOpenStore.set(false);
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

    function stageSize(): { width: number; height: number } {
        return {
            width: stageEl?.clientWidth ?? window.innerWidth,
            height: stageEl?.clientHeight ?? window.innerHeight,
        };
    }

    /** The picture's size on screen at normal zoom (the transform does not change it) and its own size. */
    function pictureSizes(): { fit: { width: number; height: number }; natural: { width: number; height: number } } {
        return {
            fit: { width: imgEl?.offsetWidth ?? 0, height: imgEl?.offsetHeight ?? 0 },
            natural: { width: imgEl?.naturalWidth ?? 0, height: imgEl?.naturalHeight ?? 0 },
        };
    }

    function limits(): { maxScale: number; doubleTapScale: number } {
        const { fit, natural } = pictureSizes();
        const real = realSizeScale(fit, natural);
        const maxScale = maxScaleFor(real);
        return { maxScale, doubleTapScale: doubleTapScaleFor(natural, real, maxScale) };
    }

    /** A point of the screen in the viewer's own coordinates. */
    function localPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
        const rect = stageEl?.getBoundingClientRect();
        return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    }

    function ease(): void {
        animating = true;
        clearTimeout(animatingTimer);
        animatingTimer = setTimeout(() => (animating = false), 260);
    }

    /** Moves the picture to a resting place: back inside its limits, or centred at normal size. */
    function settle(): void {
        const { fit } = pictureSizes();
        const view = settleView({ scale, tx, ty }, fit, stageSize(), limits().maxScale);
        ease();
        scale = view.scale;
        tx = view.tx;
        ty = view.ty;
        backdropOpacity = 1;
    }

    function zoomTo(target: number, point: { x: number; y: number }): void {
        const view = zoomAround({ scale, tx, ty }, point, target, stageSize());
        scale = view.scale;
        tx = view.tx;
        ty = view.ty;
        settle();
    }

    // --- Zoom (scroll wheel) — images only ---
    function onWheel(e: WheelEvent): void {
        if (isVideo) return;
        e.preventDefault();
        if (e.deltaY === 0) return;
        const target = Math.min(limits().maxScale, Math.max(MIN_SCALE, scale * Math.exp(-e.deltaY * 0.002)));
        const view = zoomAround({ scale, tx, ty }, localPoint(e), target, stageSize());
        scale = view.scale;
        tx = view.tx;
        ty = view.ty;
        if (scale <= MIN_SCALE + 0.001) {
            scale = MIN_SCALE;
            tx = 0;
            ty = 0;
        } else {
            const bounds = panBounds(pictureSizes().fit, stageSize(), scale);
            tx = clamp(tx, bounds.x);
            ty = clamp(ty, bounds.y);
        }
    }

    function twoFingers(): { a: { x: number; y: number }; b: { x: number; y: number } } {
        const [a, b] = [...fingers.values()];
        return { a, b };
    }

    function beginPinch(): void {
        const { a, b } = twoFingers();
        const stage = stageSize();
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinch = {
            distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            scale,
            px: (mid.x - stage.width / 2 - tx) / scale,
            py: (mid.y - stage.height / 2 - ty) / scale,
        };
    }

    function onPointerDown(e: PointerEvent): void {
        if (fingers.size >= 2) return;
        try {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
            // The pointer is already gone; the move and up events will not come either.
        }
        fingers.set(e.pointerId, localPoint(e));
        animating = false;
        dragging = true;
        if (fingers.size === 1) {
            mode = "pending";
            start = { ...localPoint(e) };
            rawX = tx;
            rawY = ty;
            recentMoves = [{ y: start.y, t: e.timeStamp }];
        } else if (!isVideo) {
            // The second finger turns the gesture into a pinch. It never fades or closes the viewer.
            if (mode === "dismiss") {
                ty = 0;
                backdropOpacity = 1;
            }
            mode = "pinch";
            beginPinch();
        }
    }

    function onPointerMove(e: PointerEvent): void {
        const before = fingers.get(e.pointerId);
        if (!before) return;
        const point = localPoint(e);
        fingers.set(e.pointerId, point);

        if (mode === "pinch" && fingers.size >= 2) {
            const { a, b } = twoFingers();
            const stage = stageSize();
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const maxScale = limits().maxScale;
            let next = (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance;
            // Past either zoom limit the picture gives a little, then springs back when the fingers lift.
            if (next < MIN_SCALE) next = MIN_SCALE - (MIN_SCALE - next) * 0.5;
            else if (next > maxScale) next = maxScale + (next - maxScale) * 0.3;
            scale = next;
            // Keep the spot that was between the fingers at the start under the middle of the fingers now.
            const bounds = panBounds(pictureSizes().fit, stage, Math.max(MIN_SCALE, next));
            tx = rubberBand(mid.x - stage.width / 2 - pinch.px * next, bounds.x);
            ty = rubberBand(mid.y - stage.height / 2 - pinch.py * next, bounds.y);
            return;
        }
        if (fingers.size !== 1) return;

        const dx = point.x - before.x;
        const dy = point.y - before.y;
        const totalX = point.x - start.x;
        const totalY = point.y - start.y;

        if (mode === "pending" && Math.hypot(totalX, totalY) > MOVE_THRESHOLD) {
            // Zoomed in, one finger moves the picture. At normal size it is a drag up or down (close) or sideways.
            mode =
                scale > MIN_SCALE + 0.01 && !isVideo
                    ? "pan"
                    : Math.abs(totalY) > Math.abs(totalX)
                      ? "dismiss"
                      : "swipe";
        }
        recentMoves.push({ y: point.y, t: e.timeStamp });
        recentMoves = recentMoves.filter((move) => e.timeStamp - move.t <= RECENT_MS);

        if (mode === "pan") {
            rawX += dx;
            rawY += dy;
            const bounds = panBounds(pictureSizes().fit, stageSize(), scale);
            tx = rubberBand(rawX, bounds.x);
            ty = rubberBand(rawY, bounds.y);
        } else if (mode === "dismiss") {
            // The picture follows the finger and only the dark background fades.
            ty = totalY;
            backdropOpacity = 1 - Math.min(0.6, Math.abs(ty) / (stageSize().height * 0.6));
        } else if (mode === "swipe") {
            tx = totalX * 0.3;
        }
    }

    /** How fast the finger was moving up or down just before it lifted, in points per millisecond. */
    function flickVelocityY(now: number): number {
        const recent = recentMoves.filter((move) => now - move.t <= RECENT_MS);
        if (recent.length < 2) return 0;
        const first = recent[0];
        const last = recent[recent.length - 1];
        return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    }

    function finishClose(direction: number): void {
        ease();
        ty = direction * stageSize().height;
        backdropOpacity = 0;
        dragging = false;
        close();
    }

    function onPointerUp(e: PointerEvent): void {
        const point = fingers.get(e.pointerId);
        if (!point) return;
        // pointercancel means the browser took the finger back (a system gesture): never treat that as a request to close.
        const cancelled = e.type === "pointercancel";
        fingers.delete(e.pointerId);

        if (mode === "pinch") {
            if (fingers.size === 1) {
                // One finger lifted: carry on moving from where the picture is now, without a jump.
                const remaining = [...fingers.values()][0];
                mode = "pan";
                rawX = tx;
                rawY = ty;
                start = { ...remaining };
            } else if (fingers.size === 0) {
                mode = "idle";
                dragging = false;
                settle();
            }
            return;
        }
        if (fingers.size > 0) return;

        const finished = mode;
        mode = "idle";
        dragging = false;

        if (finished === "pending" && !cancelled) {
            if (isVideo) return;
            const now = e.timeStamp;
            if (lastTap && now - lastTap.t < 300 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
                lastTap = undefined;
                if (scale > MIN_SCALE + 0.01) {
                    ease();
                    scale = MIN_SCALE;
                    tx = 0;
                    ty = 0;
                } else {
                    zoomTo(limits().doubleTapScale, point);
                }
            } else {
                lastTap = { x: point.x, y: point.y, t: now };
            }
            return;
        }
        if (finished === "dismiss" && !cancelled) {
            if (shouldCloseByDrag(ty, flickVelocityY(e.timeStamp), stageSize().height)) {
                finishClose(ty < 0 ? -1 : 1);
                return;
            }
        }
        if (finished === "swipe" && !cancelled) {
            const totalX = point.x - start.x;
            const totalY = point.y - start.y;
            if (Math.abs(totalX) > 80 && Math.abs(totalX) > Math.abs(totalY) * 1.5) {
                // Reset before the next picture appears, so it does not open offset.
                tx = 0;
                ty = 0;
                backdropOpacity = 1;
                if (totalX > 0) prev();
                else next();
                return;
            }
        }
        settle();
    }

    function onResize(): void {
        if (show) settle();
    }

    // Keeps the browser from also treating the touch as a scroll, a page zoom or a mouse click.
    function preventTouchDefault(e: TouchEvent): void {
        e.preventDefault();
    }

    function onBackdropClick(e: MouseEvent): void {
        // Close when clicking on the backdrop but NOT on the image/video, controls, or thumbnail strip
        const target = e.target as HTMLElement;
        if (!target.closest("[data-lightbox-content]") && !target.closest("[data-thumbnail-strip]")) {
            close();
        }
    }
</script>

<svelte:window on:keydown={onKeyDown} on:resize={onResize} />

{#if show}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-label="Image lightbox"
        use:portal
        data-lightbox
        class="fixed inset-0 z-[9999] flex items-center justify-center w-full h-full m-0"
        style="background: rgba(0,0,0,{0.8 * backdropOpacity});"
        transition:fade={{ duration: 200 }}
        on:click={onBackdropClick}
        on:keydown={onKeyDown}
    >
        <div data-lightbox-content class="relative w-full h-full flex items-center justify-center" role="none">
            <!-- Save button -->
            <button
                class="lb-btn absolute top-[calc(16px+env(safe-area-inset-top))] right-[72px] z-10"
                on:click|stopPropagation={save}
                aria-label={$LL.chat.messageActions.save()}
                title={$LL.chat.messageActions.save()}
                data-testid="lightboxSaveButton"
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
                    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                    <path d="M7 11l5 5l5 -5" />
                    <path d="M12 4l0 12" />
                </svg>
            </button>

            <!-- Close button -->
            <button
                class="lb-btn absolute top-[calc(16px+env(safe-area-inset-top))] right-4 z-10"
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
                    class="lb-btn absolute left-4 top-1/2 -translate-y-1/2 z-10"
                    on:click={prev}
                    aria-label="Previous image"
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
                        <path d="M15 18l-6 -6l6 -6" />
                    </svg>
                </button>
            {/if}

            <!-- Next button (only if multiple images) -->
            {#if hasNext}
                <button
                    class="lb-btn absolute right-4 top-1/2 -translate-y-1/2 z-10"
                    on:click={next}
                    aria-label="Next image"
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
                        <path d="M9 18l6 -6l-6 -6" />
                    </svg>
                </button>
            {/if}

            <!-- Image or Video with zoom/pan -->
            <div
                bind:this={stageEl}
                class="flex items-center justify-center w-full h-full select-none touch-none"
                style="cursor: {isVideo ? 'default' : scale > 1 ? 'grab' : dragging ? 'grabbing' : 'zoom-in'};"
                on:wheel|preventDefault={onWheel}
                on:pointerdown={onPointerDown}
                on:pointermove={onPointerMove}
                on:pointerup={onPointerUp}
                on:pointercancel={onPointerUp}
                on:touchstart|preventDefault={preventTouchDefault}
                on:touchmove|preventDefault={preventTouchDefault}
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
                            bind:this={imgEl}
                            {src}
                            {alt}
                            draggable="false"
                            class="object-contain rounded-sm"
                            class:shadow-2xl={scale === 1}
                            style="max-width: calc(100% - 32px); max-height: 90vh; transform: translate({tx}px, {ty}px) scale({scale}); transition: {animating
                                ? 'transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)'
                                : 'none'};"
                            transition:fade={{ duration: 150 }}
                        />
                    {/if}
                {/key}
            </div>

            <!-- Image counter (top center) -->
            {#if showThumbnails}
                <div
                    class="absolute top-[calc(16px+env(safe-area-inset-top))] left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-white text-xs font-medium"
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
        transform-origin: 50% 50%;
    }

    /* Save, Close, Previous and Next share one button: a 44px circle with a plain white 24px glyph. */
    .lb-btn {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 9999px;
        background: rgba(10, 8, 20, 0.55);
        color: #fff;
        cursor: pointer;
    }

    /* The soft white hover and press: a layer on top of the fill, so nothing changes in size or shadow. */
    .lb-btn::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: #fff;
        opacity: 0;
        pointer-events: none;
    }

    .lb-btn:active::after {
        opacity: 0.08;
    }

    @media (hover: hover) {
        .lb-btn:hover::after {
            opacity: 0.08;
        }
    }

    .lb-btn:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
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
