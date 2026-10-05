<script lang="ts">
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { findGroupOpenStore, navChat } from "../Stores/ChatStore";
    import { INITIAL_SIDEBAR_WIDTH } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import RoomUserList from "./UserList/RoomUserList.svelte";
    import RoomList from "./RoomList.svelte";
    import ChatTabs from "./ChatTabs.svelte";
    import { CHAT_LAYOUT_LIMIT, resolveChatLayout } from "./ChatLayout";
    export let sideBarWidth: number = INITIAL_SIDEBAR_WIDTH;

    const gameScene = gameManager.getCurrentGameScene();
    const userProviderMergerPromise = gameScene.userProviderMerger;
    const chatConnectionStatus = gameManager.chatConnection.connectionStatus;

    // The tabs sit over the list. They go when the list does: a thread open in a narrow panel, or Find a group.
    $: layout = resolveChatLayout(sideBarWidth, CHAT_LAYOUT_LIMIT, $selectedRoomStore !== undefined);
    $: showTabs =
        $navChat.key === "users" ||
        ($navChat.key === "chat" && layout.showList && !($findGroupOpenStore && $chatConnectionStatus === "ONLINE"));
    // Side by side with a thread, the list is a 335px column and the tabs stay over that column only: the thread
    // beside them starts at the top of the panel, as it did when the tabs were part of the list.
    $: tabsBesideThread = showTabs && $navChat.key === "chat" && layout.twoColumns;
    let tabsHeight = 0;
</script>

<div class="flex flex-col h-full">
    <div id="chatModal" class="absolute to-50%" />
    <div class="relative flex flex-col gap-2 !flex-1 min-h-0">
        {#if showTabs}
            <div
                class="shrink-0 {tabsBesideThread
                    ? 'absolute top-0 start-0 w-[335px] pb-2 border border-solid border-y-0 border-l-0 border-white/10'
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
                <RoomList {sideBarWidth} listTopInset={tabsBesideThread ? tabsHeight : 0} />
            {/if}
        </div>
    </div>
</div>
