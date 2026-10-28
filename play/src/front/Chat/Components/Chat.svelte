<script lang="ts">
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { findGroupOpenStore, navChat } from "../Stores/ChatStore";
    import { INITIAL_SIDEBAR_WIDTH } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { chatBackPeekStore, chatDepthStore, closeChatLevel } from "../ChatBack";
    import { installChatHistory } from "../ChatHistory";
    import { isIOS } from "../../WebRtc/DeviceUtils";
    import { orbitHoldsHistoryStore } from "../../Stores/OrbitHistoryStore";
    import RoomUserList from "./UserList/RoomUserList.svelte";
    import RoomList from "./RoomList.svelte";
    import ChatTabs from "./ChatTabs.svelte";
    import { CHAT_LAYOUT_LIMIT, resolveChatLayout } from "./ChatLayout";
    import { chatBackSwipe } from "./chatBackSwipe";
    export let sideBarWidth: number = INITIAL_SIDEBAR_WIDTH;

    installChatHistory(isIOS(), chatDepthStore, closeChatLevel, orbitHoldsHistoryStore);

    const gameScene = gameManager.getCurrentGameScene();
    const userProviderMergerPromise = gameScene.userProviderMerger;
    const chatConnectionStatus = gameManager.chatConnection.connectionStatus;

    // A swipe back from a conversation in a narrow panel draws all chats, tabs included, under it (#1553).
    $: peekList = $chatBackPeekStore === "list" && sideBarWidth < CHAT_LAYOUT_LIMIT && $selectedRoomStore !== undefined;
    // The tabs sit over the list. They go when the list does: a thread open in a narrow panel, or Find a group.
    $: layout = resolveChatLayout(sideBarWidth, CHAT_LAYOUT_LIMIT, $selectedRoomStore !== undefined && !peekList);
    $: showTabs =
        $navChat.key === "users" ||
        ($navChat.key === "chat" && layout.showList && !($findGroupOpenStore && $chatConnectionStatus === "ONLINE"));
    // Side by side with a thread, the list is a 335px column and the tabs stay over that column only: the thread
    // beside them starts at the top of the panel, as it did when the tabs were part of the list.
    $: tabsBesideThread = showTabs && $navChat.key === "chat" && layout.twoColumns;
    let tabsHeight = 0;
    // The list's gap under the tabs (gap-2), kept while the tabs are lifted out of the flow during a swipe.
    const TABS_GAP_PX = 8;
    $: listTopInset = tabsBesideThread ? tabsHeight : peekList && showTabs ? tabsHeight + TABS_GAP_PX : 0;
</script>

<div class="flex flex-col h-full">
    <div id="chatModal" class="absolute to-50%" />
    <div class="relative flex flex-col gap-2 !flex-1 min-h-0" use:chatBackSwipe={{ listBeside: layout.twoColumns }}>
        {#if showTabs}
            <div
                class="shrink-0 {tabsBesideThread
                    ? 'absolute top-0 start-0 w-[335px] pb-2 border border-solid border-y-0 border-l-0 border-white/10'
                    : peekList
                    ? 'absolute top-0 inset-x-0'
                    : ''}"
                bind:offsetHeight={tabsHeight}
            >
                <ChatTabs {sideBarWidth} />
            </div>
        {/if}
        <div class="flex flex-col !flex-1 min-h-0">
            {#if $navChat.key === "users"}
                {#await userProviderMergerPromise}
                    <div />
                {:then userProviderMerger}
                    <RoomUserList {userProviderMerger} />
                {/await}
            {:else if $navChat.key === "externalModule"}
                <svelte:component this={$navChat.component} {...$$restProps} {...$navChat.props} />
            {:else}
                <RoomList {sideBarWidth} {listTopInset} />
            {/if}
        </div>
    </div>
</div>

<style>
    /* The level sliding away in a swipe back covers what it uncovers, with an edge on the side it leaves (#1553). */
    :global(.chat-back-moving) {
        background: linear-gradient(160deg, rgb(31 28 47), rgb(var(--u-ink)));
        box-shadow: -14px 0 28px -14px rgb(0 0 0 / 0.75);
        will-change: transform;
    }
    :global([dir="rtl"] .chat-back-moving) {
        box-shadow: 14px 0 28px -14px rgb(0 0 0 / 0.75);
    }
</style>
