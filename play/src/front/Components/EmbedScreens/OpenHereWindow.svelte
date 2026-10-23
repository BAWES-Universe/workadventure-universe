<script lang="ts">
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { coWebsiteRatio, fullScreenCowebsite, windowSize } from "../../Stores/CoWebsiteStore";
    import { closeAllOpenItems } from "../../Stores/ClosedItemsStore";
    import { modalVisibilityStore } from "../../Stores/ModalStore";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { windowInFrontStore } from "../../Stores/WindowInFrontStore";
    import { emoteMenuStore } from "../../Stores/EmoteStore";
    import { expressTrayStore } from "../../Stores/ExpressStore";
    import { lightboxOpenStore } from "../../Stores/UserInputStore";
    import { cardOverWindowStore } from "../../Stores/CardOverWindowStore";
    import {
        bringOpenHereInFront,
        openHereTuckedStore,
        sideWindowInFrontStore,
        windowBehindCardStore,
    } from "../../Stores/SideWindowInFrontStore";
    import { openHereSheetHeight, openHereSheetRelease, openHereSheetRestStore } from "../../Stores/OpenHereSheetStore";
    import {
        clampOpenHereRatio,
        nearestWidthStop,
        OPEN_HERE_START_RATIO,
        stepWidthStop,
    } from "../../Stores/OpenHereWidth";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { chatSheetLayoutStore, openHereSheetHeightStore } from "../../Chat/ChatSheetStore";
    import { CHAT_SHEET_SIZES } from "../../Chat/ChatSheetSizes";
    import { clampHeight, nearestSnap, nextSnap, sheetFrameStyle } from "../Sheet/BottomSheet";
    import SheetHandle from "../Sheet/SheetHandle.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import CoWebsitesContainer from "./CoWebsitesContainer.svelte";
    import { IconX, IconArrowsMaximize, IconArrowsMinimize } from "@wa-icons";

    /**
     * False on an upright phone, where the window is chat's own sheet instead: the same component, so turning the phone
     * keeps what is open.
     */
    export let floating = true;

    $: expanded = floating && $fullScreenCowebsite;

    // Orbit and this window open in the same place: the one opened or tapped last is in front. Orbit lives inside the
    // main layout (z-index 10, or 2001 in front of the chat), so a window behind it sits just under that. The chat
    // (2000) and this window take turns the same way.
    // A menu, Settings, Explore or a card opened over it goes in front as well: the window sits under the main layout
    // until it closes, and stays open.
    $: windowBehindCardStore.set(floating && $cardOverWindowStore);
    $: behindOrbit = ($modalVisibilityStore && $sideWindowInFrontStore === "orbit") || $cardOverWindowStore;
    // The sheet is under the chat whenever the chat is open: chat opens in front, and the window rises behind it.
    $: behindChat = $chatVisibilityStore && ($windowInFrontStore === "chat" || !floating);

    function bringForward() {
        if (!floating) return;
        bringOpenHereInFront();
        windowInFrontStore.set("window");
    }

    // A click on a page inside the window never reaches this window, but the game loses the focus to it (the way
    // Orbit's window handles it): the window then comes in front. Switching to another app also blurs the game, with the
    // focus left wherever it was, and nothing changes.
    function onWindowBlur() {
        setTimeout(() => {
            if (
                document.hasFocus() &&
                document.activeElement instanceof HTMLIFrameElement &&
                card?.contains(document.activeElement)
            ) {
                bringForward();
            }
        }, 0);
    }

    function toggleExpanded() {
        if ($fullScreenCowebsite) {
            fullScreenCowebsite.set(false);
        } else {
            fullScreenCowebsite.set(true);
            analyticsClient.fullScreenCowebsite();
        }
    }

    // The close closes the window and everything in it, except a page its map says may not be closed. Two or more
    // closed at once can be undone for a few seconds.
    const closeWindow = closeAllOpenItems;

    // The emote picker, the express tray and a picture shown large close on Esc through their own listeners, which do
    // not mark the key as used. Whether one was open is read before any of them runs, as the one that closes it
    // empties its store: that Esc is theirs, and the window stays.
    let overlayHadEscape = false;
    function onKeyDownCapture(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        overlayHadEscape = $emoteMenuStore || $expressTrayStore !== "closed" || $lightboxOpenStore;
    }

    // Esc closes the window when it is the one in front, like Orbit's. Esc inside a box (the file's search) belongs to
    // that box, and a key a page inside already used is left alone.
    function onKeyDown(event: KeyboardEvent) {
        if (!floating || event.key !== "Escape" || event.defaultPrevented) return;
        if (behindOrbit || overlayHadEscape) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        // Orbit leaves a key marked as used alone, so one press closes one window.
        event.preventDefault();
        closeWindow();
    }

    // ---- Phones held upright: the window is chat's own sheet (Sheet/BottomSheet.ts, SheetHandle.svelte) ----
    // It opens at chat's height and rests where it was left. The chat opens in front of it at its lowest height, with
    // the window rising to the top behind it; closing the chat gives the height back. Dragged down past its lowest
    // height it tucks into a slim row above the bar, so the bar and Orbit are back, instead of closing: a window may
    // hold several items.
    // Height while the handle is dragged; undefined while the sheet rests.
    let sheetDragHeight: number | undefined;
    $: chatOverSheet = !floating && $chatVisibilityStore && $chatSheetLayoutStore;
    // Chat in front hides the tucked row: the sheet waits behind it at full height and comes back tucked once chat closes.
    $: tucked = !floating && $openHereTuckedStore && !chatOverSheet;
    $: sheetHeight =
        sheetDragHeight ??
        openHereSheetHeight({
            rest: $openHereSheetRestStore,
            tucked,
            chatOver: chatOverSheet,
            viewportHeight: $windowSize.height,
        });
    // The videos above the sheet follow its height, drag included. Tucked, they have all the room again; with the chat
    // open, they sit above the chat, behind the window.
    $: openHereSheetHeightStore.set(!floating && !tucked && !chatOverSheet ? sheetHeight : 0);

    function onSheetDrag(height: number) {
        if (chatOverSheet) return;
        // A tucked sheet dragged up is up again from where the finger is.
        if (tucked) openHereTuckedStore.set(false);
        // It follows the finger below its lowest height too, so letting go there tucks it.
        sheetDragHeight = clampHeight(height, $windowSize.height, CHAT_SHEET_SIZES, 0);
    }

    function onSheetRelease(height: number) {
        if (chatOverSheet) return;
        const release = openHereSheetRelease(height, $windowSize.height);
        sheetDragHeight = undefined;
        if (release === "tuck") openHereTuckedStore.set(true);
        else openHereSheetRestStore.set(release);
    }

    function onSheetTap() {
        if (chatOverSheet) return;
        if (tucked) {
            openHereTuckedStore.set(false);
            return;
        }
        openHereSheetRestStore.set(nextSnap(nearestSnap(sheetHeight, $windowSize.height, CHAT_SHEET_SIZES)));
    }

    // A tap on the tucked row (not on one of its buttons) brings the sheet back.
    function onSheetClick(event: MouseEvent) {
        if (tucked && !(event.target as Element | null)?.closest?.("button, a, input")) openHereTuckedStore.set(false);
    }

    // The sheet slides up from the bottom as chat's does; the floating window has no such motion.
    function sheetFly(node: Element, params: { sheet: boolean; height: number }) {
        return params.sheet ? fly(node, { duration: 200, y: params.height }) : { duration: 0 };
    }

    // The grip on the window's left edge: drag to widen it; it snaps to a third, a half or two thirds when let go.
    // Double tap goes back to a third.
    let card: HTMLElement | undefined;
    let dragRatio: number | undefined;
    let dragStartX: number | undefined;
    let anchorX = 0;
    // A split dragged on an upright phone has no limits: the window opened by turning the phone keeps within these.
    $: ratio = dragRatio ?? clampOpenHereRatio($coWebsiteRatio);

    function startDrag(event: PointerEvent) {
        if (!card || event.button !== 0) return;
        const rect = card.getBoundingClientRect();
        // The card's far edge stays where it is: only the grip's side moves.
        anchorX = document.documentElement.dir === "rtl" ? rect.left : rect.right;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        dragStartX = event.clientX;
    }

    // A tap on the grip that never moves leaves the width as it is (a map zone may have set one between the stops).
    function drag(event: PointerEvent) {
        if (dragStartX === undefined) return;
        if (dragRatio === undefined && Math.abs(event.clientX - dragStartX) < 4) return;
        const width = document.documentElement.dir === "rtl" ? event.clientX - anchorX : anchorX - event.clientX;
        dragRatio = clampOpenHereRatio(width / window.innerWidth);
    }

    function endDrag() {
        dragStartX = undefined;
        if (dragRatio === undefined) return;
        coWebsiteRatio.set(nearestWidthStop(dragRatio));
        dragRatio = undefined;
    }

    function onGripKeyDown(event: KeyboardEvent) {
        const rtl = document.documentElement.dir === "rtl";
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const wider = (event.key === "ArrowLeft") !== rtl;
            coWebsiteRatio.set(stepWidthStop(ratio, wider ? 1 : -1));
        }
    }

    onDestroy(() => {
        windowBehindCardStore.set(false);
        openHereSheetHeightStore.set(0);
        fullScreenCowebsite.set(false);
    });
</script>

<svelte:window on:keydown|capture={onKeyDownCapture} on:keydown={onKeyDown} on:blur={onWindowBlur} />

<!-- Looks like Orbit's window and sits where it sits: under the bar, a third of the screen wide, with the same pill
     (expand, close) outside the card. Taking a tap in front brings the window in front of Orbit or the chat. On an
     upright phone it is chat's own sheet instead. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
    class={floating ? "open-here" : "open-here-sheet u-surface-flat"}
    class:expanded
    class:tucked
    class:screen-blocker={!floating && !tucked}
    class:behind-orbit={behindOrbit}
    class:behind-chat={!behindOrbit && behindChat}
    class:dragging={dragRatio !== undefined || sheetDragHeight !== undefined}
    style={floating ? `--open-here-ratio: ${ratio}` : sheetFrameStyle(sheetHeight, $windowSize.height)}
    data-testid={floating ? "openHereWindow" : "openHereSheet"}
    on:pointerdown|capture={bringForward}
    on:click={onSheetClick}
    transition:sheetFly={{ sheet: !floating, height: sheetHeight }}
>
    {#if floating}
        <div
            class="open-here-tools flex justify-center items-center content-center u-surface p-2 gap-2 rounded-full absolute z-50"
        >
            <button
                type="button"
                class="u-ab-btn u-ab-icon h-12 w-12 p-0 m-0 rounded-none flex items-center justify-center"
                on:click={toggleExpanded}
                aria-label={expanded ? "Return to compact view" : "Open full-screen view"}
                title={expanded ? "Return to compact view" : "Open full-screen view"}
                data-testid="openHereExpand"
            >
                <span class="u-ab-state" aria-hidden="true" />
                {#if expanded}
                    <IconArrowsMinimize font-size="20" class="text-white" />
                {:else}
                    <IconArrowsMaximize font-size="20" class="text-white" />
                {/if}
            </button>
            <!-- Close is neutral: closing a window is not a destructive act, so it is not red. -->
            <button
                type="button"
                class="u-ab-btn u-ab-icon h-12 w-12 p-0 m-0 rounded-none flex items-center justify-center"
                on:click|preventDefault|stopPropagation={closeWindow}
                aria-label={$LL.chat.fileViewer.close()}
                title={$LL.chat.fileViewer.close()}
                data-testid="openHereClose"
            >
                <span class="u-ab-state" aria-hidden="true" />
                <IconX font-size="20" class="text-white" />
            </button>
        </div>
    {/if}

    {#if !floating}
        <SheetHandle
            {sheetHeight}
            onDrag={onSheetDrag}
            onRelease={onSheetRelease}
            onTap={onSheetTap}
            label={$LL.cowebsite.sheetHandle()}
            testId="openHereSheetHandle"
        />
    {/if}

    <div bind:this={card} class:open-here-card={floating} class:sheet-card={!floating} id="cowebsites-window">
        <CoWebsitesContainer sheet={!floating} />
    </div>

    {#if floating && !expanded}
        <!-- A focusable separator is the splitter pattern: arrow keys step its width like a drag does. -->
        <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
            class="open-here-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize"
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={25}
            aria-valuemax={90}
            tabindex="0"
            data-testid="openHereGrip"
            on:pointerdown={startDrag}
            on:pointermove={drag}
            on:pointerup={endDrag}
            on:pointercancel={endDrag}
            on:dblclick={() => coWebsiteRatio.set(OPEN_HERE_START_RATIO)}
            on:keydown={onGripKeyDown}
        >
            <span aria-hidden="true" />
        </div>
    {/if}
</div>

<style lang="scss">
    @use "../../style/bottom-sheet.scss" as *;

    .open-here {
        position: fixed;
        z-index: 2001;
        top: env(safe-area-inset-top, 0px);
        inset-inline-end: 0;
        height: calc(100dvh - env(safe-area-inset-top, 0px));
        width: calc(var(--open-here-ratio) * 100vw);
        min-width: min(360px, 100vw);
        max-width: 100vw;
        pointer-events: auto;
        transition: width 160ms ease-out;

        &.dragging {
            transition: none;
        }

        @media (prefers-reduced-motion: reduce) {
            transition: none;
        }

        // Behind Orbit, the window sits just under the main layout (z-index 10); behind the chat, just under it.
        &.behind-orbit {
            z-index: 9;
        }
        &.behind-chat {
            z-index: 1999;
        }
    }

    // Upright on a phone the window is chat's own sheet (bottom-sheet.scss), over the game like chat: under the chat
    // while it is open, under Orbit and the cards that sit over the window, in front of everything else.
    .open-here-sheet {
        @include bottom-sheet;
        position: fixed;
        z-index: 2001;
        overflow: hidden;
        pointer-events: auto;
        color: #fff;

        &.behind-orbit {
            z-index: 9;
        }
        &.behind-chat {
            z-index: 1999;
        }

        // Tucked: one row above the bar, left of Express. The page is behind it, out of sight.
        &.tucked {
            z-index: 9;
            bottom: calc(96px + max(0px, env(safe-area-inset-bottom, 0px) - 21px));
            inset-inline: 8px 76px;
            width: auto !important;
            border-radius: 20px;
            cursor: pointer;

            :global(.open-here-row .open-here-action:not(.open-here-close)) {
                display: none;
            }
        }
    }

    .sheet-card {
        position: relative;
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
    }

    .open-here-card {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: rgb(var(--u-ink));
        padding-top: 0;
    }

    // The pill beside the card, as Orbit's: where the card meets the edge of a small window, it keeps 4px from the
    // screen edge, over the card, instead of running off the screen.
    .open-here-tools {
        flex-direction: column;
        top: calc(4px + env(safe-area-inset-top, 0px));
        inset-inline-start: max(-80px, calc(4px - (100vw - 100%)));
    }

    // On a desktop the window floats like Orbit's: a rounded card held off the edges, under the bar (96px: 16px
    // around a 64px pill), with the same 16px gap at the bottom.
    @media (min-width: 1024px) {
        .open-here:not(.expanded) {
            top: calc(16px + env(safe-area-inset-top, 0px));
            inset-inline-end: 16px;
            height: calc(100dvh - 32px - env(safe-area-inset-top, 0px));
            max-width: calc(100vw - 32px);

            .open-here-card {
                border-radius: 24px;
                box-shadow: var(--u-surface-shadow);
            }
            .open-here-tools {
                top: 0;
                inset-inline-start: -80px;
            }
        }
        :global(.u-bar-in-view) .open-here:not(.expanded) {
            top: calc(96px + env(safe-area-inset-top, 0px));
            height: calc(100dvh - 112px - env(safe-area-inset-top, 0px));
        }
    }

    // Expanded: the window takes the whole screen, over the chat too, with the pill at the top right as Orbit's.
    .open-here.expanded {
        inset: 0;
        width: 100vw;
        height: 100dvh;

        .open-here-card {
            border-radius: 0;
            padding-top: env(safe-area-inset-top, 0px);
        }
        .open-here-tools {
            flex-direction: row;
            top: calc(16px + env(safe-area-inset-top, 0px));
            inset-inline-start: auto;
            inset-inline-end: 16px;
        }
    }

    // The grip on the card's left edge: a short bar, with a finger's width around it to grab.
    .open-here-grip {
        position: absolute;
        inset-inline-start: -3px;
        top: 50%;
        width: 5px;
        height: 48px;
        transform: translateY(-50%);
        cursor: col-resize;
        touch-action: none;
        z-index: 5;

        > span {
            display: block;
            width: 100%;
            height: 100%;
            border-radius: 9999px;
            background: rgba(255, 255, 255, 0.75);
        }

        &::before {
            content: "";
            position: absolute;
            inset-block: -24px;
            inset-inline: -16px;
        }

        &:focus-visible > span {
            box-shadow: 0 0 0 2px #fff;
        }
    }
</style>
