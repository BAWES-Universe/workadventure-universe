<script lang="ts">
    import { AvailabilityStatus } from "@workadventure/messages";
    import * as Sentry from "@sentry/svelte";
    import highlightWords from "highlight-words";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { availabilityStatusStore } from "../../../Stores/MediaStore";
    import { getColorHexOfStatus } from "../../../Utils/AvailabilityStatus";
    import type { ChatUser } from "../../Connection/ChatConnection";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { chatSearchBarValue } from "../../Stores/ChatStore";
    import { defaultColor, defaultWoka } from "../../Connection/Matrix/MatrixChatConnection";
    import { openDirectChatRoom } from "../../Utils";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import UserActionButton from "./UserActionButton.svelte";
    import ImageWithFallback from "./ImageWithFallback.svelte";
    import PersonActionButton from "./PersonActionButton.svelte";
    import { getPersonActions, isSelf } from "./PersonActions";
    import { goToPersonRoom, locatePerson, showMyself, walkToPerson } from "./PersonNavigation";
    import { IconDoorIn, IconLoader, IconMessage, IconWalk } from "@wa-icons";

    export let user: ChatUser;

    export let isMatrixChatEnabled = true;

    let showRoomCreationInProgress = false;

    $: ({ chatId, availabilityStatus, username = "", color, isAdmin, pictureStore } = user);

    // No scene while a reconnect swaps it: the row still shows, without the actions that need the map.
    const currentGameScene = gameManager.tryGetCurrentGameScene();
    const connection = currentGameScene?.connection;
    const iAmAdmin = connection?.hasTag("admin") ?? false;

    // "Yourself" is this tab's own avatar: other tabs of the same account are other people here.
    $: isMe = isSelf(user, {
        spaceUserId: connection?.getSpaceUserId(),
        chatId: localUserStore.getChatId() ?? undefined,
        uuid: localUserStore.getLocalUser()?.uuid,
    });

    $: userStatus = isMe ? availabilityStatusStore : availabilityStatus;

    $: chunks = highlightWords({
        text: displayName,
        query: $chatSearchBarValue,
    });

    const roomCreationInProgress = gameManager.chatConnection.roomCreationInProgress;

    $: actions = getPersonActions({
        isSelf: isMe,
        status: $userStatus,
        uuid: user.uuid,
        chatId: user.chatId,
        playUri: user.playUri,
        currentRoomUrl: currentGameScene?.roomUrl,
        visitCardUrl: user.visitCardUrl,
        isMatrixChatEnabled,
        roomCreationInProgress: showRoomCreationInProgress,
        iAmAdmin,
    });

    $: displayName = username.match(/\[\d*]/) ? username.substring(0, username.search(/\[\d*]/)) : username;

    function walkTo() {
        if (!user.uuid || !user.playUri) return;
        analyticsClient.goToUser();
        walkToPerson(user);
    }

    function goToRoom() {
        if (!user.playUri) return;
        analyticsClient.goToUser();
        goToPersonRoom(user);
    }

    function sendMessage() {
        openDirectChatRoom(chatId).catch((error) => {
            console.error("Error opening direct chat room:", error);
            Sentry.captureException(error, {
                extra: {
                    userId: user.uuid,
                    chatId: chatId,
                    playUri: user.playUri,
                    username: user.username,
                },
            });
        });
        analyticsClient.sendMessageFromUserList();
    }

    function getNameOfAvailabilityStatus(status: AvailabilityStatus) {
        switch (status) {
            case AvailabilityStatus.ONLINE:
                return $LL.chat.status.online();
            case AvailabilityStatus.AWAY:
                return $LL.chat.status.away();
            case AvailabilityStatus.BUSY:
                return $LL.chat.status.busy();
            case AvailabilityStatus.DO_NOT_DISTURB:
                return $LL.chat.status.do_not_disturb();
            case AvailabilityStatus.BACK_IN_A_MOMENT:
                return $LL.chat.status.back_in_a_moment();
            case AvailabilityStatus.JITSI:
            case AvailabilityStatus.BBB:
            case AvailabilityStatus.LIVEKIT:
                return $LL.chat.status.meeting();
            case AvailabilityStatus.SPEAKER:
                return $LL.chat.status.megaphone();
            case AvailabilityStatus.SILENT:
            default:
                return $LL.chat.status.unavailable();
        }
    }

    let loadingDirectRoomAccess = false;

    function openWokaMenu() {
        if (isMe) {
            showMyself();
            return;
        }
        if (user.uuid == undefined) return;
        // Track the open woka menu action
        analyticsClient.openWokaMenu();
        // Opens the menu on this exact avatar when it is in view (by space user id, so clones are told apart),
        // otherwise asks the server for the position.
        locatePerson(user, displayName);
    }
</script>

{#if loadingDirectRoomAccess}
    <div class="min-h-[60px] text-md flex gap-2 justify-center flex-row items-center p-1">
        <IconLoader class="animate-spin" />
    </div>
{:else}
    <div class="flex flex-col px-2 pb-2 user">
        <div
            class="wa-chat-item {isAdmin
                ? 'admin'
                : 'user'} group/chatItem relative mb-[1px] text-md flex gap-2 flex-row items-center hover:bg-white transition-all hover:bg-opacity-10 hover:rounded hover:!cursor-pointer px-2 py-2 cursor-pointer"
        >
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class="relative wa-avatar {!$userStatus ? 'opacity-50' : ''} cursor-pointer w-7 h-7 rounded-md"
                style={`background-color: ${color ?? defaultColor}`}
                on:click|stopPropagation={openWokaMenu}
            >
                <div class="w-7 h-7 rounded-md overflow-hidden">
                    <div
                        class="translate-y-[3px] -translate-x-[3px] group-hover/chatItem:translate-y-[0] transition-all"
                    >
                        <ImageWithFallback classes="w-8 h-8" src={$pictureStore} alt="Avatar" fallback={defaultWoka} />
                    </div>
                </div>
            </div>
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div
                class={`flex-auto min-w-0 ms-1 ${!$userStatus && "opacity-50"} cursor-pointer`}
                on:click|stopPropagation={openWokaMenu}
            >
                <div class="flex items-center h-4 min-w-0">
                    <div class="text-sm font-bold mb-0 flex items-center text-nowrap min-w-0">
                        <span class="truncate" title={displayName}>
                            {#each chunks as chunk (chunk.key)}
                                <span class={`${chunk.match ? "text-light-blue" : ""}`}>{chunk.text}</span>
                            {/each}
                        </span>
                        {#if username && username.match(/\[\d*]/)}
                            <div class="font-light text-xs text-gray">
                                #{username
                                    .match(/\[\d*]/)
                                    ?.join()
                                    ?.replace("[", "")
                                    ?.replace("]", "")}
                            </div>
                        {/if}
                        {#if isAdmin}
                            <div
                                class="text-xxs bg-secondary rounded-sm px-1 py-0.5 ms-1"
                                title={$LL.chat.role.admin()}
                            >
                                {$LL.chat.role.adminShort()}
                            </div>
                        {/if}
                    </div>
                </div>
                <div class="text-xs mb-0 font-condensed opacity-75 self-end">
                    {#if isMe}
                        {$LL.chat.you()}
                    {:else if $userStatus}
                        <div class="flex items-center brightness-150" style="color:{getColorHexOfStatus($userStatus)}">
                            {#if $userStatus}
                                <div
                                    class="rounded-full me-1 h-1.5 w-1.5"
                                    style="background:{getColorHexOfStatus($userStatus)}"
                                />
                            {/if}
                            {getNameOfAvailabilityStatus($userStatus ?? 0)}
                        </div>
                    {:else}
                        {$LL.chat.userList.disconnected()}
                    {/if}
                </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                {#if actions.walkTo}
                    <PersonActionButton
                        class="walk-to"
                        primary
                        label={$LL.chat.userList.walkTo()}
                        ariaLabel={$LL.chat.userList.walkToUser({ userName: displayName })}
                        testId={`walk-to-${user.username}`}
                        on:click={walkTo}
                    >
                        <IconWalk font-size="20" />
                    </PersonActionButton>
                {:else if actions.goToRoom}
                    <PersonActionButton
                        class="teleport"
                        primary
                        label={$LL.chat.userList.goToRoom()}
                        ariaLabel={$LL.chat.userList.goToRoomOfUser({ userName: displayName })}
                        testId={`go-to-room-${user.username}`}
                        on:click={goToRoom}
                    >
                        <IconDoorIn font-size="20" />
                    </PersonActionButton>
                {/if}
                {#if actions.message !== "hidden"}
                    <PersonActionButton
                        label={$LL.chat.userList.message()}
                        ariaLabel={$LL.chat.userList.messageUser({ userName: displayName })}
                        testId={`send-message-${user.username}`}
                        on:click={sendMessage}
                    >
                        <IconMessage font-size="20" />
                    </PersonActionButton>
                {:else if $roomCreationInProgress && showRoomCreationInProgress}
                    <div class="min-h-[30px] text-md flex gap-2 justify-center flex-row items-center p-1">
                        <IconLoader class="animate-spin" />
                    </div>
                {/if}
                {#if actions.hasMenu}
                    <UserActionButton
                        {user}
                        showLocate={actions.locate}
                        showBusinessCard={actions.businessCard}
                        showBan={actions.ban}
                    />
                {/if}
            </div>
        </div>
    </div>

    <style lang="scss">
        .status {
            background-color: var(--color);
        }
    </style>
{/if}
