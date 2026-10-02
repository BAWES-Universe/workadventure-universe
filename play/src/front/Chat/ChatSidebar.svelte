<script lang="ts">
    import { fly } from "svelte/transition";
    import { chatVisibilityStore, INITIAL_SIDEBAR_WIDTH, INITIAL_SIDEBAR_WIDTH_MOBILE } from "../Stores/ChatStore";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { isMediaBreakpointUp } from "../Utils/BreakpointsUtils";
    import { LL } from "../../i18n/i18n-svelte";
    import { selectedRoomStore } from "./Stores/SelectRoomStore";
    import Chat from "./Components/Chat.svelte";
    import {
        chatFloatInsetStore,
        chatSidebarWidthStore,
        chatCarriesItsCloseStore,
    } from "./ChatSidebarWidthStore";
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

    const handleMousedown = (e: MouseEvent) => {
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
            document.onmousemove = null;
            chatSidebarWidthStore.set(sideBarWidth);
            reposition();
        };
    };
    const handleTouchStart = (e: TouchEvent) => {
        let dragX = e.targetTouches[0].pageX;

        function onTouchMove(e: TouchEvent) {
            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const diff = e.targetTouches[0].pageX - dragX;
            const newWidth = Math.min(isRTL ? sideBarWidth - diff : sideBarWidth + diff, vw);
            const minWidth = 200;
            const maxWidth = vw - 50;
            const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            sideBarWidth = clampedWidth;

            dragX = e.targetTouches[0].pageX;
        }

        function onTouchEnd() {
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            chatSidebarWidthStore.set(sideBarWidth);
            reposition();
        }

        document.addEventListener("touchmove", onTouchMove);
        document.addEventListener("touchend", onTouchEnd);
    };

    const handleDbClick = () => {
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
    <section
        bind:this={container}
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
</style>
