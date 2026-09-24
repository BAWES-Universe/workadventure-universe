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
    import HereStrip from "./TopRow/HereStrip.svelte";
    import NearbyChatRow from "./TopRow/NearbyChatRow.svelte";
    import AreaChatRows from "./AreaRow/AreaChatRows.svelte";
    import OneList from "./OneList/OneList.svelte";
    import { resolveChatLayout } from "./ChatLayout";
    import { IconChevronRight, IconCloudLock, IconRefresh } from "@wa-icons";

    export let sideBarWidth: number = INITIAL_SIDEBAR_WIDTH;

    const proximityChatRoom = gameManager.getCurrentGameScene().proximityChatRoom;
    const proximityMessages = proximityChatRoom.messages;
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

    // The live card shows while you're in a bubble, a meeting or a zone; otherwise the nearby chat you had is a row.
    let liveCardVisible = false;
    $: hasNearbyHistory = $proximityMessages.some((message) => message.type === "proximity");

    $: visibleJoignableRooms = withoutAreaChatRooms($joignableRoom, $hiddenAreaRoomIds);

    // One rule for both the columns and the list: at 670px and wider, list and thread sit side by side.
    // Below that, an open thread takes the whole panel, and the list (with the Chat / People tabs) hides.
    $: layout = resolveChatLayout(sideBarWidth, CHAT_LAYOUT_LIMIT, $selectedRoomStore !== undefined);
    $: displayTwoColumnLayout = layout.twoColumns;

    const isMatrixChatEnabled = gameManager.getCurrentGameScene().room.isMatrixChatEnabled;
</script>

<div
    class="overflow-auto h-full grid grid-rows-[1fr_auto] {displayTwoColumnLayout && $navChat.key === 'chat'
        ? 'grid-cols-[auto_1fr]'
        : 'grid-cols-[1fr]'}"
>
    {#if layout.showList}
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

                {#if $loginTokenErrorStore && !(!$userIsConnected && isMatrixChatEnabled)}
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

                <div class="border border-solid border-x-0 border-t border-y-0 border-b-0 border-white/10">
                    <HereStrip />
                    <div class="flex flex-col px-2 pb-2 empty:hidden">
                        <ProximityTopRow
                            {proximityChatRoom}
                            onOpen={toggleDisplayProximityChat}
                            bind:visible={liveCardVisible}
                        />
                        <AreaChatRows />
                    </div>
                    {#if !liveCardVisible && !hasNearbyHistory}
                        <p class="m-0 px-4 pb-3 text-xs text-white/45" data-testid="nearbyHint">
                            {$LL.chat.here.hint()}
                        </p>
                    {/if}
                </div>
                {#if !liveCardVisible}
                    <div class="px-2 empty:hidden">
                        <NearbyChatRow {proximityChatRoom} onOpen={toggleDisplayProximityChat} />
                    </div>
                {/if}
                {#if !$userIsConnected && isMatrixChatEnabled}
                    <!-- Guests: saved conversations need an account. One quiet line instead of a blocking panel. -->
                    <div class="px-2 pb-2">
                        <a
                            class="group flex items-center gap-2 min-h-11 px-3 rounded-xl text-sm text-white/70 no-underline hover:no-underline hover:text-white hover:bg-white/5 focus-visible:bg-white/5"
                            href="/login"
                            data-testid="chatGuestSignIn"
                            on:click={() => analyticsClient.login()}
                        >
                            <span class="grow">{$LL.chat.thread.guestFooter()}</span>
                            <IconChevronRight
                                font-size="16"
                                class="shrink-0 opacity-60 group-hover:opacity-100 rtl:-scale-x-100"
                            />
                        </a>
                    </div>
                {/if}
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
