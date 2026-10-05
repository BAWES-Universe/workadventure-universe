<script lang="ts">
    import { fly } from "svelte/transition";
    import { chatVisibilityStore, INITIAL_SIDEBAR_WIDTH, INITIAL_SIDEBAR_WIDTH_MOBILE } from "../Stores/ChatStore";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { isMediaBreakpointUp } from "../Utils/BreakpointsUtils";
    import { LL } from "../../i18n/i18n-svelte";
    import { windowInFrontStore } from "../Stores/WindowInFrontStore";
    import { windowSize } from "../Stores/CoWebsiteStore";
    import SheetDragHandle from "../Components/Sheet/SheetDragHandle.svelte";
    import { clampHeight, getSnapHeights, nearestSnap, nextSnap } from "../Components/Sheet/BottomSheet";
    import { chatFloatInsetStore, chatSidebarWidthStore, chatCarriesItsCloseStore } from "./ChatSidebarWidthStore";
    import Chat from "./Components/Chat.svelte";
    import { selectedRoomStore } from "./Stores/SelectRoomStore";
    import { chatSheetHeightStore, chatSheetLayoutStore, chatSheetSnapStore } from "./ChatSheetStore";
    import { CHAT_SHEET_CLOSE_DISTANCE, CHAT_SHEET_SIZES } from "./ChatSheetSizes";
    import { getLastChatOpenSource } from "./openChat";
    import { IconX } from "@wa-icons";

    let container: HTMLElement;

    const gameScene = gameManager.getCurrentGameScene();

    function reposition() {
        gameScene.reposition();
    }

    function closeChat() {
        chatVisibilityStore.set(false);
    }

    $: isInSpecificDiscussion = $selectedRoomStore !== undefined;

    let sideBarWidth: number = $chatSidebarWidthStore;

    const isRTL: boolean = document.documentElement.dir === "rtl";

    // While the chat is being resized, its handle shows it (violet, a little wider).
    let resizing = false;

    const handleMousedown = (e: MouseEvent) => {
        resizing = true;
        // The pages in windows (Orbit, room websites) would take the mouse as it crosses them, and the drag would stop
        // at their edge. They ignore it until the button is let go.
        document.body.classList.add("chat-resizing");
        let dragX = e.clientX;
        const initialWidth = sideBarWidth;

        document.onmousemove = (e) => {
            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const diff = e.clientX - dragX;

            const newWidth = isRTL ? initialWidth - diff : initialWidth + diff;
            const minWidth = 200;
            const maxWidth = vw - 50;
            const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            sideBarWidth = clampedWidth;
        };
        document.onmouseup = () => {
            resizing = false;
            document.body.classList.remove("chat-resizing");
            document.onmousemove = null;
            chatSidebarWidthStore.set(sideBarWidth);
            reposition();
        };
    };
    // Phones never send a double click from a double tap (the page turns double-tap zoom off), so the handle counts its
    // own taps: two quick taps that do not drag toggle the full width, like a double click on a desktop.
    const DOUBLE_TAP_MS = 300;
    const TAP_SLOP_PX = 10;
    let lastTapAt = 0;
    let lastDoubleTapAt = 0;

    const handleTouchStart = (e: TouchEvent) => {
        resizing = true;
        let dragX = e.targetTouches[0].pageX;
        const startX = dragX;
        let moved = false;

        function onTouchMove(e: TouchEvent) {
            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const diff = e.targetTouches[0].pageX - dragX;
            const newWidth = Math.min(isRTL ? sideBarWidth - diff : sideBarWidth + diff, vw);
            const minWidth = 200;
            const maxWidth = vw - 50;
            const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            sideBarWidth = clampedWidth;

            dragX = e.targetTouches[0].pageX;
            if (Math.abs(dragX - startX) > TAP_SLOP_PX) moved = true;
        }

        function onTouchEnd() {
            resizing = false;
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            chatSidebarWidthStore.set(sideBarWidth);
            reposition();

            const now = Date.now();
            if (moved) {
                lastTapAt = 0;
            } else if (now - lastTapAt < DOUBLE_TAP_MS) {
                lastTapAt = 0;
                lastDoubleTapAt = now;
                toggleFullWidth();
            } else {
                lastTapAt = now;
            }
        }

        document.addEventListener("touchmove", onTouchMove);
        document.addEventListener("touchend", onTouchEnd);
    };

    const handleDbClick = () => {
        // A browser that also turns the double tap into a double click would toggle twice: the tap already counted.
        if (Date.now() - lastDoubleTapAt < 600) return;
        toggleFullWidth();
    };

    const toggleFullWidth = () => {
        if (isChatBarInFullScreen()) {
            const initialWidth = isMediaBreakpointUp("md") ? INITIAL_SIDEBAR_WIDTH_MOBILE : INITIAL_SIDEBAR_WIDTH;
            sideBarWidth = initialWidth;
        } else {
            const fullWidth = document.documentElement.clientWidth;
            sideBarWidth = fullWidth;
        }
        chatSidebarWidthStore.set(sideBarWidth);
        reposition();
    };

    $: chatSidebarWidthStore.set(sideBarWidth);

    const onresize = () => {
        if (isChatSidebarLargerThanWindow() && container) {
            sideBarWidth = document.documentElement.clientWidth;
            chatSidebarWidthStore.set(sideBarWidth);
        }
    };

    const isChatSidebarLargerThanWindow = () => {
        return sideBarWidth >= document.documentElement.clientWidth;
    };

    const isChatBarInFullScreen = () => {
        return sideBarWidth === document.documentElement.clientWidth;
    };

    // ---- Phones held upright: the chat is a sheet from the bottom (ChatSheetStore.ts) ----

    $: sheet = $chatSheetLayoutStore;
    // Height while the handle is dragged; undefined while the sheet rests on a snap.
    let sheetDragHeight: number | undefined;

    // A message arriving in a bubble opens the chat by itself: it opens low, over as little of the map and the
    // videos as it can. Opened on purpose, it opens at "half" (60% of the screen) or the taller height it was left at,
    // so what is inside can be read without dragging it up first.
    // Before the height below, so a chat opened by a bubble starts at peek without a pass at its old height.
    let wasVisible = false;
    $: onVisibilityChange($chatVisibilityStore);
    function onVisibilityChange(visible: boolean) {
        if (visible && !wasVisible) {
            // Reset on opening, not on closing: the sheet slides away at the height it was let go at.
            sheetDragHeight = undefined;
            if (getLastChatOpenSource() === "bubble") chatSheetSnapStore.set("peek");
            else if ($chatSheetSnapStore === "peek") chatSheetSnapStore.set("half");
        }
        wasVisible = visible;
    }

    $: sheetSnapHeights = getSnapHeights($windowSize.height, CHAT_SHEET_SIZES);
    $: sheetHeight = sheetDragHeight ?? sheetSnapHeights[$chatSheetSnapStore];
    // The videos above the sheet follow its height, drag included.
    $: chatSheetHeightStore.set(sheet && $chatVisibilityStore ? sheetHeight : 0);

    function onSheetDrag(height: number) {
        // It follows the finger below its lowest height too, so letting go there closes it.
        sheetDragHeight = clampHeight(height, $windowSize.height, CHAT_SHEET_SIZES, 0);
    }

    function onSheetRelease(height: number) {
        if (height < sheetSnapHeights.peek - CHAT_SHEET_CLOSE_DISTANCE) {
            // Keeps the drag height, so it doesn't jump back up to a snap while sliding away.
            closeChat();
            return;
        }
        sheetDragHeight = undefined;
        chatSheetSnapStore.set(nearestSnap(height, $windowSize.height, CHAT_SHEET_SIZES));
    }

    function onSheetTap() {
        chatSheetSnapStore.set(nextSnap($chatSheetSnapStore));
    }
</script>

<svelte:window on:resize={onresize} />
{#if $chatVisibilityStore && sheet}
    <!-- The sheet keeps the chat's id and test id: everything that looks for the chat finds it. -->
    <!-- A tap anywhere on the chat brings it in front of a window it overlaps. -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <section
        bind:this={container}
        on:pointerdown|capture={() => windowInFrontStore.set("chat")}
        id="chat"
        data-testid="chat"
        transition:fly={{ duration: 200, y: sheetHeight }}
        on:introend={reposition}
        on:outroend={reposition}
        style="height: {sheetHeight}px;"
        class="chatWindow chat-sheet u-surface-flat p-0 screen-blocker"
        class:dragging={sheetDragHeight !== undefined}
    >
        <SheetDragHandle
            {sheetHeight}
            onDrag={onSheetDrag}
            onRelease={onSheetRelease}
            onTap={onSheetTap}
            label={$LL.chat.sheetHandle()}
            testId="chatSheetHandle"
            class="chat-sheet-handle"
        >
            <span class="chat-sheet-grabber" aria-hidden="true" />
        </SheetDragHandle>
        <div class="relative flex-1 min-h-0">
            {#if $chatCarriesItsCloseStore && isInSpecificDiscussion}
                <div class="close-window absolute end-2 top-0 z-50">
                    <button
                        class="u-close"
                        data-testid="closeChatButton"
                        aria-label={$LL.chat.closeChat()}
                        title={$LL.chat.closeChat()}
                        on:click={closeChat}
                    >
                        <IconX font-size="20" />
                    </button>
                </div>
            {/if}
            <Chat sideBarWidth={$windowSize.width} />
        </div>
    </section>
{:else if $chatVisibilityStore}
    <!-- A click anywhere on the chat brings it in front of a window it overlaps. -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <section
        bind:this={container}
        on:pointerdown|capture={() => windowInFrontStore.set("chat")}
        id="chat"
        data-testid="chat"
        transition:fly={{
            duration: 200,
            x: isRTL ? sideBarWidth + $chatFloatInsetStore : -(sideBarWidth + $chatFloatInsetStore),
        }}
        on:introend={reposition}
        on:outroend={reposition}
        style="width: {sideBarWidth}px; max-width: {sideBarWidth}px;"
        class=" chatWindow !min-w-[150px] max-sm:!min-w-[150px] u-surface-flat p-0 screen-blocker"
    >
        {#if $chatCarriesItsCloseStore && isInSpecificDiscussion}
            <!-- The same plain close as the one beside the Chats and People tabs, in the same place. -->
            <div class="close-window absolute end-2 top-3 z-50">
                <button
                    class="u-close"
                    data-testid="closeChatButton"
                    aria-label={$LL.chat.closeChat()}
                    title={$LL.chat.closeChat()}
                    on:click={closeChat}
                >
                    <IconX font-size="20" />
                </button>
            </div>
        {/if}

        <Chat {sideBarWidth} />
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="!absolute !end-1 !top-0 !bottom-0 !m-auto !w-1 !h-32 !bg-white !rounded !cursor-col-resize user-select-none"
            id="resize-bar"
            class:resizing
            on:mousedown={handleMousedown}
            on:dblclick={handleDbClick}
            on:touchstart={handleTouchStart}
        />
    </section>
{/if}

<style lang="scss">
    @use "../style/breakpoints.scss" as *;

    @include media-breakpoint-up(sm) {
        .chatWindow {
            width: 100% !important;
        }
    }

    /* The handle is 4px wide: a finger gets an invisible 200px tall area that runs from the handle out past the
       chat's edge, which the page never scrolls or zooms from. It stays off the chat itself, so the buttons at the
       end of each row keep their clicks. A mouse is precise and keeps the 4px handle: the wider area would catch
       clicks on the game beside the chat. */
    #resize-bar {
        touch-action: none;
    }
    @media (pointer: coarse) {
        #resize-bar::before {
            content: "";
            position: absolute;
            inset-block: -36px;
            inset-inline-start: 0;
            inset-inline-end: -28px;
        }
    }
    /* The sheet: edge to edge at the bottom of the screen, rounded at the top, resized from its handle. */
    .chat-sheet {
        top: auto;
        bottom: 0;
        inset-inline: 0;
        width: 100% !important;
        min-width: 0;
        max-width: none;
        display: flex;
        flex-direction: column;
        border-radius: 24px 24px 0 0;
        transition: height 200ms ease-out;
    }
    .chat-sheet.dragging {
        transition: none;
    }
    /* A 28px strip the whole width of the sheet takes the drag; the grabber shows where. */
    .chat-sheet :global(.chat-sheet-handle) {
        display: flex;
        flex: none;
        justify-content: center;
        width: 100%;
        height: 28px;
        padding: 10px 0 0;
        cursor: ns-resize;
    }
    .chat-sheet-grabber {
        display: block;
        width: 40px;
        height: 5px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.28);
    }
    .chat-sheet :global(.chat-sheet-handle:focus-visible) {
        outline: none;
    }
    .chat-sheet :global(.chat-sheet-handle:focus-visible .chat-sheet-grabber) {
        background: #fff;
    }
    @media (prefers-reduced-motion: reduce) {
        .chat-sheet {
            transition: none;
        }
    }
    #resize-bar.resizing {
        width: 6px !important;
        background-color: #a78bfa !important;
    }
</style>
