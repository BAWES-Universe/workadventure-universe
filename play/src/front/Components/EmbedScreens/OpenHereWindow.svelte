<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import { get } from "svelte/store";
    import { coWebsiteRatio, fullScreenCowebsite, windowSize } from "../../Stores/CoWebsiteStore";
    import { closeAllOpenItems, closeFrontItem } from "../../Stores/ClosedItemsStore";
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
    import {
        openHereBehindChatMin,
        openHereListOpenStore,
        openHereRoomRequestStore,
        openHereSheetHeight,
        openHereSheetRelease,
        openHereSheetRestStore,
    } from "../../Stores/OpenHereSheetStore";
    import {
        clampOpenHereRatio,
        nearestWidthStop,
        OPEN_HERE_START_RATIO,
        stepWidthStop,
    } from "../../Stores/OpenHereWidth";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { prefersReducedMotion } from "../../Phaser/Components/prefersReducedMotion";
    import {
        chatOwnSheetHeightStore,
        chatSheetLayoutStore,
        openHereSheetHeightStore,
        restoreChatAfterFile,
    } from "../../Chat/ChatSheetStore";
    import { CHAT_SHEET_SIZES, type ChatSheetRest } from "../../Chat/ChatSheetSizes";
    import { titleBarHiddenItemStore } from "../../Stores/TitleBarStore";
    import { clampHeight, getSnapHeights, nearestSnap, nextSnap, sheetFrameStyle } from "../Sheet/BottomSheet";
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
    // On a phone the window is behind the chat, except while its list of open items is up: the list comes to the front.
    $: behindChat = $chatVisibilityStore && (floating ? $windowInFrontStore === "chat" : !$openHereListOpenStore);

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

    // The item whose title bar is hidden is alone in the sheet: its close moves up to the handle line.
    $: handleClose = !floating && $titleBarHiddenItemStore !== undefined && $titleBarHiddenItemStore.isClosable();

    // The emote picker, the express tray and a picture shown large close on Esc through their own listeners, which do
    // not mark the key as used. Whether one was open is read before any of them runs, as the one that closes it
    // empties its store: that Esc is theirs, and the window stays.
    let overlayHadEscape = false;
    function onKeyDownCapture(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        overlayHadEscape = $emoteMenuStore || $expressTrayStore !== "closed" || $lightboxOpenStore;
    }

    // Esc closes the item in front when the window is the one in front, like Orbit's (the last item takes the window with
    // it). Esc inside a box (the file's search) belongs to that box, and a key a page inside already used is left alone.
    function onKeyDown(event: KeyboardEvent) {
        if (!floating || event.key !== "Escape" || event.defaultPrevented) return;
        if (behindOrbit || overlayHadEscape) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        // Orbit leaves a key marked as used alone, so one press closes one window.
        event.preventDefault();
        closeFrontItem();
    }

    // ---- Phones held upright: the window is chat's own sheet (Sheet/BottomSheet.ts, SheetHandle.svelte) ----
    // It opens at chat's height and rests where it was left. The chat opens in front of it at its lowest height, with
    // the window rising to the top behind it; closing the chat gives the height back. Dragged down past its lowest
    // height it tucks into a slim row above the bar, so the bar and Orbit are back, instead of closing: a window may
    // hold several items. A tucked sheet stays tucked when the chat opens: it was put away to see the map.
    // Height while the handle is dragged; undefined while the sheet rests.
    let sheetDragHeight: number | undefined;
    $: tucked = !floating && $openHereTuckedStore;
    // The chat is open over a sheet that is up; a tucked one stays as it is, under the chat.
    $: chatOverSheet = !floating && !tucked && $chatVisibilityStore && $chatSheetLayoutStore;
    // Where the handle put the sheet while the chat is open over it (it rises to the top until then). The chat closing
    // gives the height it rested at back, so this is forgotten.
    let behindRest: ChatSheetRest | undefined;
    $: if (!chatOverSheet) behindRest = undefined;
    $: sheetHeight =
        sheetDragHeight ??
        openHereSheetHeight({
            rest: $openHereSheetRestStore,
            tucked,
            chatOver: chatOverSheet,
            behindRest,
            chatHeight: $chatOwnSheetHeightStore,
            viewportHeight: $windowSize.height,
        });
    // The videos above the sheet follow its height, drag included. Tucked, they have all the room again; with the chat
    // open and the window all the way up, they sit above the chat, behind the window. Lower than that, the window
    // leaves them the room above it.
    $: fullHeight = getSnapHeights($windowSize.height, CHAT_SHEET_SIZES).full;
    $: openHereSheetHeightStore.set(
        !floating && !tucked && !(chatOverSheet && sheetHeight >= fullHeight) ? sheetHeight : 0
    );

    // The map is centred in the space the sheet leaves free, which is measured from the sheet as it is at that moment:
    // once more as the sheet stops moving, whether it rose, or was tucked, untucked or snapped to another height. The
    // scene of the moment, as chat's own sheet does it.
    function reposition() {
        gameManager.tryGetCurrentGameScene()?.reposition();
    }

    function onSheetAnimationEnd(event: AnimationEvent) {
        if (!floating && event.target === event.currentTarget) reposition();
    }

    // The sheet settles when its height stops moving; the window when its width does (expanded, collapsed, or snapped
    // to a stop once the grip is let go).
    function onTransitionEnd(event: TransitionEvent) {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName === (floating ? "width" : "height")) reposition();
    }

    // With reduced motion the sheet does not animate or transition, so nothing ends: it has settled as soon as it is drawn
    // (a finger dragging it has not).
    async function repositionWhenDrawn() {
        if (!prefersReducedMotion()) return;
        await tick();
        reposition();
    }

    $: settled = !floating && sheetDragHeight === undefined ? `${sheetHeight} ${tucked}` : undefined;
    $: if (settled !== undefined) void repositionWhenDrawn();

    function onSheetDrag(height: number) {
        if (chatOverSheet) {
            // The chat stays where it is: the window goes no lower than a strip above it, and is not tucked.
            sheetDragHeight = clampHeight(
                height,
                $windowSize.height,
                CHAT_SHEET_SIZES,
                openHereBehindChatMin($chatOwnSheetHeightStore, $windowSize.height)
            );
            return;
        }
        // A tucked sheet dragged up is up again from where the finger is.
        if (tucked) openHereTuckedStore.set(false);
        // It follows the finger below its lowest height too, so letting go there tucks it.
        sheetDragHeight = clampHeight(height, $windowSize.height, CHAT_SHEET_SIZES, 0);
    }

    // Chat taking over mid-drag ends the drag: the finger no longer moves the sheet.
    $: if (chatOverSheet) sheetDragHeight = undefined;

    // Something open in the window asked for room (a list dropped down with none to show): a tucked sheet comes up, and
    // behind the chat it rises to the top. Only a new ask counts, not one made before this window opened.
    let seenRoomRequest = get(openHereRoomRequestStore);
    onDestroy(
        openHereRoomRequestStore.subscribe((request) => {
            if (request === seenRoomRequest) return;
            seenRoomRequest = request;
            if (floating) return;
            if (tucked) openHereTuckedStore.set(false);
            behindRest = undefined;
        })
    );

    function onSheetRelease(height: number) {
        const dragged = sheetDragHeight;
        sheetDragHeight = undefined;
        if (chatOverSheet) {
            const behind = openHereSheetRelease(height, $windowSize.height);
            behindRest = behind === "tuck" ? "peek" : behind;
            // Let go where it already is: no height changes, so no transition ends and the map is centred now.
            if (dragged !== undefined && Math.abs(behindHeightOf(behindRest) - dragged) < 1)
                void tick().then(reposition);
            return;
        }
        const release = openHereSheetRelease(height, $windowSize.height);
        if (release === "tuck") openHereTuckedStore.set(true);
        else openHereSheetRestStore.set(release);
        // A sheet let go where it already is has no height to change, so no transition ends: it has settled now.
        const settledHeight = openHereSheetHeight({
            rest: release === "tuck" ? $openHereSheetRestStore : release,
            tucked: release === "tuck",
            chatOver: false,
            viewportHeight: $windowSize.height,
        });
        if (dragged !== undefined && Math.abs(settledHeight - dragged) < 1) void tick().then(reposition);
    }

    /** How high the window stands behind the chat when it rests at `rest`. */
    function behindHeightOf(rest: ChatSheetRest): number {
        return openHereSheetHeight({
            rest: $openHereSheetRestStore,
            tucked: false,
            chatOver: true,
            behindRest: rest,
            chatHeight: $chatOwnSheetHeightStore,
            viewportHeight: $windowSize.height,
        });
    }

    function onSheetTap() {
        if (chatOverSheet) {
            // At the lowest it can be over the chat, it is at "peek" as far as the next step goes.
            const atLowest = sheetHeight <= openHereBehindChatMin($chatOwnSheetHeightStore, $windowSize.height);
            let step = nextSnap(atLowest ? "peek" : nearestSnap(sheetHeight, $windowSize.height, CHAT_SHEET_SIZES));
            // A tall chat holds a step that would not move the window (peek and half both at its lowest) where it is:
            // the tap goes on to the first step that does.
            for (let tries = 0; tries < 2 && behindHeightOf(step) === sheetHeight; tries++) step = nextSnap(step);
            behindRest = step;
            return;
        }
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

    // The grip on the window's left edge: drag to widen it; it snaps to a third, a half or two thirds when let go.
    // Double tap goes back to a third.
    let card: HTMLElement | undefined;
    let dragRatio: number | undefined;
    let dragStartX: number | undefined;
    let anchorX = 0;
    // Turning the phone sideways swaps chat's sheet for the floating window in the same element. The window takes its
    // place at once, without the expand and collapse motion: its edges would otherwise slide over from where the sheet
    // was. Turned back upright, the sheet keeps its own height motion, which centres the map when it ends.
    let switching = false;
    let wasFloating = floating;
    $: if (floating !== wasFloating) {
        wasFloating = floating;
        if (floating) {
            switching = true;
            // Two frames: the first draws the new place without motion, the second turns the motion back on.
            requestAnimationFrame(() => requestAnimationFrame(() => (switching = false)));
        }
    }
    // A split dragged on an upright phone has no limits: the window opened by turning the phone keeps within these.
    $: ratio = dragRatio ?? clampOpenHereRatio($coWebsiteRatio);

    // The window takes its side of the screen the way Orbit's does: the camera keeps the player in the space it leaves
    // free beside the chat. Expanded, it covers the whole map, so it does not count. The sheet counts until it is tucked.
    $: blocksMap = floating ? !expanded : !tucked;
    // Opening the window, expanding or collapsing it, or a new width once the grip is let go changes what it covers:
    // the map is centred again at once, and once more as the width's motion ends (on:transitionend), as Orbit's does.
    $: floatingPlace = floating && dragRatio === undefined ? `${expanded} ${ratio}` : undefined;
    $: if (floatingPlace !== undefined) reposition();

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
        // A sheet closed while tucked must not bring what Undo restores back tucked: it comes back up.
        openHereTuckedStore.set(false);
        fullScreenCowebsite.set(false);
        // The window or the sheet is gone, and the map has the space again. The chat goes back to the height it had
        // before a file took the screen above it.
        reposition();
        restoreChatAfterFile();
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
    class:screen-blocker={blocksMap}
    class:behind-orbit={behindOrbit}
    class:behind-chat={!behindOrbit && behindChat}
    class:dragging={dragRatio !== undefined || sheetDragHeight !== undefined || switching}
    style={floating ? `--open-here-ratio: ${ratio}` : sheetFrameStyle(sheetHeight, $windowSize.height)}
    data-testid={floating ? "openHereWindow" : "openHereSheet"}
    on:pointerdown|capture={bringForward}
    on:click={onSheetClick}
    on:animationend={onSheetAnimationEnd}
    on:transitionend={onTransitionEnd}
>
    {#if floating}
        <div
            class="open-here-tools flex justify-center items-center content-center u-surface p-2 gap-2 rounded-full absolute z-50"
        >
            <button
                type="button"
                class="u-ab-btn u-ab-icon h-12 w-12 p-0 m-0 rounded-none flex items-center justify-center"
                on:click={toggleExpanded}
                aria-label={expanded ? $LL.cowebsite.compactView() : $LL.cowebsite.fullScreenView()}
                title={expanded ? $LL.cowebsite.compactView() : $LL.cowebsite.fullScreenView()}
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
        <!-- With the title bar hidden ("Hide title bar"), the row that carries the close is not there: the close sits at
             the right end of the handle line instead. A page that may not be closed has no close at all. -->
        <div class="sheet-handle-line" class:with-close={handleClose}>
            <SheetHandle
                {sheetHeight}
                onDrag={onSheetDrag}
                onRelease={onSheetRelease}
                onTap={onSheetTap}
                label={$LL.cowebsite.sheetHandle()}
                testId="openHereSheetHandle"
            />
            {#if handleClose}
                <button
                    type="button"
                    class="sheet-handle-close"
                    title={$LL.chat.fileViewer.close()}
                    aria-label={$LL.chat.fileViewer.close()}
                    data-testid="openHereHandleClose"
                    on:click={closeWindow}
                >
                    <IconX font-size="20" />
                </button>
            {/if}
        </div>
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
            aria-label={$LL.cowebsite.resize()}
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
        // Expanding and collapsing move every edge together, as Orbit's window does (Tailwind's transition-all: 150ms,
        // cubic-bezier(0.4, 0, 0.2, 1)): it grows from where it sits, its own corner held to the screen's.
        transition-property: top, left, right, width, max-width, height;
        transition-duration: 150ms;
        transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);

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
    // The sheet rises from the bottom as chat's does. It is an animation, not a Svelte transition: a transition keeps
    // the old window in the page for a frame after it is removed, and a desktop's window would show twice when an item
    // is replaced.
    @keyframes sheet-rise {
        from {
            transform: translateY(100%);
        }
    }

    .open-here-sheet {
        @include bottom-sheet;
        position: fixed;
        z-index: 2001;
        overflow: hidden;
        pointer-events: auto;
        color: #fff;

        @media (prefers-reduced-motion: no-preference) {
            animation: sheet-rise 200ms ease-out;
        }

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

    // The handle line, with the close at its right end when the title bar is hidden: the same plain 48px icon as the
    // row's, no box. The line grows from the grabber's 28px to 48px so the tap has its room and the page stays clear.
    .sheet-handle-line {
        position: relative;
        flex: none;

        &.with-close {
            height: 48px;

            :global(.sheet-handle) {
                height: 48px;
                padding-top: 0;
                align-items: center;
            }
        }
    }

    .sheet-handle-close {
        position: absolute;
        top: 0;
        inset-inline-end: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 48px;
        height: 48px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: rgba(255, 255, 255, 0.85);
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;

        @media (hover: hover) {
            &:hover {
                color: #fff;
                background: rgba(255, 255, 255, 0.1);
            }
        }

        &:focus-visible {
            outline: none;
            box-shadow: inset 0 0 0 2px #fff;
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
    // Only the edge it is held to moves: setting the far edge too would pin it there at once, and it would grow from
    // the other side of the screen.
    .open-here.expanded {
        top: 0;
        inset-inline-end: 0;
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
