<script lang="ts">
    import { derived } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import LL from "../../../i18n/i18n-svelte";
    import { findGroupOpenStore, navChat } from "../Stores/ChatStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import { INITIAL_SIDEBAR_WIDTH, loginTokenErrorStore } from "../../Stores/ChatStore";
    import { userIsConnected } from "../../Stores/MenuStore";
    import getCloseImg from "../images/get-close.png";
    import ExternalComponents from "../../Components/ExternalModules/ExternalComponents.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import type { ChatMessage } from "../Connection/ChatConnection";
    import type { ProximitySession } from "../Connection/Proximity/ProximitySessions";
    import { ROOM_MESSAGES_SESSION_ID, listableSessions } from "../Connection/Proximity/ProximitySessions";
    import RoomTimeline from "./Room/RoomTimeline.svelte";
    import ChatLoader from "./ChatLoader.svelte";
    import ChatError from "./ChatError.svelte";
    import ChatHeader from "./ChatHeader.svelte";
    import FindGroup from "./FindGroup.svelte";
    import RequireConnection from "./requireConnection.svelte";
    import RefreshChat from "./RefreshChat.svelte";
    import ProximityTopRow from "./TopRow/ProximityTopRow.svelte";
    import AreaChatRows from "./AreaRow/AreaChatRows.svelte";
    import OneList from "./OneList/OneList.svelte";
    import type { OneListEntry } from "./OneList/OneListStore";
    import { resolveChatLayout } from "./ChatLayout";
    import {
        IconChevronRight,
        IconCloudLock,
        IconMessage,
        IconRefresh,
        IconTools,
        IconUserCircle,
        IconWorldSearch,
    } from "@wa-icons";

    export let sideBarWidth: number = INITIAL_SIDEBAR_WIDTH;

    const gameScene = gameManager.getCurrentGameScene();
    const proximityChatRoom = gameScene.proximityChatRoom;
    const proximitySessions = proximityChatRoom.sessions;
    const proximityUnread = proximityChatRoom.unreadBySession;
    const chat = gameManager.chatConnection;
    const shouldRetrySendingEvents = chat.shouldRetrySendingEvents;
    const hasPeopleTab = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;

    const chatConnectionStatus = chat.connectionStatus;
    const CHAT_LAYOUT_LIMIT = INITIAL_SIDEBAR_WIDTH * 2;

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

    function openLiveProximityChat() {
        proximityChatRoom.open();
    }

    function openSession(session: ProximitySession<ChatMessage>) {
        proximityChatRoom.open(session.id);
    }

    // The proximity chats you had, one row each, sorted in with the saved conversations by their last message.
    // Only stays where someone wrote something get a row; the room messages get one when no stay is live.
    const proximityEntries: Readable<OneListEntry[]> = derived(
        [proximitySessions, proximityUnread, LL],
        ([$sessions, $unread, $LL]) =>
            listableSessions($sessions).map((session): OneListEntry => {
                const unreadCount = $unread.get(session.id) ?? 0;
                const title =
                    session.id === ROOM_MESSAGES_SESSION_ID
                        ? $LL.chat.session.roomMessages()
                        : session.isArea
                        ? session.label
                        : $LL.chat.proximity();
                return {
                    id: `proximity:${session.id}`,
                    kind: "proximity",
                    name: title,
                    timestamp: session.lastMessage?.date?.getTime() ?? session.endedAt ?? session.startedAt ?? 0,
                    unreadCount,
                    hasUnread: unreadCount > 0,
                    item: session,
                    searchNames: session.participants,
                };
            })
    );

    // The live card shows while you're in a bubble, a meeting or a zone.
    let liveCardVisible = false;
    $: hasProximityHistory = $proximityEntries.length > 0;

    // One rule for both the columns and the list: at 670px and wider, list and thread sit side by side.
    // Below that, an open thread takes the whole panel, and the list (with the Chats / People tabs) hides.
    $: layout = resolveChatLayout(sideBarWidth, CHAT_LAYOUT_LIMIT, $selectedRoomStore !== undefined);
    $: displayTwoColumnLayout = layout.twoColumns;

    const isMatrixChatEnabled = gameScene.room.isMatrixChatEnabled;
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
            {#if $findGroupOpenStore && $chatConnectionStatus === "ONLINE"}
                <FindGroup />
            {:else}
                {#if $shouldRetrySendingEvents}
                    <RefreshChat />
                {/if}
                <ChatHeader />
                <div
                    class="relative pt-1 {$isEncryptionRequiredAndNotSet === true && $isGuest === false
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

                    <!-- What you're in the middle of: the live proximity chat, then the area chats you stand in. -->
                    <div class="flex flex-col px-2 pb-1 empty:hidden">
                        <ProximityTopRow
                            {proximityChatRoom}
                            onOpen={openLiveProximityChat}
                            bind:visible={liveCardVisible}
                        />
                        <AreaChatRows />
                    </div>
                    {#if !liveCardVisible && !hasProximityHistory}
                        <div
                            class="mx-2 mb-2 flex items-center gap-3 rounded-xl border border-dashed border-white/15 px-3 py-2.5 text-xs text-white/60"
                            data-testid="nearbyHint"
                        >
                            <span class="grow">{$LL.chat.here.hint()}</span>
                            {#if hasPeopleTab}
                                <button
                                    type="button"
                                    class="m-0 shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/20"
                                    data-testid="nearbyHintPeople"
                                    on:click={() => navChat.switchToUserList()}
                                >
                                    {$LL.chat.here.seeWhoIsHere()}
                                </button>
                            {/if}
                        </div>
                    {/if}
                    {#if !$userIsConnected && isMatrixChatEnabled}
                        <!-- Guests: say what they have, what an account adds, and how to get one. Never blocks the list. -->
                        <section
                            class="mx-2 mb-2 rounded-xl bg-white/5 p-3 text-sm text-white/80"
                            aria-labelledby="chatGuestTitle"
                            data-testid="chatGuestCard"
                        >
                            <h3 id="chatGuestTitle" class="m-0 text-sm font-bold text-white">
                                {$LL.chat.guest.title()}
                            </h3>
                            <p class="m-0 mt-1 text-xs text-white/60">{$LL.chat.guest.intro()}</p>
                            <ul class="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-xs">
                                <li class="flex items-start gap-2">
                                    <IconMessage
                                        font-size="16"
                                        class="mt-px shrink-0 text-white/60"
                                        aria-hidden="true"
                                    />
                                    <span>{$LL.chat.guest.messageAnyone()}</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <IconUserCircle
                                        font-size="16"
                                        class="mt-px shrink-0 text-white/60"
                                        aria-hidden="true"
                                    />
                                    <span>{$LL.chat.guest.keepWoka()}</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <IconWorldSearch
                                        font-size="16"
                                        class="mt-px shrink-0 text-white/60"
                                        aria-hidden="true"
                                    />
                                    <span>{$LL.chat.guest.orbit()}</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <IconTools font-size="16" class="mt-px shrink-0 text-white/60" aria-hidden="true" />
                                    <span>{$LL.chat.guest.build()}</span>
                                </li>
                            </ul>
                            <a
                                class="group mt-3 flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 text-sm font-bold text-white no-underline hover:no-underline hover:bg-secondary-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                                href="/login"
                                data-testid="chatGuestSignIn"
                                on:click={() => analyticsClient.login()}
                            >
                                <span>{$LL.chat.guest.action()}</span>
                                <IconChevronRight font-size="16" class="shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                            </a>
                        </section>
                    {/if}
                    {#if $chatConnectionStatus === "ONLINE" || hasProximityHistory}
                        <!-- One list: proximity chats you had, DMs, groups, invitations and folders, newest first. -->
                        <div class="px-2 pb-2">
                            <OneList
                                extraEntries={proximityEntries}
                                showEmpty={$chatConnectionStatus === "ONLINE"}
                                onOpenSession={openSession}
                            />
                        </div>
                    {/if}
                </div>
            {/if}
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
