<script context="module" lang="ts">
    const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    // Whole-ish multiples of the 32px frame so the pixels stay crisp
    const previewSize = desktop ? 144 : 80;
</script>

<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { ComponentType } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import WokaImage from "./WokaImage.svelte";
    import { getWokaTextureUrl } from "./WokaData";
    import type { WokaData } from "./WokaTypes";
    import { IconChevronLeft, IconChevronRight, IconRotate, IconShuffle, IconX } from "@wa-icons";

    /**
     * The card both WOKA screens share (the picker and Build your WOKA): the spotlight preview with Rotate and
     * Randomize on the left, the title, the category pills and the tiles on the right, the buttons at the bottom.
     * The tiles scroll down and the categories sideways; swiping the tiles sideways changes the category.
     */
    export let eyebrow: string;
    export let title: string;
    export let selectedTextures: Record<string, string>;
    export let wokaData: WokaData | null;
    export let isLoading: boolean;
    export let error: string;
    export let retry: () => void;
    export let randomize: () => void;
    export let close: (() => void) | undefined = undefined;
    /** The pills over the tiles (collections or parts), shown when there are two or more */
    export let categories: { label: string; count?: number; icon?: ComponentType }[] = [];
    export let category = 0;
    export let swipeHint = "";
    /** The direction the preview faces, which the tiles follow (sheet row: 0 down, 1 left, 2 right, 3 up) */
    export let direction = 0;

    // Rotate turns the WOKA a quarter: down, left, up, right
    const turnOrder = [0, 1, 3, 2];
    let turn = 0;
    let autoTurn: ReturnType<typeof setInterval> | undefined;

    function rotate() {
        stopAutoTurn();
        turn = (turn + 1) % turnOrder.length;
        direction = turnOrder[turn];
    }

    function stopAutoTurn() {
        if (autoTurn) clearInterval(autoTurn);
        autoTurn = undefined;
    }

    const bgColor = gameManager.currentStartedRoom.backgroundColor ?? "#000000";

    // Categories: a fade and an arrow on the right while more pills are off screen
    let pills: HTMLDivElement | undefined;
    let morePills = false;

    function updatePills() {
        if (!pills) return;
        morePills = pills.scrollLeft + pills.clientWidth < pills.scrollWidth - 2;
    }

    function scrollPills() {
        pills?.scrollBy({ left: pills.clientWidth * 0.7, behavior: "smooth" });
    }

    export async function selectCategory(index: number) {
        if (index < 0 || index >= categories.length || index === category) return;
        category = index;
        await tick();
        pills?.querySelectorAll("[role=tab]")[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (tiles) tiles.scrollTop = 0;
        fitTiles();
    }

    // Tiles: they scroll down. The box stops half way through a row so the cut row shows there is more, with a fade
    // at the bottom and a scroll bar while there is.
    let tilesBox: HTMLDivElement | undefined;
    let tiles: HTMLDivElement | undefined;
    let tilesHeight: number | undefined;
    let moreBelow = false;
    let thumbHeight = 0;
    let thumbTop = 0;

    function fitTiles() {
        if (!tilesBox || !tiles) return;
        const grid = tiles.firstElementChild;
        const tile = grid?.firstElementChild;
        if (!(grid instanceof HTMLElement) || !(tile instanceof HTMLElement)) {
            tilesHeight = undefined;
            return;
        }
        const available = tilesBox.clientHeight - (swipeHintBox?.offsetHeight ?? 0);
        const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
        const row = tile.offsetHeight + gap;
        // The grid's own padding keeps the selected ring visible at the top
        const padding = parseFloat(getComputedStyle(grid).paddingTop) || 0;
        if (row <= 0 || grid.offsetHeight <= available) {
            tilesHeight = undefined;
        } else {
            // Keep the cut row between a quarter and three quarters visible; otherwise stop half way through it
            const fit = (available - padding + gap) / row;
            const cut = fit - Math.floor(fit);
            const rows = cut >= 0.25 && cut <= 0.75 ? fit : Math.max(Math.round(fit) - 0.5, 1.5);
            tilesHeight = Math.min(available, Math.round(padding + rows * row));
        }
        void tick().then(updateScroll);
    }

    function updateScroll() {
        if (!tiles) return;
        const { scrollTop, scrollHeight, clientHeight } = tiles;
        moreBelow = scrollTop + clientHeight < scrollHeight - 2;
        thumbHeight = scrollHeight > clientHeight + 2 ? (clientHeight / scrollHeight) * 100 : 0;
        thumbTop = scrollHeight > clientHeight + 2 ? (scrollTop / scrollHeight) * 100 : 0;
    }

    // Swiping the tiles sideways moves to the next or previous category (phones)
    let swipeHintBox: HTMLParagraphElement | undefined;
    let touchStart: { x: number; y: number } | undefined;

    function onTouchStart(event: TouchEvent) {
        const touch = event.touches[0];
        touchStart = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    }

    function onTouchEnd(event: TouchEvent) {
        const touch = event.changedTouches[0];
        if (!touchStart || !touch) return;
        const dx = touch.clientX - touchStart.x;
        const dy = touch.clientY - touchStart.y;
        touchStart = undefined;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        selectCategory(category + (dx < 0 ? 1 : -1)).catch((e) => console.error(e));
    }

    let resizeObserver: ResizeObserver | undefined;

    function observe(box: HTMLElement | undefined, scroller: HTMLElement | undefined) {
        resizeObserver?.disconnect();
        resizeObserver = undefined;
        if (!box || !scroller) return;
        resizeObserver = new ResizeObserver(() => {
            fitTiles();
            updatePills();
        });
        resizeObserver.observe(box);
        if (scroller.firstElementChild) resizeObserver.observe(scroller.firstElementChild);
    }
    $: observe(tilesBox, tiles);
    $: if (pills) updatePills();

    onMount(() => {
        // The preview turns on its own, slowly, until you rotate it yourself
        if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            autoTurn = setInterval(() => {
                turn = (turn + 1) % turnOrder.length;
                direction = turnOrder[turn];
            }, 2400);
        }
    });

    onDestroy(() => {
        stopAutoTurn();
        resizeObserver?.disconnect();
    });
</script>

<div class="woka-backdrop fixed inset-0" style="background-color: {bgColor};" />

<div class="woka-scene pointer-events-auto relative w-full h-dvh flex md:items-center md:justify-center md:p-6">
    <div
        class="u-join-card w-full h-dvh md:w-[1000px] md:max-w-full md:h-[680px] md:max-h-full !rounded-none md:!rounded-[24px] flex flex-col overflow-hidden"
    >
        {#if close}
            <button
                type="button"
                class="u-close u-join-x selectCharacterSceneClose !top-3.5 !right-3 md:!top-4 md:!right-4"
                aria-label={$LL.woka.selectWoka.close()}
                title={$LL.woka.selectWoka.close()}
                on:click={close}
            >
                <IconX font-size="20" />
            </button>
        {/if}

        {#if isLoading}
            <div class="flex-1 grid place-items-center">
                <div class="woka-spinner" />
            </div>
        {:else if error}
            <div class="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <p class="u-join-error">{error}</p>
                <button type="button" class="u-join-btn u-join-btn-sm u-cta-secondary" on:click={retry}
                    >{$LL.woka.selectWoka.retry()}</button
                >
            </div>
        {:else}
            <div
                class="flex-1 min-h-0 flex flex-col md:flex-row gap-3 md:gap-7 px-4 pt-[18px] md:px-7 md:pt-7 pb-[92px] md:pb-0"
            >
                <header class="flex flex-col gap-1 md:hidden {close ? 'pe-12' : ''}">
                    <span class="u-eyebrow">{eyebrow}</span>
                    <h2 class="u-join-title">{title}</h2>
                </header>

                <!-- Preview -->
                <div class="flex md:flex-col items-center gap-3.5 md:gap-3 md:w-[260px] md:flex-none">
                    <div class="u-join-spot woka-spot flex-none">
                        <span class="woka-spot-sprite">
                            <WokaImage
                                {selectedTextures}
                                {wokaData}
                                getTextureUrl={getWokaTextureUrl}
                                canvasSize={previewSize}
                                {direction}
                                walking
                            />
                        </span>
                    </div>
                    <div class="grid md:flex gap-2 flex-1 md:flex-none md:w-full">
                        <button
                            type="button"
                            class="u-join-btn u-join-btn-sm u-cta-secondary md:flex-1"
                            on:click={rotate}
                        >
                            <IconRotate font-size="16" />
                            {$LL.woka.selectWoka.rotate()}
                        </button>
                        <button
                            type="button"
                            class="u-join-btn u-join-btn-sm u-cta-secondary md:flex-1"
                            on:click={randomize}
                        >
                            <IconShuffle font-size="16" />
                            {$LL.woka.selectWoka.shortRandomize()}
                        </button>
                    </div>
                    <p class="u-join-hint hidden md:flex flex-wrap items-center justify-center gap-1 mt-1 text-center">
                        <slot name="hint" />
                    </p>
                </div>

                <!-- Choices -->
                <div class="flex flex-col gap-2 min-w-0 min-h-0 flex-1 md:pe-10 md:pb-4">
                    <header class="hidden md:flex flex-col gap-1.5">
                        <span class="u-eyebrow">{eyebrow}</span>
                        <h2 class="u-join-title">{title}</h2>
                    </header>
                    {#if categories.length > 1}
                        <div class="woka-pills-row relative md:mt-1.5" class:woka-pills-more={morePills}>
                            <div
                                class="woka-pills flex gap-1.5 overflow-x-auto"
                                role="tablist"
                                bind:this={pills}
                                on:scroll={updatePills}
                            >
                                {#each categories as item, index (item.label)}
                                    <button
                                        type="button"
                                        role="tab"
                                        class="u-join-pill flex-none"
                                        aria-selected={index === category}
                                        on:click={() => selectCategory(index)}
                                    >
                                        {#if item.icon}<svelte:component this={item.icon} font-size="16" />{/if}
                                        {item.label}
                                        {#if item.count !== undefined}<b class="woka-count">{item.count}</b>{/if}
                                    </button>
                                {/each}
                            </div>
                            {#if morePills}
                                <button
                                    type="button"
                                    class="woka-pills-arrow"
                                    aria-label={$LL.woka.selectWoka.more()}
                                    title={$LL.woka.selectWoka.more()}
                                    tabindex="-1"
                                    on:click={scrollPills}
                                >
                                    <IconChevronRight font-size="16" />
                                </button>
                            {/if}
                        </div>
                    {/if}
                    <div class="flex-1 min-h-0 md:mt-3 flex flex-col" bind:this={tilesBox}>
                        <div
                            class="woka-tiles relative min-h-0"
                            class:woka-tiles-more={moreBelow}
                            style={tilesHeight ? `height: ${tilesHeight}px;` : ""}
                        >
                            <div
                                class="woka-tiles-scroll h-full overflow-y-auto"
                                bind:this={tiles}
                                on:scroll={updateScroll}
                                on:touchstart|passive={onTouchStart}
                                on:touchend|passive={onTouchEnd}
                            >
                                <slot name="tiles" />
                            </div>
                            {#if thumbHeight > 0}
                                <span class="woka-scrollbar" aria-hidden="true">
                                    <i style="height: {thumbHeight}%; top: {thumbTop}%;" />
                                </span>
                            {/if}
                        </div>
                        {#if swipeHint && categories.length > 1}
                            <p class="woka-swipe-hint" bind:this={swipeHintBox}>
                                <IconChevronLeft font-size="14" />
                                {swipeHint}
                                <IconChevronRight font-size="14" />
                            </p>
                        {/if}
                    </div>
                </div>
            </div>

            <footer class="woka-footer">
                <slot name="footer" />
            </footer>
        {/if}
    </div>
</div>

<svelte:window on:resize={fitTiles} />

<style lang="scss">
    .woka-backdrop {
        z-index: 0;
        background-image: radial-gradient(ellipse at 50% 0%, rgba(134, 41, 252, 0.18), transparent 60%);
    }
    .woka-scene {
        z-index: 1;
    }
    .woka-spot {
        width: 128px;
        height: 128px;
    }
    .woka-spot::after {
        content: "";
        position: absolute;
        left: 24%;
        right: 24%;
        bottom: 20%;
        height: 10px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.45);
        filter: blur(3px);
    }
    .woka-spot-sprite {
        position: relative;
        z-index: 1;
        display: block;
        margin-bottom: 6%;
        line-height: 0;
    }
    @media (min-width: 768px) {
        .woka-spot {
            width: 240px;
            height: 240px;
        }
    }
    .woka-pills {
        scrollbar-width: none;
    }
    .woka-pills::-webkit-scrollbar {
        display: none;
    }
    .woka-pills-more .woka-pills {
        padding-right: 2.75rem;
    }
    .woka-pills-more::after {
        content: "";
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 4.5rem;
        background: linear-gradient(90deg, rgb(20 18 30 / 0), rgb(20 18 30) 70%);
        pointer-events: none;
    }
    .woka-pills-arrow {
        position: absolute;
        top: 50%;
        right: 0;
        z-index: 2;
        display: grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        margin: -1rem 0 0;
        padding: 0;
        border-radius: 50%;
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
    }
    .woka-count {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
    [aria-selected="true"] .woka-count {
        color: rgba(255, 255, 255, 0.85);
    }
    .woka-tiles {
        margin-right: 12px;
    }
    .woka-tiles-scroll {
        scrollbar-width: none;
        border-radius: 14px;
    }
    .woka-tiles-scroll::-webkit-scrollbar {
        display: none;
    }
    .woka-tiles-more::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 30px;
        border-radius: 0 0 14px 14px;
        background: linear-gradient(180deg, rgb(20 18 30 / 0), rgb(20 18 30 / 0.75));
        pointer-events: none;
    }
    .woka-scrollbar {
        position: absolute;
        top: 4px;
        bottom: 4px;
        right: -12px;
        width: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
    }
    .woka-scrollbar i {
        position: absolute;
        left: 0;
        right: 0;
        border-radius: 2px;
        background: rgba(196, 181, 253, 0.7);
    }
    .woka-swipe-hint {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        margin: 0;
        padding-top: 0.75rem;
        font-size: 12px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.55);
    }
    @media (min-width: 768px) {
        .woka-swipe-hint {
            display: none;
        }
    }
    .woka-spinner {
        width: 3rem;
        height: 3rem;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.12);
        border-top-color: #a78bfa;
        animation: woka-spin 900ms linear infinite;
    }
    @keyframes woka-spin {
        to {
            transform: rotate(360deg);
        }
    }
    .woka-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.625rem;
        padding: 1.125rem 1.75rem;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
    }
    @media (max-width: 767px) {
        .woka-footer {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 4;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.5rem;
            padding: 0.75rem 1rem 1.375rem;
            border-top: 0;
            background: linear-gradient(180deg, rgb(20 18 30 / 0), rgb(20 18 30 / 0.96) 26%);
        }
    }
</style>
