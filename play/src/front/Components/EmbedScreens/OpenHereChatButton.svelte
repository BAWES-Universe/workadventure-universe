<script lang="ts">
    import { navChat } from "../../Chat/Stores/ChatStore";
    import { openChat } from "../../Chat/openChat";
    import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { activeSubMenuStore, menuVisiblilityStore } from "../../Stores/MenuStore";
    import { modalVisibilityStore } from "../../Stores/ModalStore";
    import { cardOverWindowStore } from "../../Stores/CardOverWindowStore";
    import { openHereSheetUpStore } from "../../Stores/OpenHereSheetStore";
    import { sideWindowInFrontStore } from "../../Stores/SideWindowInFrontStore";
    import LL from "../../../i18n/i18n-svelte";
    import MessageCircleIcon from "../Icons/MessageCircleIcon.svelte";

    // On a phone the window's sheet hides the bar, and with it the chat button: this one floats in its place, so the
    // chat is one tap away. It opens the chat as the bar's button does, in front of the sheet.
    $: behindOrbit = ($modalVisibilityStore && $sideWindowInFrontStore === "orbit") || $cardOverWindowStore;

    function openChatOverSheet() {
        const scene = gameManager.getCurrentGameScene();
        menuVisiblilityStore.set(false);
        activeSubMenuStore.activateByIndex(0);
        openChat("button");
        navChat.switchToChat();
        if (!scene.room.isChatEnabled) {
            selectedRoomStore.set(scene.proximityChatRoom);
            scene.proximityChatRoom.hasUnreadMessages.set(false);
            scene.proximityChatRoom.unreadNotificationCount.set(0);
        }
        analyticsClient.openedChat();
    }
</script>

{#if $openHereSheetUpStore && !$chatVisibilityStore && !behindOrbit}
    <button
        type="button"
        class="open-here-chat u-surface-flat"
        aria-label={$LL.actionbar.help.chat.title()}
        title={$LL.actionbar.help.chat.title()}
        data-testid="openHereChatButton"
        on:click={openChatOverSheet}
    >
        <MessageCircleIcon hover="" />
    </button>
{/if}

<style>
    /* A round ink button bottom right, over the sheet, with a 56px square to tap. */
    .open-here-chat {
        position: fixed;
        z-index: 2002;
        inset-inline-end: 8px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        display: flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 9999px;
        pointer-events: auto;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }

    .open-here-chat:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px #fff;
    }
</style>
