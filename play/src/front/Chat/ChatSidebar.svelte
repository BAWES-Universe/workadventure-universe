<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { fly } from "svelte/transition";
    import { chatVisibilityStore, INITIAL_SIDEBAR_WIDTH, INITIAL_SIDEBAR_WIDTH_MOBILE } from "../Stores/ChatStore";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { isMediaBreakpointUp } from "../Utils/BreakpointsUtils";
    import { LL } from "../../i18n/i18n-svelte";
    import { windowInFrontStore } from "../Stores/WindowInFrontStore";
    import { windowSize } from "../Stores/CoWebsiteStore";
    import SheetHandle from "../Components/Sheet/SheetHandle.svelte";
    import {
        clampHeight,
        getSnapHeights,
        nearestSnap,
        nextSnap,
        sheetFrameStyle,
    } from "../Components/Sheet/BottomSheet";
    import { openHereSheetUpStore } from "../Stores/OpenHereSheetStore";
    import { chatFloatInsetStore, chatSidebarWidthStore, chatCarriesItsCloseStore } from "./ChatSidebarWidthStore";
    import Chat from "./Components/Chat.svelte";
    import { selectedRoomStore } from "./Stores/SelectRoomStore";
    import { chatInviteSheetHeightStore, chatSearchOpenStore } from "./Stores/ChatStore";
    import {
        chatOwnSheetHeightStore,
        chatSheetLayoutStore,
        chatSheetSnapStore,
        keepChatSheetRest,
    } from "./ChatSheetStore";
    import {
        CHAT_SHEET_CLOSE_DISTANCE,
        CHAT_SHEET_SIZES,
        chatSheetFitHeight,
        chatSheetInviteHeight,
        chatSheetRestingHeight,
    } from "./ChatSheetSizes";
    import { getLastChatOpenSource } from "./openChat";
    import { IconX } from "@wa-icons";

    let container: HTMLElement;

    // The scene of the moment: a reconnect replaces it while the chat stays open.
    function reposition(instant = false) {
        gameManager.tryGetCurrentGameScene()?.reposition(instant);
    }

    // The chat can come back already open, with no slide in to end: after a reconnect (the "Reconnecting" screen
    // takes it away, and the new scene's camera knows nothing of it) or a chat refresh. The map is centred again
    // in the space it leaves free, at once, as the game shows again.
    onMount(() => {
        if ($chatVisibilityStore) reposition(true);
    });

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

    // A message arriving in a bubble opens the chat by itself: it opens just tall enough to show that latest message
    // above the field to type in, over as little of the map and the videos as it can. Opened on purpose, it opens
    // where it was left: 60% of the screen at first, then the height the person last dragged it to. Over a file or
    // a page in the window it opens at its lowest height, so the window shows above it.
    // Height while it shows the latest message of a bubble (or sits low over the window), until the person moves it;
    // undefined otherwise.
    let bubbleHeight: number | undefined;
    // While the sheet keeps the bubble's height, it grows to show each latest message whole (messages load after it
    // opens, and a long one may follow), never shrinking under the reader. Declared before anything below can run
    // (the store subscription calls back at once).
    let latestMessageObserver: MutationObserver | undefined;
    let fitFrame: number | undefined;
    // The chat sits at its lowest height only because the window's sheet is up: it goes back to its rest once that is gone.
    let lowForSheet = false;
    $: if (lowForSheet && !$openHereSheetUpStore) {
        lowForSheet = false;
        leaveBubbleHeight();
    }
    // Before the height below, so a chat opened by a bubble starts low without a pass at its old height.
    let wasVisible = false;
    $: onVisibilityChange($chatVisibilityStore);
    function onVisibilityChange(visible: boolean) {
        if (visible && !wasVisible) {
            // Reset on opening, not on closing: the sheet slides away at the height it was let go at.
            sheetDragHeight = undefined;
            if (getLastChatOpenSource() === "bubble") {
                bubbleHeight = getSnapHeights($windowSize.height, CHAT_SHEET_SIZES).peek;
                watchLatestMessage();
            } else if ($openHereSheetUpStore) {
                bubbleHeight = getSnapHeights($windowSize.height, CHAT_SHEET_SIZES).peek;
                lowForSheet = true;
            } else {
                bubbleHeight = undefined;
                // "Show everyone" lowers it to make room for the videos; opened again on purpose, it is readable.
                if ($chatSheetSnapStore === "peek") chatSheetSnapStore.set("half");
            }
        }
        if (!visible) {
            stopWatchingLatestMessage();
            lowForSheet = false;
        }
        wasVisible = visible;
    }

    $: sheetSnapHeights = getSnapHeights($windowSize.height, CHAT_SHEET_SIZES);
    // Searching: the list's footer holds the search field above the keyboard, so the sheet goes to full height for the
    // results. It is only borrowed: the snap, the bubble's height and the kept rest are untouched, so closing the search
    // puts the sheet back where it was. A drag still wins. A chat open in the panel has no list, so no search to give room.
    $: searchTakesRoom = $chatSearchOpenStore && $selectedRoomStore === undefined;
    // The Invite panel replaces the list's footer, over the dimmed list: the sheet is only as tall as it needs to show
    // the whole panel, borrowed the same way (it never lowers the sheet, and closing gives the height back).
    $: inviteSheetHeight = $selectedRoomStore === undefined ? $chatInviteSheetHeightStore : 0;
    $: sheetHeight =
        sheetDragHeight ??
        (searchTakesRoom
            ? sheetSnapHeights.full
            : chatSheetInviteHeight(
                  bubbleHeight ?? chatSheetRestingHeight($chatSheetSnapStore, $windowSize.height),
                  inviteSheetHeight,
                  $windowSize.height
              ));
    // The videos above the sheet follow its height, drag included.
    $: chatOwnSheetHeightStore.set(sheet && $chatVisibilityStore ? sheetHeight : 0);

    // Any other move of the sheet ("show everyone" lowering it) ends the bubble's own height.
    const unsubscribeRest = chatSheetSnapStore.subscribe(() => leaveBubbleHeight());
    onDestroy(() => {
        unsubscribeRest();
        stopWatchingLatestMessage();
    });

    function leaveBubbleHeight() {
        bubbleHeight = undefined;
        stopWatchingLatestMessage();
    }

    function watchLatestMessage() {
        stopWatchingLatestMessage();
        latestMessageObserver = new MutationObserver(scheduleFit);
        tick()
            .then(() => {
                if (!container || bubbleHeight === undefined) return;
                latestMessageObserver?.observe(container, { childList: true, subtree: true, characterData: true });
                scheduleFit();
            })
            .catch((e) => console.error(e));
    }

    function stopWatchingLatestMessage() {
        latestMessageObserver?.disconnect();
        latestMessageObserver = undefined;
        if (fitFrame !== undefined) cancelAnimationFrame(fitFrame);
        fitFrame = undefined;
    }

    function scheduleFit() {
        if (fitFrame !== undefined) return;
        fitFrame = requestAnimationFrame(() => {
            fitFrame = undefined;
            fitLatestMessage();
        });
    }

    function fitLatestMessage() {
        if (bubbleHeight === undefined || !container) return;
        const messages = container.querySelectorAll<HTMLElement>("li[data-event-id]");
        const latest = messages[messages.length - 1];
        const list = latest?.closest("ul")?.parentElement;
        if (!latest || !list) return;
        bubbleHeight = chatSheetFitHeight(
            bubbleHeight,
            list.clientHeight,
            latest.getBoundingClientRect().height,
            $windowSize.height
        );
    }

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
        // Searching holds the sheet at full height: it springs back, and nothing is kept for after the search.
        if (searchTakesRoom) {
            sheetDragHeight = undefined;
            return;
        }
        // It stays where it is let go (between its lowest height and "full"), and opens there next time.
        const kept = clampHeight(height, $windowSize.height, CHAT_SHEET_SIZES);
        sheetDragHeight = undefined;
        leaveBubbleHeight();
        keepChatSheetRest(kept / $windowSize.height);
    }

    function onSheetTap() {
        // Searching and the Invite panel borrow the sheet's height: the snap must not be worked out from it and kept.
        if (searchTakesRoom || inviteSheetHeight > 0) return;
        leaveBubbleHeight();
        keepChatSheetRest(nextSnap(nearestSnap(sheetHeight, $windowSize.height, CHAT_SHEET_SIZES)));
    }
</script>

<svelte:window on:resize={onresize} />
{#if $chatVisibilityStore && sheet}
    <!-- The sheet keeps the chat's id and test id: everything that looks for the chat finds it. -->
    <!-- A tap anywhere on the chat brings it in front of a window it overlaps. ph-mask and ph-sensitive keep what people
         and bots write out of PostHog: session replays show it as asterisks and clicks carry no text (#1166). -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <section
        bind:this={container}
        on:pointerdown|capture={() => windowInFrontStore.set("chat")}
        id="chat"
        data-testid="chat"
        transition:fly={{ duration: 200, y: sheetHeight }}
        on:introend={() => reposition()}
        on:outroend={() => reposition()}
        style={sheetFrameStyle(sheetHeight, $windowSize.height)}
        class="chatWindow chat-sheet u-surface-flat p-0 screen-blocker ph-mask ph-sensitive"
        class:dragging={sheetDragHeight !== undefined}
    >
        <SheetHandle
            {sheetHeight}
            onDrag={onSheetDrag}
            onRelease={onSheetRelease}
            onTap={onSheetTap}
            label={$LL.chat.sheetHandle()}
            testId="chatSheetHandle"
        />
        <div class="relative flex-1 min-h-0">
            {#if $chatCarriesItsCloseStore && isInSpecificDiscussion}
                <!-- Level with the close beside the Chats and People tabs (their row's top padding and the track's), so
                     it stays put going from the tabs into a chat and its profile. -->
                <div class="close-window absolute end-2 top-[13px] z-50">
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
    <!-- A click anywhere on the chat brings it in front of a window it overlaps. ph-mask and ph-sensitive: as above. -->
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
        on:introend={() => reposition()}
        on:outroend={() => reposition()}
        style="width: {sideBarWidth}px; max-width: {sideBarWidth}px;"
        class=" chatWindow !min-w-[150px] max-sm:!min-w-[150px] u-surface-flat p-0 screen-blocker ph-mask ph-sensitive"
    >
        {#if $chatCarriesItsCloseStore && isInSpecificDiscussion}
            <!-- The same plain close as the one beside the Chats and People tabs, in the same place. -->
            <!-- Below 1024px the side chat starts its content under the installed app's see-through status bar (chat.scss,
                 #969), so this close does too; the floating chat from 1024px is already held off the top. -->
            <div class="close-window absolute end-2 top-[calc(12px+env(safe-area-inset-top))] lg:top-3 z-50">
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
    @use "../style/bottom-sheet.scss" as *;

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
        @include bottom-sheet;
    }
    #resize-bar.resizing {
        width: 6px !important;
        background-color: #a78bfa !important;
    }
</style>
