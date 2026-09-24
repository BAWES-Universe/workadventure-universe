<script lang="ts">
    import { gameManager } from "../../Phaser/Game/GameManager";
    import LL from "../../../i18n/i18n-svelte";
    import { chatSearchBarValue, joignableRoom, navChat } from "../Stores/ChatStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { INITIAL_SIDEBAR_WIDTH, loginTokenErrorStore } from "../../Stores/ChatStore";
    import { userIsConnected } from "../../Stores/MenuStore";
    import getCloseImg from "../images/get-close.png";
    import ExternalComponents from "../../Components/ExternalModules/ExternalComponents.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { areaChatRooms, withoutAreaChatRooms } from "../Stores/AreaPresenceStore";
    import RoomTimeline from "./Room/RoomTimeline.svelte";
    import JoignableRooms from "./Room/JoignableRooms.svelte";
    import ChatLoader from "./ChatLoader.svelte";
    import ChatError from "./ChatError.svelte";
    import ChatHeader from "./ChatHeader.svelte";
    import RequireConnection from "./requireConnection.svelte";
    import RefreshChat from "./RefreshChat.svelte";
    import ProximityTopRow from "./TopRow/ProximityTopRow.svelte";
    import AreaChatRows from "./AreaRow/AreaChatRows.svelte";
    import OneList from "./OneList/OneList.svelte";
    import { IconCloudLock, IconRefresh } from "@wa-icons";

    export let sideBarWidth: number = INITIAL_SIDEBAR_WIDTH;

    const proximityChatRoom = gameManager.getCurrentGameScene().proximityChatRoom;
    const chat = gameManager.chatConnection;
    const shouldRetrySendingEvents = chat.shouldRetrySendingEvents;

    const chatConnectionStatus = chat.connectionStatus;
    const CHAT_LAYOUT_LIMIT = INITIAL_SIDEBAR_WIDTH * 2;

    // Area chat rooms have their own row under the top row and never show in the list, even while joining or leaving.
    const hiddenAreaRoomIds = areaChatRooms.hiddenRoomIds;

    async function initChatConnectionEncryption() {
        try {
            await chat.initEndToEndEncryption();
        } catch (error) {
            console.error("Failed to initChatConnectionEncryption", error);
        }
        analyticsClient.startMatrixEncryptionConfiguration();
    }

    const isEncryptionRequiredAndNotSet = chat.isEncryptionRequiredAndNotSet;
    const isGuest = chat.isGuest;

    function toggleDisplayProximityChat() {
        selectedRoomStore.set(proximityChatRoom);
        proximityChatRoom.hasUnreadMessages.set(false);
        proximityChatRoom.unreadNotificationCount.set(0);
    }

    $: visibleJoignableRooms = withoutAreaChatRooms($joignableRoom, $hiddenAreaRoomIds);

    $: displayTwoColumnLayout = sideBarWidth >= CHAT_LAYOUT_LIMIT;
</script>

<div
    class="overflow-auto h-full grid grid-rows-[1fr_auto] {sideBarWidth > INITIAL_SIDEBAR_WIDTH * 2 &&
    $navChat.key === 'chat'
        ? 'grid-cols-[auto_1fr]'
        : 'grid-cols-[1fr]'}"
>
    {#if $selectedRoomStore === undefined || displayTwoColumnLayout}
        <div
            class="w-full flex flex-col border border-solid border-y-0 border-l-0 border-white/10 relative overflow-y-auto overflow-x-none"
            style={displayTwoColumnLayout ? `width:335px ;flex : 0 0 auto` : ``}
        >
            {#if $shouldRetrySendingEvents}
                <RefreshChat />
            {/if}
            <ChatHeader />
            <div
                class="relative pt-2 {$isEncryptionRequiredAndNotSet === true && $isGuest === false
                    ? ' h-[calc(100%-2rem)]'
                    : 'h-full'}"
            >
                {#if $chatConnectionStatus === "CONNECTING" && $userIsConnected}
                    <ChatLoader label={$LL.chat.connecting()} />
                {/if}
                {#if $chatConnectionStatus === "ON_ERROR" && $userIsConnected}
                    <ChatError />
                {/if}

                {#if !$userIsConnected && gameManager.getCurrentGameScene().room.isMatrixChatEnabled}
                    <RequireConnection />
                {:else if $loginTokenErrorStore}
                    <RequireConnection>
                        <span slot="emoji">
                            <IconRefresh font-size="50" />
                        </span>
                        <span slot="title">
                            {$LL.chat.loginTokenError()}
                        </span>
                        <span slot="button-label">
                            {$LL.chat.reconnect()}
                        </span>
                    </RequireConnection>
                {/if}

                <div class="px-2 py-2 border border-solid border-x-0 border-t border-y-0 border-b-0 border-white/10">
                    <ProximityTopRow {proximityChatRoom} onOpen={toggleDisplayProximityChat} />
                    <AreaChatRows />
                </div>
                {#if $chatConnectionStatus === "ONLINE"}
                    {#if visibleJoignableRooms.length > 0 && $chatSearchBarValue.trim() !== ""}
                        <p class="p-0 m-0 text-gray-400">{$LL.chat.availableRooms()}</p>
                        <div class="flex flex-col">
                            {#each visibleJoignableRooms as room (room.id)}
                                <JoignableRooms {room} />
                            {/each}
                        </div>
                    {/if}
                    <!-- One list: DMs, rooms, invitations and folders together, newest first. -->
                    <div class="px-2 pb-2">
                        <OneList />
                    </div>
                {/if}
            </div>
        </div>
    {/if}
    {#if $selectedRoomStore !== undefined}
        <div class="overflow-y-auto">
            <RoomTimeline room={$selectedRoomStore} />
        </div>
    {:else if $selectedRoomStore === undefined && sideBarWidth >= CHAT_LAYOUT_LIMIT}
        <div class="flex flex-col flex-1 ps-4 items-center pt-8">
            <div class="text-center px-3 max-w-md">
                <img src={getCloseImg} alt="Discussion bubble" draggable="false" />
                <div class="text-lg font-bold text-center">{$LL.chat.noRoomOpen()}</div>
                <div class="text-sm opacity-50 text-center">
                    {$LL.chat.noRoomOpenDescription()}
                </div>
            </div>
        </div>
    {/if}

    <div class="w-full flex flex-col col-span-2 h-fit">
        <ExternalComponents zone="chatBand" />
        {#if $isEncryptionRequiredAndNotSet === true && $isGuest === false}
            <div class="w-full">
                <button
                    data-testid="restoreEncryptionButton"
                    on:click|stopPropagation={initChatConnectionEncryption}
                    class="text-white flex gap-2 justify-center w-full bg-neutral hover:bg-neutral-600 hover:brightness-100 m-0 rounded-none py-2 px-3 appearance-none"
                >
                    <IconCloudLock font-size="20" />
                    <div class="text-sm font-bold grow text-start">
                        {$LL.chat.e2ee.encryptionNotConfigured()}
                    </div>
                    <div class="text-xs rounded border border-solid border-white py-0.5 px-1.5 group-hover:bg-white/10">
                        {$LL.chat.e2ee.configure()}
                    </div>
                </button>
            </div>
        {/if}
    </div>
</div>
