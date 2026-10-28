<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
    import { pageDragOffset, tabAfterPageSwipe, tabAfterPillDrag } from "./SwipeTabs";

    /**
     * Tabs that swipe like the other tabs in the game: the gradient pill can be dragged or flicked to another tab, as
     * in the Chats and People tabs, and the page under them can be swiped sideways to the next or previous tab, as in
     * the woka picker. Each tab's page is the "page" slot.
     */
    type Tab = string;
    export let tabs: { id: Tab; label: string; count?: number }[];
    export let active: Tab;
    export let testId = "swipeTabs";

    const dispatch = createEventDispatcher<{ change: Tab }>();
    const isRTL = document.documentElement.dir === "rtl";
    // Right to left, the first tab is on the right: a movement is read in reading direction.
    const readingSign = isRTL ? -1 : 1;

    $: count = tabs.length;
    $: activeIndex = Math.max(
        0,
        tabs.findIndex((tab) => tab.id === active)
    );

    function select(index: number) {
        const tab = tabs[index];
        if (!tab || tab.id === active) return;
        active = tab.id;
        dispatch("change", tab.id);
    }

    // The pill: dragged, it follows the finger; let go, it lands on a tab, and that tab opens. A movement under 6px is
    // a tap, left to the tab's own click.
    let track: HTMLDivElement;
    let tabButtons: HTMLButtonElement[] = [];
    let pillX: number | undefined;
    let pillDrag:
        | {
              pointerId: number;
              startX: number;
              base: number;
              step: number;
              moved: boolean;
              samples: { x: number; t: number }[];
          }
        | undefined;
    let ignoreClicksUntil = 0;

    function pillStep(): number {
        // Tabs are equal, 4px apart, inside the track's 4px padding: one tab's width plus the gap.
        return (track.clientWidth - 8 + 4) / count;
    }

    function startPillDrag(event: PointerEvent) {
        if (count < 2 || (event.pointerType === "mouse" && event.button !== 0)) return;
        const step = pillStep();
        pillDrag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            base: activeIndex * step,
            step,
            moved: false,
            samples: [{ x: event.clientX, t: event.timeStamp }],
        };
    }

    function movePillDrag(event: PointerEvent) {
        if (!pillDrag || event.pointerId !== pillDrag.pointerId) return;
        const dx = (event.clientX - pillDrag.startX) * readingSign;
        if (!pillDrag.moved) {
            if (Math.abs(dx) < 6) return;
            pillDrag.moved = true;
            track.setPointerCapture(event.pointerId);
        }
        pillX = Math.min(pillDrag.step * (count - 1), Math.max(0, pillDrag.base + dx));
        pillDrag.samples = [...pillDrag.samples, { x: event.clientX, t: event.timeStamp }].slice(-5);
    }

    function endPillDrag(event: PointerEvent) {
        if (!pillDrag || event.pointerId !== pillDrag.pointerId) return;
        const ended = pillDrag;
        pillDrag = undefined;
        if (!ended.moved) return;
        ignoreClicksUntil = event.timeStamp + 400;
        const position = pillX ?? ended.base;
        pillX = undefined;
        if (event.type === "pointercancel") return;
        const first = ended.samples[0];
        const last = ended.samples[ended.samples.length - 1];
        const velocity = last.t > first.t ? ((last.x - first.x) * readingSign) / (last.t - first.t) : 0;
        select(tabAfterPillDrag({ from: activeIndex, position, step: ended.step, count, velocity }));
    }

    function clickTab(index: number, event: MouseEvent) {
        if (event.timeStamp < ignoreClicksUntil) return;
        select(index);
    }

    async function onTabKeyDown(event: KeyboardEvent) {
        // Left and right move between the tabs, and the focus moves with them; the arrows never reach the game.
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        const forward = (event.key === "ArrowRight") !== isRTL;
        select(Math.min(count - 1, Math.max(0, activeIndex + (forward ? 1 : -1))));
        await tick();
        tabButtons[activeIndex]?.focus();
    }

    // The pages: a sideways swipe drags them with the finger, and a long enough one moves to the next or previous tab.
    const slideMs = 220;
    let pagesBox: HTMLDivElement;
    let swipe: { x: number; y: number; axis?: "x" | "y" } | undefined;
    let dragX = 0;
    let sliding = false;

    function onTouchStart(event: TouchEvent) {
        const touch = event.touches[0];
        swipe = touch && event.touches.length === 1 && !sliding ? { x: touch.clientX, y: touch.clientY } : undefined;
        dragX = 0;
    }

    function onTouchMove(event: TouchEvent) {
        const touch = event.touches[0];
        if (!swipe || !touch) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (!swipe.axis) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            swipe.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        }
        if (swipe.axis !== "x") return;
        // The sideways swipe is ours, so the browser doesn't also take it as "go back".
        if (event.cancelable) event.preventDefault();
        dragX = pageDragOffset(activeIndex, dx * readingSign, count) * readingSign;
    }

    function onTouchEnd() {
        const swiped = swipe?.axis === "x";
        swipe = undefined;
        if (!swiped) return;
        const next = tabAfterPageSwipe(activeIndex, dragX * readingSign, count);
        sliding = true;
        if (next === activeIndex) {
            dragX = 0;
            setTimeout(() => (sliding = false), slideMs);
            return;
        }
        dragX = (activeIndex - next) * pagesBox.clientWidth * readingSign;
        setTimeout(() => {
            // In one update: the page that slid in takes the place it already sits in, without animating.
            sliding = false;
            dragX = 0;
            select(next);
        }, slideMs);
    }

    // While the tabs are open, a sideways swipe never makes the browser go back a page.
    let rootOverscroll = "";
    onMount(() => {
        rootOverscroll = document.documentElement.style.overscrollBehaviorX;
        document.documentElement.style.overscrollBehaviorX = "none";
    });
    onDestroy(() => {
        document.documentElement.style.overscrollBehaviorX = rootOverscroll;
    });
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid={testId}>
    <div class="px-4 pt-3 pb-2">
        <div
            class="swipe-tabs u-glass relative flex gap-1 rounded-full p-1"
            class:dragging={pillX !== undefined}
            role="tablist"
            style="--tab-count: {count}; --tab-index: {activeIndex};{pillX !== undefined
                ? ` --pill-x: ${pillX * readingSign}px;`
                : ''}"
            bind:this={track}
            on:pointerdown={startPillDrag}
            on:pointermove={movePillDrag}
            on:pointerup={endPillDrag}
            on:pointercancel={endPillDrag}
        >
            {#each tabs as tab, index (tab.id)}
                <button
                    type="button"
                    role="tab"
                    class="swipe-tab"
                    class:is-active={index === activeIndex}
                    aria-selected={index === activeIndex}
                    tabindex={index === activeIndex ? 0 : -1}
                    data-testid="{testId}-{tab.id}"
                    bind:this={tabButtons[index]}
                    on:click={(event) => clickTab(index, event)}
                    on:keydown={onTabKeyDown}
                >
                    <span class="truncate">{tab.label}</span>
                    {#if tab.count !== undefined}
                        <span class="swipe-tab-count tabular-nums">{tab.count}</span>
                    {/if}
                </button>
            {/each}
        </div>
    </div>
    <div
        class="relative min-h-0 flex-1 overflow-hidden"
        bind:this={pagesBox}
        on:touchstart|passive={onTouchStart}
        on:touchmove|nonpassive={onTouchMove}
        on:touchend={onTouchEnd}
        on:touchcancel={onTouchEnd}
    >
        {#each tabs as tab, index (tab.id)}
            {#if Math.abs(index - activeIndex) <= 1}
                <div
                    class="swipe-page absolute inset-0 overflow-y-auto"
                    class:swipe-page-sliding={sliding}
                    role="tabpanel"
                    style="transform: translateX(calc({(index - activeIndex) * 100 * readingSign}% + {dragX}px));"
                    aria-hidden={index !== activeIndex ? "true" : undefined}
                    inert={index !== activeIndex}
                    data-testid="{testId}-page-{tab.id}"
                >
                    <slot name="page" tab={tab.id} isActive={index === activeIndex} />
                </div>
            {/if}
        {/each}
    </div>
</div>

<style>
    /* The same track and gradient pill as the Chats and People tabs, for any number of tabs. */
    .swipe-tabs {
        touch-action: pan-y;
        user-select: none;
        -webkit-user-select: none;
    }
    .swipe-tabs::before {
        content: "";
        position: absolute;
        top: 4px;
        bottom: 4px;
        inset-inline-start: 4px;
        width: calc((100% - 8px - (var(--tab-count) - 1) * 4px) / var(--tab-count));
        border-radius: 9999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 6px 18px -6px rgba(134, 41, 252, 0.9);
        transform: translateX(calc(var(--tab-index) * (100% + 4px)));
        transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    :global([dir="rtl"]) .swipe-tabs::before {
        transform: translateX(calc(var(--tab-index) * (-100% - 4px)));
    }
    /* Dragged: the pill sits under the finger, with no easing to lag behind it. */
    .swipe-tabs.dragging.dragging::before {
        transform: translateX(var(--pill-x));
        transition: none;
    }
    .swipe-tab {
        position: relative;
        z-index: 1;
        margin: 0;
        display: flex;
        flex: 1 1 0;
        min-width: 0;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        height: 2.75rem;
        padding: 0 0.5rem;
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
        background: transparent;
        transition: color 150ms ease;
    }
    .swipe-tab:hover,
    .swipe-tab.is-active {
        color: #fff;
        filter: none;
    }
    .swipe-tab.is-active {
        text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    }
    .swipe-tab:focus:not(:focus-visible) {
        outline: none;
    }
    .swipe-tab:focus-visible {
        outline: 2px solid rgb(255 255 255 / 0.7);
        outline-offset: -2px;
    }
    .swipe-tab-count {
        font-size: 11px;
        font-weight: 700;
        color: rgb(255 255 255 / 0.55);
    }
    .swipe-tab.is-active .swipe-tab-count {
        color: rgb(255 255 255 / 0.85);
    }
    .swipe-page-sliding {
        transition: transform 220ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
        .swipe-tabs::before,
        .swipe-page-sliding {
            transition: none;
        }
    }
</style>
