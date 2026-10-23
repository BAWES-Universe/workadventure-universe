<script lang="ts">
    import { navChat } from "../../Chat/Stores/ChatStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { activeSubMenuStore, menuVisiblilityStore } from "../../Stores/MenuStore";
    import { openChat } from "../../Chat/openChat";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
    import LL from "../../../i18n/i18n-svelte";
    import MessageCircleIcon from "../Icons/MessageCircleIcon.svelte";

    /**
     * The one button of the bar a person needs while reading a file or a page in the sheet (the bar is hidden then): the
     * chat, floating at the bottom right. It opens the chat the way the bar's chat button does.
     */
    const gameScene = gameManager.getCurrentGameScene();
    const chatEnabledInAdmin = gameScene.room.isChatEnabled;
    const proximityChatRoom = gameScene.proximityChatRoom;

    function openTheChat() {
        menuVisiblilityStore.set(false);
        activeSubMenuStore.activateByIndex(0);
        openChat("button");
        navChat.switchToChat();
        if (!chatEnabledInAdmin) {
            selectedRoomStore.set(proximityChatRoom);
            proximityChatRoom.hasUnreadMessages.set(false);
            proximityChatRoom.unreadNotificationCount.set(0);
        }
        analyticsClient.openedChat();
    }
</script>

<button
    type="button"
    class="chat-button u-surface"
    aria-label={$LL.actionbar.help.chat.title()}
    title={$LL.actionbar.help.chat.title()}
    data-testid="openHereChatButton"
    on:click={openTheChat}
>
    <MessageCircleIcon height="h-7" width="w-7" hover="" />
</button>

<style>
    /* 56 px, 16 px in from the corner, above the sheet. */
    .chat-button {
        position: fixed;
        inset-inline-end: max(16px, env(safe-area-inset-right, 0px));
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        z-index: 2002;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
</style>
