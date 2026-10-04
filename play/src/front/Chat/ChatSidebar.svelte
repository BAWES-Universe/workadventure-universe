<script lang="ts">
    import { fly } from "svelte/transition";
    import { chatVisibilityStore, INITIAL_SIDEBAR_WIDTH, INITIAL_SIDEBAR_WIDTH_MOBILE } from "../Stores/ChatStore";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { isMediaBreakpointUp } from "../Utils/BreakpointsUtils";
    import { LL } from "../../i18n/i18n-svelte";
    import { windowInFrontStore } from "../Stores/WindowInFrontStore";
    import { selectedRoomStore } from "./Stores/SelectRoomStore";
    import Chat from "./Components/Chat.svelte";
    import { chatFloatInsetStore, chatSidebarWidthStore, chatCarriesItsCloseStore } from "./ChatSidebarWidthStore";
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
</script>

<svelte:window on:resize={onresize} />
{#if $chatVisibilityStore}
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
    #resize-bar.resizing {
        width: 6px !important;
        background-color: #a78bfa !important;
    }
</style>
