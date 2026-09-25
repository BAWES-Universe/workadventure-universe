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
    import WokaFromUserId from "../../Components/Woka/WokaFromUserId.svelte";
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
                        <!-- Nothing yet: say how it starts, and offer the People tab. -->
                        <section class="u-glass-warm mx-2 mb-2 rounded-2xl px-4 pt-4 pb-3" data-testid="nearbyHint">
                            <div class="flex items-start gap-3">
                                <div
                                    class="u-glow flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary"
                                    aria-hidden="true"
                                >
                                    <div class="translate-y-[3px]">
                                        <WokaFromUserId userId={-1} customWidth="34px" placeholderSrc="" />
                                    </div>
                                </div>
                                <div class="flex min-w-0 flex-col gap-0.5">
                                    <h3 class="u-text-gradient m-0 text-base font-bold leading-6">
                                        {$LL.chat.here.title()}
                                    </h3>
                                    <p class="m-0 text-sm leading-5 text-white/75">{$LL.chat.here.hint()}</p>
                                </div>
                            </div>
                            {#if hasPeopleTab}
                                <button
                                    type="button"
                                    class="u-cta mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold"
                                    data-testid="nearbyHintPeople"
                                    on:click={() => navChat.switchToUserList()}
                                >
                                    {$LL.chat.here.seeWhoIsHere()}
                                    <IconChevronRight font-size="16" class="rtl:-scale-x-100" aria-hidden="true" />
                                </button>
                            {/if}
                        </section>
                    {/if}
                    {#if !$userIsConnected && isMatrixChatEnabled}
                        <!-- Guests: what already works, what an account adds, and how to get one. Never blocks the list. -->
                        <section
                            class="u-glass mx-2 mb-2 rounded-2xl px-4 pt-4 pb-4 text-sm text-white/80"
                            aria-labelledby="chatGuestTitle"
                            data-testid="chatGuestCard"
                        >
                            <span class="u-eyebrow">{$LL.chat.guest.eyebrow()}</span>
                            <h3 id="chatGuestTitle" class="u-text-gradient m-0 mt-1.5 text-lg font-bold leading-6">
                                {$LL.chat.guest.title()}
                            </h3>
                            <p class="m-0 mt-1 text-xs leading-5 text-white/60">{$LL.chat.guest.intro()}</p>
                            <ul class="m-0 mt-3 flex list-none flex-col gap-2.5 p-0 text-[13px] leading-5">
                                <li class="flex items-start gap-3">
                                    <span class="guest-tile" aria-hidden="true"><IconMessage font-size="16" /></span>
                                    <span>{$LL.chat.guest.messageAnyone()}</span>
                                </li>
                                <li class="flex items-start gap-3">
                                    <span class="guest-tile" aria-hidden="true"><IconUserCircle font-size="16" /></span>
                                    <span>{$LL.chat.guest.keepWoka()}</span>
                                </li>
                                <li class="flex items-start gap-3">
                                    <span class="guest-tile" aria-hidden="true"><IconWorldSearch font-size="16" /></span
                                    >
                                    <span>{$LL.chat.guest.orbit()}</span>
                                </li>
                                <li class="flex items-start gap-3">
                                    <span class="guest-tile" aria-hidden="true"><IconTools font-size="16" /></span>
                                    <span>{$LL.chat.guest.build()}</span>
                                </li>
                            </ul>
                            <a
                                class="u-cta mt-4 flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold no-underline hover:no-underline"
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

<style>
    /* The small icon tiles of the guest card: a purple → blue gradient, like the "+" menu's. */
    .guest-tile {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        flex-shrink: 0;
        border-radius: 0.5rem;
        color: #fff;
        background: linear-gradient(135deg, rgba(134, 41, 252, 0.9), rgba(65, 86, 246, 0.9));
        box-shadow: 0 4px 10px -4px rgba(134, 41, 252, 0.7);
    }
</style>
