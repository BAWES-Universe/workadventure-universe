<script lang="ts">
    import { AvailabilityStatus } from "@workadventure/messages";
    import * as Sentry from "@sentry/svelte";
    import highlightWords from "highlight-words";
    import { derived, readable } from "svelte/store";
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
    import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
    import { requestVisitCardsStore } from "../../../Stores/GameStore";
    import { canOpenOrbit } from "../../../external-modules/admin-api/index";
    import { adminDashboardActivatedStore } from "../../../Stores/MenuStore";
    import { botIdFromChatId, botStatusColour } from "../../Bots/BotChatStatus";
    import { botStatusCache } from "../../Bots/BotStatusStore";
    import { friendsEnabledStore, relationshipsStore } from "../../Stores/FriendsStore";
    import UserActionButton from "./UserActionButton.svelte";
    import ImageWithFallback from "./ImageWithFallback.svelte";
    import PersonActionButton from "./PersonActionButton.svelte";
    import PersonSessionRow from "./PersonSessionRow.svelte";
    import { getPersonActions, isSelf } from "./PersonActions";
    import { bestStatus, isMyAccount } from "./PersonSessions";
    import { statusLabel } from "./PersonStatus";
    import {
        goToPersonRoom,
        locatePerson,
        nearestSessionOnThisMap,
        showMyself,
        walkToPerson,
    } from "./PersonNavigation";
    import { friendMenuAction } from "./FriendMenuAction";
    import type { FriendMenuAction } from "./FriendMenuAction";
    import RingButton from "./RingButton.svelte";
    import {
        IconChevronDown,
        IconDoorIn,
        IconLoader,
        IconMapPin,
        IconMessage,
        IconUserCheck,
        IconWalk,
    } from "@wa-icons";

    export let user: ChatUser;
    /** All of this person's sessions (tabs, devices), `user` first. One row stands for all of them. */
    export let sessions: ChatUser[] = [user];

    export let isMatrixChatEnabled = true;

    let showRoomCreationInProgress = false;

    $: ({ chatId, availabilityStatus, username = "", color, isAdmin, pictureStore } = user);

    // A bot here is on (it walks the map), but may have no AI provider yet: say so before anyone writes to it.
    $: botId = user.isBot ? botIdFromChatId(chatId) : undefined;
    $: botAvailability = botId ? botStatusCache.store(botId) : readable(undefined);
    $: botUnready = $botAvailability === "unready";

    // No scene while a reconnect swaps it: the row still shows, without the actions that need the map.
    const currentGameScene = gameManager.tryGetCurrentGameScene();
    const connection = currentGameScene?.connection;
    const iAmAdmin = connection?.hasTag("admin") ?? false;

    // "Yourself" is this tab's own avatar: other tabs of the same account are other people here.
    const me = {
        spaceUserId: connection?.getSpaceUserId(),
        chatId: localUserStore.getChatId() ?? undefined,
        uuid: localUserStore.getLocalUser()?.uuid,
    };
    $: isMe = isSelf(user, me);
    // Your own account seen from somewhere else (another of your tabs is listed before this one is): no chat with it.
    $: isMine = !isMe && isMyAccount(user, me);

    // Someone with several sessions shows as available as their most available one.
    $: sessionsStatus =
        sessions.length > 1
            ? derived(
                  sessions.map((session) => session.availabilityStatus),
                  (statuses) => bestStatus(statuses) ?? AvailabilityStatus.UNCHANGED
              )
            : availabilityStatus;
    $: userStatus = isMe ? availabilityStatusStore : sessionsStatus;

    // Under the toggle: your other sessions, or all of someone else's, each reachable on its own.
    // Only for someone with more than one session.
    $: listedSessions = sessions.length < 2 ? [] : isMe ? sessions.slice(1) : sessions;
    $: firstSessionNumber = isMe ? 2 : 1;
    let sessionsOpen = false;

    $: chunks = highlightWords({
        text: displayName,
        query: $chatSearchBarValue,
    });

    const roomCreationInProgress = gameManager.chatConnection.roomCreationInProgress;

    // Orbit is set up a moment after the map loads (it turns its action bar button on then): re-checked when it is.
    $: canViewProfiles = $adminDashboardActivatedStore && canOpenOrbit();

    $: actions = getPersonActions({
        isSelf: isMe,
        isMyAccount: isMine,
        isBot: user.isBot,
        status: $userStatus,
        uuid: user.uuid,
        chatId: user.chatId,
        playUri: user.playUri,
        currentRoomUrl: currentGameScene?.roomUrl,
        visitCardUrl: user.visitCardUrl,
        isMatrixChatEnabled,
        roomCreationInProgress: showRoomCreationInProgress,
        iAmAdmin,
        canViewProfiles,
    });

    $: displayName = username.match(/\[\d*]/) ? username.substring(0, username.search(/\[\d*]/)) : username;

    // Someone else with several sessions: Walk to, Go to room and Locate open the list, so you pick which one.
    $: choosesSession = !isMe && listedSessions.length > 0;
    $: showLocateInMenu = actions.locate && !choosesSession;
    // Friends: a badge on friends, and Add friend (or what comes next) in the menu, for signed-in people only.
    $: relationship = user.uuid ? $relationshipsStore.get(user.uuid) ?? "none" : "none";
    $: isFriend = relationship === "friends";
    $: friendAction =
        $friendsEnabledStore && !isMe && !isMine && !user.isBot && user.uuid && user.chatId
            ? friendMenuAction(relationship, user.uuid, displayName, $LL)
            : undefined;
    // A friend who is here can be rung over; Message then moves to ⋮ so the row keeps three buttons.
    $: canRing = $friendsEnabledStore && isFriend && !isMe && !!user.uuid && !!$userStatus;
    $: menuMessage =
        canRing && actions.message !== "hidden"
            ? ([
                  {
                      label: $LL.chat.userList.message(),
                      icon: IconMessage,
                      danger: false,
                      act: sendMessage,
                  },
              ] satisfies FriendMenuAction[])
            : [];
    $: hasMenu =
        showLocateInMenu || actions.viewProfile || actions.ban || friendAction !== undefined || menuMessage.length > 0;

    function walkTo() {
        if (choosesSession) {
            sessionsOpen = !sessionsOpen;
            return;
        }
        if (!user.uuid || !user.playUri) return;
        analyticsClient.goToUser();
        walkToPerson(user);
    }

    function goToRoom() {
        if (choosesSession) {
            sessionsOpen = !sessionsOpen;
            return;
        }
        if (!user.playUri) return;
        analyticsClient.goToUser();
        goToPersonRoom(user);
    }

    // A bot's Locate button: the same as tapping its row, from a button people can see.
    function locate() {
        if (choosesSession) {
            sessionsOpen = !sessionsOpen;
            return;
        }
        if ($requestVisitCardsStore != undefined) requestVisitCardsStore.set(null);
        openWokaMenu();
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

    let loadingDirectRoomAccess = false;

    function openWokaMenu() {
        if (isMe) {
            // Like anyone else's card: on a phone the sidebar makes way for it, and comes back when it is closed.
            if (user.uuid != undefined) peopleCardReturn.tappedPerson(user.uuid);
            showMyself(user.uuid ?? undefined);
            return;
        }
        if (user.uuid == undefined) return;
        // Track the open woka menu action
        analyticsClient.openWokaMenu();
        // On a phone the sidebar makes way for their card, and comes back when the card is closed.
        peopleCardReturn.tappedPerson(user.uuid);
        // Opens the menu on this exact avatar when it is in view (by space user id, so clones are told apart),
        // otherwise asks the server for the position.
        locatePerson(nearestSessionOnThisMap(sessions, user), displayName);
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
                        {#if isFriend}
                            <span
                                class="ms-1 flex shrink-0 text-[#c4b5fd]"
                                title={$LL.chat.friends.friendBadge()}
                                data-testid={`friend-badge-${user.username}`}
                            >
                                <IconUserCheck font-size="14" aria-label={$LL.chat.friends.friendBadge()} />
                            </span>
                        {/if}
                        {#if isAdmin}
                            <div
                                class="text-xxs bg-secondary rounded-sm px-1 py-0.5 ms-1"
                                title={$LL.chat.role.admin()}
                            >
                                {$LL.chat.role.adminShort()}
                            </div>
                        {/if}
                        {#if user.isBot}
                            <span
                                class="ms-1.5 shrink-0 rounded-md bg-white/10 px-1.5 py-px text-[10px] font-bold uppercase leading-[13px] tracking-[0.08em] text-white/75"
                                data-testid="botTag">{$LL.chat.botStatus.tag()}</span
                            >
                        {/if}
                    </div>
                </div>
                <div class="text-xs mb-0 font-condensed opacity-75 self-end">
                    {#if isMe}
                        {$LL.chat.you()}
                    {:else if botUnready}
                        <div
                            class="flex items-center"
                            style="color:{botStatusColour('unready')}"
                            data-testid="botUnready"
                        >
                            <div
                                class="rounded-full me-1 h-1.5 w-1.5"
                                style="background:{botStatusColour('unready')}"
                            />
                            {$LL.chat.botStatus.unready()}
                        </div>
                    {:else if $userStatus}
                        <div class="flex items-center brightness-150" style="color:{getColorHexOfStatus($userStatus)}">
                            {#if $userStatus}
                                <div
                                    class="rounded-full me-1 h-1.5 w-1.5"
                                    style="background:{getColorHexOfStatus($userStatus)}"
                                />
                            {/if}
                            {statusLabel($userStatus, $LL)}
                        </div>
                    {:else}
                        {$LL.chat.userList.disconnected()}
                    {/if}
                </div>
                {#if listedSessions.length > 0}
                    <button
                        type="button"
                        class="m-0 mt-1 flex items-center gap-1 rounded border-0 bg-white/10 px-1.5 py-0.5 text-xxs font-semibold text-white/80 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                        aria-expanded={sessionsOpen}
                        aria-label={sessionsOpen
                            ? $LL.chat.peopleTab.hideSessions({ userName: displayName })
                            : $LL.chat.peopleTab.showSessions({ userName: displayName, count: sessions.length })}
                        data-testid={`sessions-toggle-${user.username}`}
                        on:click|stopPropagation={() => (sessionsOpen = !sessionsOpen)}
                    >
                        {$LL.chat.peopleTab.sessions({ count: sessions.length })}
                        <IconChevronDown
                            font-size="12"
                            class="transition-transform {sessionsOpen ? '' : '-rotate-90 rtl:rotate-90'}"
                        />
                    </button>
                {/if}
            </div>
            <div class="flex shrink-0 items-center gap-1">
                {#if actions.walkTo}
                    <PersonActionButton
                        class="walk-to"
                        primary
                        label={$LL.chat.userList.walkTo()}
                        ariaLabel={$LL.chat.userList.walkToUser({ userName: displayName })}
                        testId={`walk-to-${user.username}`}
                        expanded={choosesSession ? sessionsOpen : undefined}
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
                        expanded={choosesSession ? sessionsOpen : undefined}
                        on:click={goToRoom}
                    >
                        <IconDoorIn font-size="20" />
                    </PersonActionButton>
                {/if}
                {#if actions.locateButton}
                    <PersonActionButton
                        class="locate"
                        label={$LL.chat.userList.follow()}
                        ariaLabel={$LL.chat.userList.locateUser({ userName: displayName })}
                        testId={`locate-${user.username}`}
                        expanded={choosesSession ? sessionsOpen : undefined}
                        on:click={locate}
                    >
                        <IconMapPin font-size="20" />
                    </PersonActionButton>
                {/if}
                {#if canRing && user.uuid}
                    <RingButton
                        uuid={user.uuid}
                        name={displayName}
                        status={$userStatus}
                        testId={`ring-${user.username}`}
                    />
                {:else if actions.message !== "hidden"}
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
                {#if hasMenu}
                    <UserActionButton
                        {user}
                        showLocate={showLocateInMenu}
                        showViewProfile={actions.viewProfile}
                        showBan={actions.ban}
                        {friendAction}
                        extraActions={menuMessage}
                    />
                {/if}
            </div>
        </div>
        {#if sessionsOpen && listedSessions.length > 0}
            <ul class="m-0 list-none p-0" data-testid={`sessions-${user.username}`}>
                {#each listedSessions as session, index (session.spaceUserId ?? index)}
                    <PersonSessionRow {session} number={firstSessionNumber + index} {displayName} />
                {/each}
            </ul>
        {/if}
    </div>

    <style lang="scss">
        .status {
            background-color: var(--color);
        }
    </style>
{/if}
