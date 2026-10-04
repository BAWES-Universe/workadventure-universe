<script lang="ts">
    import { blur } from "svelte/transition";

    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import { iframeListener } from "../../Api/IframeListener";
    import {
        modalFullScreenStore,
        modalIframeStore,
        modalIframeWindowStore,
        modalVisibilityStore,
    } from "../../Stores/ModalStore";
    import { isMediaBreakpointUp } from "../../Utils/BreakpointsUtils";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { canvasSize } from "../../Stores/CoWebsiteStore";
    import { DESKTOP_LAYOUT_MIN_WIDTH } from "../../Stores/BarInViewStore";
    import { windowInFrontStore } from "../../Stores/WindowInFrontStore";
    import { IconX, IconArrowsMaximize, IconArrowsMinimize } from "@wa-icons";

    /** The device asks for less motion: the panel appears and goes at once, without the blur. */
    function prefersReducedMotion(): boolean {
        return (
            typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
        );
    }

    let modalIframe: HTMLIFrameElement;
    let mainModal: HTMLDivElement;

    // The size is a store, so the page inside the frame (Orbit) can ask for the other one through the bridge.
    $: isFullScreened = $modalFullScreenStore;

    function close() {
        modalVisibilityStore.set(false);
        if ($modalIframeStore != undefined) {
            iframeListener.sendModalCloseTriggered($modalIframeStore);
        }
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            close();
        }
    }

    // A side panel takes its side of the screen the way the chat does: the camera keeps the player centred in what is
    // left of the map (on phones too). A full-screen or centred panel covers the map, so it does not count.
    $: takesSide =
        !isFullScreened && !shouldForceMobileFullScreen && (shown?.position === "right" || shown?.position === "left");

    // A click on the page inside the window never reaches the game, but the game loses the focus to it: the window then
    // comes in front of the chat, as a click on its tools does. Switching to another app also blurs the game, with the
    // focus left wherever it was; the page then has no focus at all, and nothing changes.
    function onWindowBlur() {
        setTimeout(() => {
            if (modalIframe && document.hasFocus() && document.activeElement === modalIframe) {
                windowInFrontStore.set("window");
            }
        }, 0);
    }

    function reposition() {
        gameManager.tryGetCurrentGameScene()?.reposition();
    }

    // Opening the panel, or entering or leaving its full-screen view, changes what it covers. The width animates, so
    // the end of that animation measures again (on:transitionend below).
    let coveredSide: boolean | undefined;
    $: if (mainModal && takesSide !== coveredSide) {
        coveredSide = takesSide;
        reposition();
    }

    onMount(() => {
        resizeObserver.observe(mainModal);
        modalIframeWindowStore.set(modalIframe.contentWindow);
        if ($modalIframeStore?.allowApi) {
            iframeListener.registerIframe(modalIframe);
        }
        // Note: the fullscreen functionality is not implemented yet
        /*if ($modalIframeStore?.position == "center") {
            isFullScreened = true;
        }*/
    });

    onDestroy(() => {
        modalFullScreenStore.set(false);
        // The scene measures on its next frame, after the panel has left the page: the player goes back to the middle.
        reposition();
        // A throw here would leave the closed panel over the whole game, catching every click.
        if (!modalIframe) return;
        if (get(modalIframeWindowStore) === modalIframe.contentWindow) {
            modalIframeWindowStore.set(null);
        }
        // Note: we are running unregisterIframe every time and not only when allowApi is true,
        // because of a possible race condition where the $modalIframeStore store is emptied before onDestroy is called,
        // which would lead to an error in unregisterIframe.
        //if ($modalIframeStore?.allowApi) {
        iframeListener.unregisterIframe(modalIframe);
        //}
    });

    // What the panel shows, kept while it closes: whoever closes it may empty the store in the same turn (opening
    // Explore or the menu does), and the frame and its place must stay put until the panel has gone.
    let shown = $modalIframeStore;
    $: if ($modalIframeStore) shown = $modalIframeStore;

    $: modalUrl = shown ? new URL(shown.src, gameManager.currentStartedRoom.mapUrl).toString() : undefined;

    let isMobile = isMediaBreakpointUp("md");
    const resizeObserver = new ResizeObserver(() => {
        isMobile = isMediaBreakpointUp("md");
    });

    // The full-screen view is offered where the game is at least desktop wide, whatever the chat or the windows take.
    $: offersFullScreen = $canvasSize.width >= DESKTOP_LAYOUT_MIN_WIDTH;

    // On mobile, only force fullscreen for center position, respect right/left positions
    $: shouldForceMobileFullScreen = isMobile && shown?.position === "center";
</script>

<svelte:window on:keydown={onKeyDown} on:blur={onWindowBlur} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="menu-container fixed h-dvh w-dvw z-[2000] pointer-events-auto top-0 transition-all motion-reduce:transition-none {shouldForceMobileFullScreen
        ? 'mobile'
        : shown?.position} {isFullScreened ? 'fullscreened' : ''} {takesSide ? 'screen-blocker' : ''}"
    bind:this={mainModal}
    on:transitionend|self={reposition}
    on:pointerdown|capture={() => windowInFrontStore.set("window")}
>
    <div
        class="modal-panel w-full h-full bg-contrast/80 backdrop-blur rounded"
        transition:blur={{ amount: 10, duration: prefersReducedMotion() ? 0 : 250 }}
    >
        <div
            class={`modal-tools flex justify-center items-center content-center u-surface p-2 gap-2 rounded-full absolute z-50
                ${
                    isFullScreened || shouldForceMobileFullScreen
                        ? "top-4 right-4"
                        : `${
                              shown?.position == "center" || shown?.position == "left"
                                  ? "flex-col top-0 -right-20"
                                  : "flex-col top-0 -left-20"
                          }`
                }
            `}
        >
            {#if modalUrl != undefined}
                {#if shown?.allowFullScreen}
                    <!-- Shown where the game is at least 1024px wide. Measured on the game, not on what the chat and
                         the windows leave of it: the full-screen view covers them all. -->
                    <button
                        class="u-ab-btn u-ab-icon h-12 w-12 p-0 m-0 rounded-none items-center justify-center {offersFullScreen
                            ? 'flex'
                            : 'hidden'}"
                        on:click={() => modalFullScreenStore.update((full) => !full)}
                        aria-label={isFullScreened ? "Return to compact view" : "Open full-screen view"}
                        title={isFullScreened ? "Return to compact view" : "Open full-screen view"}
                    >
                        <span class="u-ab-state" aria-hidden="true" />
                        {#if isFullScreened}
                            <IconArrowsMinimize font-size="20" class="text-white" />
                        {:else}
                            <IconArrowsMaximize font-size="20" class="text-white" />
                        {/if}
                    </button>
                {/if}
            {/if}
            <!-- Close is neutral: closing a window is not a destructive act, so it is not red. -->
            <button
                on:click|preventDefault|stopPropagation={close}
                class="u-ab-btn u-ab-icon h-12 w-12 p-0 m-0 rounded-none flex items-center justify-center"
                data-testid="close-modal-button"
                aria-label={`Close ${shown?.title || "window"}`}
                title={`Close ${shown?.title || "window"}`}
            >
                <span class="u-ab-state" aria-hidden="true" />
                <IconX font-size="20" class="text-white" />
            </button>
        </div>
        {#if modalUrl != undefined}
            <iframe
                id="modalIframe"
                bind:this={modalIframe}
                height="100%"
                width="100%"
                allow={shown?.allow}
                title={shown?.title}
                src={modalUrl}
                class="border-0 relative z-40"
                allowtransparency
                style="color-scheme: auto"
            />
        {/if}
    </div>
</div>

<style lang="scss">
    .menu-container {
        &.mobile {
            width: 100% !important;
            height: 100% !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
        }
        &.right:not(.fullscreened),
        &.left:not(.fullscreened) {
            width: 33%;
            @media (max-width: 991px) {
                width: 80%;
                max-width: 400px;
            }
        }
        &.right {
            right: 0;
        }
        &.left {
            left: 0;
        }
        // Below the floating layout the panel meets the top of the screen, so the close button is held off it by the
        // bar's own 4px gap. On a phone the strip beside the panel is narrow: the button then sits 4px from the screen
        // edge, over the chat button below it, instead of running off the screen.
        @media (max-width: 1023px) {
            // Edge to edge, the panel is square like the page inside it: rounded, its corners showed while the page
            // loaded and then went square.
            &.right .modal-panel,
            &.left .modal-panel,
            &.mobile .modal-panel {
                border-radius: 0;
            }
            &.right:not(.fullscreened) .modal-tools {
                top: 4px;
                left: max(-80px, calc(4px - (100vw - 100%)));
            }
            &.left:not(.fullscreened) .modal-tools {
                top: 4px;
                right: max(-80px, calc(4px - (100vw - 100%)));
            }
        }
        // On a desktop the side panel floats: a rounded card held off the edges, like the menu and the device list.
        // Its width stays the same, because Orbit picks its own layout from the width of the frame. Phones keep the
        // panel edge to edge, where every pixel counts and the close and expand buttons already sit beside it.
        @media (min-width: 1024px) {
            &.right:not(.fullscreened),
            &.left:not(.fullscreened) {
                top: 16px;
                height: calc(100dvh - 32px);

                .modal-panel {
                    border-radius: 24px;
                    box-shadow: var(--u-surface-shadow);
                }

                // The page inside paints its own square background, so the frame is rounded too. Safari only clips
                // a frame's corners when it has its own layer.
                #modalIframe {
                    border-radius: 24px;
                    isolation: isolate;
                }
            }
            &.right:not(.fullscreened) {
                right: 16px;
            }
            // With the bar kept in view, a side window opens under it: the bar is 96px tall (16px padding around a
            // 64px pill), and the window keeps the 16px gap at the bottom. Full screen still takes the whole screen.
            :global(.u-bar-in-view) &.right:not(.fullscreened),
            :global(.u-bar-in-view) &.left:not(.fullscreened) {
                top: 96px;
                height: calc(100dvh - 112px);
            }
            &.left:not(.fullscreened) {
                left: 16px;
            }
        }
        &.center:not(.fullscreened) {
            width: 75%;
            height: 75%;
            left: 0;
            right: 0;
            top: 12.5%;
            margin-right: auto;
            margin-left: auto;
        }
    }
</style>
