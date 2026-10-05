<script context="module" lang="ts">
    const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    // Whole-ish multiples of the 32px frame so the pixels stay crisp
    const previewSize = desktop ? 144 : 80;
</script>

<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import WokaImage from "./WokaImage.svelte";
    import { getWokaTextureUrl } from "./WokaData";
    import type { WokaData } from "./WokaTypes";
    import { IconRotate, IconShuffle, IconX } from "@wa-icons";

    /**
     * The card both WOKA screens share (the picker and Build your WOKA): the spotlight preview with Rotate and
     * Randomize on the left, the title, pills and tiles on the right, the buttons at the bottom.
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

    onMount(() => {
        // The preview turns on its own, slowly, until you rotate it yourself
        if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            autoTurn = setInterval(() => {
                turn = (turn + 1) % turnOrder.length;
                direction = turnOrder[turn];
            }, 2400);
        }
    });

    onDestroy(stopAutoTurn);
</script>

<div class="woka-backdrop fixed inset-0" style="background-color: {bgColor};" />

<div class="woka-scene pointer-events-auto relative h-dvh flex md:items-center md:justify-center md:p-6">
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
                class="flex-1 min-h-0 flex flex-col md:flex-row gap-3 md:gap-7 px-4 pt-[18px] md:px-7 md:pt-7 pb-24 md:pb-0"
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
                <div class="flex flex-col gap-2 min-w-0 min-h-0 flex-1 md:pe-10">
                    <header class="hidden md:flex flex-col gap-1.5">
                        <span class="u-eyebrow">{eyebrow}</span>
                        <h2 class="u-join-title">{title}</h2>
                    </header>
                    <slot name="tabs" />
                    <div class="woka-tiles flex-1 min-h-0 overflow-y-auto md:mt-3 -mx-1 px-1 pt-1 pb-4">
                        <slot name="tiles" />
                    </div>
                </div>
            </div>

            <footer class="woka-footer">
                <slot name="footer" />
            </footer>
        {/if}
    </div>
</div>

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
    .woka-tiles {
        scrollbar-width: thin;
        scrollbar-color: rgba(196, 181, 253, 0.5) transparent;
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
