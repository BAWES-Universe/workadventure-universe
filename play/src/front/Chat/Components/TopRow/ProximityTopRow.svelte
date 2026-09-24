<script lang="ts">
    import { derived, readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { ProximityChatParticipant, ProximityChatRoom } from "../../Connection/Proximity/ProximityChatRoom";
    import type { SpaceUserExtended } from "../../../Space/SpaceInterface";
    import { areaPresenceStore } from "../../Stores/AreaPresenceStore";
    import { navChat } from "../../Stores/ChatStore";
    import {
        adminDashboardActivatedStore,
        inviteUserActivated,
        showMenuItem,
        SubMenusInterface,
    } from "../../../Stores/MenuStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { openAdminModalFromMenu } from "../../../external-modules/admin-api/index";
    import WokaFromUserId from "../../../Components/Woka/WokaFromUserId.svelte";
    import TopRowAvatar from "./TopRowAvatar.svelte";
    import type { TopRowArea } from "./TopRowSummary";
    import {
        countWorldPresence,
        formatPeopleNames,
        formatTypingLine,
        formatWorldLine,
        resolveTopRowState,
    } from "./TopRowSummary";
    import { IconMapPin, IconUserPlus, IconUsers, IconWorldSearch } from "@wa-icons";

    export let proximityChatRoom: ProximityChatRoom;
    /** Opens the proximity chat timeline, exactly as the row always did. */
    export let onOpen: () => void;

    const MAX_STACKED_AVATARS = 3;

    const gameScene = gameManager.getCurrentGameScene();
    // "Yourself" is this tab's own avatar, never the account: other tabs of the same account count as people.
    const mySpaceUserId = gameScene.connection?.getSpaceUserId();
    const roomUrl = gameScene.roomUrl;
    const mapName = gameScene.room.roomName;
    const isOnlineListEnabled = gameScene.room.isChatOnlineListEnabled;
    const canSeeWhoIsHere = gameScene.room.isChatOnlineListEnabled || gameScene.room.isChatDisconnectedListEnabled;
    const worldUsers = gameScene.allUsersInWorldStore;

    const participants = proximityChatRoom.participants;
    const spaceKind = proximityChatRoom.spaceKind;
    const spaceJoinedAt = proximityChatRoom.spaceJoinedAt;
    const roomName = proximityChatRoom.name;
    const typingMembers = proximityChatRoom.typingMembers;
    const hasUserInProximityChat = proximityChatRoom.hasUserInProximityChat;
    const hasUnreadMessages = proximityChatRoom.hasUnreadMessages;
    const messages = proximityChatRoom.messages;

    function toParticipants(users: Map<string, SpaceUserExtended>): ProximityChatParticipant[] {
        return Array.from(users.values())
            .filter((user) => user.spaceUserId !== mySpaceUserId)
            .map((user) => ({ id: user.spaceUserId, name: user.name, pictureStore: user.pictureStore }));
    }

    // Areas the proximity chat is not connected to (meetings without chat, Matrix-only areas), with the
    // people a meeting's own space lists, so video participants count too.
    const areas: Readable<TopRowArea<ProximityChatParticipant>[]> = derived(
        areaPresenceStore,
        ($areaPresence, set) => {
            const entries = Array.from($areaPresence.values());
            const usersStores = entries.map((entry) =>
                entry.kind === "video" ? entry.usersStore : readable(new Map<string, SpaceUserExtended>())
            );
            return derived(usersStores, ($usersList) =>
                entries.map((entry, index): TopRowArea<ProximityChatParticipant> => {
                    if (entry.kind === "video") {
                        return { kind: "video", name: entry.name, participants: toParticipants($usersList[index]) };
                    }
                    return { kind: "matrix", name: entry.name };
                })
            ).subscribe(set);
        },
        [] as TopRowArea<ProximityChatParticipant>[]
    );

    function toPlainText(body: string): string {
        try {
            const doc = new DOMParser().parseFromString(body, "text/html");
            return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
        } catch {
            return "";
        }
    }

    function openUserList() {
        navChat.switchToUserList();
    }

    function openOrbit() {
        openAdminModalFromMenu();
    }

    function openInvite() {
        analyticsClient.openInvite();
        showMenuItem(SubMenusInterface.invite);
    }

    $: state = resolveTopRowState({
        spaceKind: $spaceKind,
        spaceName: $roomName,
        participants: $participants,
        areas: $areas,
    });

    $: people = state.kind === "withPeople" ? state.people : [];
    $: stackedPeople = people.slice(0, MAX_STACKED_AVATARS);
    $: extraPeople = Math.max(0, people.length - MAX_STACKED_AVATARS);
    $: peopleNames = formatPeopleNames(
        people.map((person) => person.name),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );

    $: title =
        state.kind === "withPeople"
            ? state.areaName ?? peopleNames
            : state.kind === "alone"
            ? $LL.chat.topRow.noOneNearby()
            : state.areaName;

    $: typingLine = formatTypingLine(
        $typingMembers.map((member) => member.name),
        {
            one: $LL.chat.topRow.typingOne,
            two: $LL.chat.topRow.typingTwo,
            many: $LL.chat.topRow.typingMany,
            someone: $LL.chat.topRow.someone(),
        }
    );

    // The latest message, only if it was written to the people you are with now.
    $: latestMessage = (() => {
        if (state.kind !== "withPeople" || $spaceJoinedAt === undefined) return undefined;
        for (let i = $messages.length - 1; i >= 0; i--) {
            const message = $messages[i];
            if (!message.date || message.date.getTime() < $spaceJoinedAt) return undefined;
            if (message.type !== "proximity") continue;
            return message;
        }
        return undefined;
    })();
    $: latestMessageContent = latestMessage?.content;
    $: latestMessageText = $latestMessageContent ? toPlainText($latestMessageContent.body) : "";
    $: latestMessageSender = latestMessage
        ? latestMessage.isMyMessage
            ? $LL.chat.topRow.you()
            : latestMessage.sender?.username ?? $LL.chat.topRow.someone()
        : "";

    $: worldPresence = $worldUsers ? countWorldPresence($worldUsers.values(), mySpaceUserId, roomUrl) : undefined;
    // Only what the People tab would show: nothing when the online list is disabled, nothing before it is loaded.
    $: worldLine =
        isOnlineListEnabled && worldPresence
            ? formatWorldLine(worldPresence, mapName, {
                  othersInRoom: $LL.chat.topRow.othersInRoom,
                  othersOnThisMap: $LL.chat.topRow.othersOnThisMap,
                  elsewhere: $LL.chat.topRow.elsewhereInWorld,
                  nobodyInWorld: $LL.chat.topRow.nobodyInWorld(),
                  separator: $LL.chat.topRow.separator(),
              })
            : undefined;

    $: subtitle =
        state.kind === "withPeople"
            ? state.areaName
                ? peopleNames
                : latestMessageText
                ? `${latestMessageSender}: ${latestMessageText}`
                : undefined
            : state.kind === "meetingAlone"
            ? $LL.chat.topRow.onlyYouHere()
            : worldLine;

    $: isLive = state.kind === "withPeople" || $hasUserInProximityChat;
    $: showActions = state.kind !== "withPeople";
</script>

<div
    class="top-row relative rounded-xl overflow-hidden transition-colors {isLive
        ? 'top-row-live'
        : ''} {$hasUnreadMessages ? 'bg-contrast-200/10' : ''}"
    data-testid="proximityTopRow"
    data-state={state.kind}
>
    <button
        class="group relative flex items-center gap-3 w-full min-h-[3.25rem] m-0 px-3 py-2 rounded-xl text-start hover:bg-contrast-200/10 focus-visible:bg-contrast-200/10"
        on:click={onOpen}
        data-testid="toggleDisplayProximityChat"
    >
        <span class="sr-only">{$LL.chat.proximity()}</span>
        <div class="relative flex shrink-0 items-center" aria-hidden="true">
            {#if stackedPeople.length > 0}
                <div class="flex items-center">
                    {#each stackedPeople as person, index (person.id)}
                        <div class={index === 0 ? "" : "-ms-3"} style:z-index={MAX_STACKED_AVATARS - index}>
                            <TopRowAvatar pictureStore={person.pictureStore} name={person.name} />
                        </div>
                    {/each}
                    {#if extraPeople > 0}
                        <div
                            class="-ms-3 h-8 min-w-8 px-1 rounded-full ring-2 ring-contrast bg-gradient-to-br from-primary to-secondary text-white text-[11px] font-bold flex items-center justify-center"
                        >
                            +{extraPeople}
                        </div>
                    {/if}
                </div>
            {:else}
                <div
                    class="top-row-alone-avatar relative h-8 w-8 rounded-full p-[2px] bg-gradient-to-br from-primary/70 to-secondary/70"
                >
                    <div
                        class="h-full w-full rounded-full overflow-hidden bg-contrast flex items-center justify-center"
                    >
                        {#if state.kind === "area"}
                            <IconMapPin font-size="16" class="text-white/80" />
                        {:else}
                            <div class="translate-y-[3px] group-hover:translate-y-0 transition-transform">
                                <WokaFromUserId userId={-1} customWidth="28px" placeholderSrc="" />
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
            {#if isLive}
                <span class="absolute -bottom-0.5 -end-0.5 flex h-3 w-3" title={$LL.chat.topRow.live()}>
                    <span
                        class="top-row-live-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60"
                    />
                    <span class="relative inline-flex h-3 w-3 rounded-full bg-success ring-2 ring-contrast" />
                </span>
            {/if}
        </div>

        <div class="flex min-w-0 grow flex-col">
            <div
                class="truncate text-sm {$hasUnreadMessages || isLive ? 'text-white font-bold' : 'text-white/85'}"
                data-testid="proximityTopRowTitle"
            >
                {title}
            </div>
            {#if typingLine}
                <div class="flex min-w-0 items-center text-xs text-secondary-400" data-testid="proximityTopRowTyping">
                    <span class="truncate">{typingLine}</span><span class="top-row-ellipsis" aria-hidden="true"
                        ><span>.</span><span>.</span><span>.</span></span
                    >
                </div>
            {:else if subtitle}
                <div class="truncate text-xs text-white/60" data-testid="proximityTopRowSubtitle">{subtitle}</div>
            {/if}
        </div>

        {#if $hasUnreadMessages}
            <div class="flex items-center justify-center h-7 w-7 relative shrink-0">
                <div class="rounded-full bg-secondary-200 h-2 w-2 motion-safe:animate-ping absolute" />
                <div class="rounded-full bg-secondary-200 h-1.5 w-1.5 absolute" />
            </div>
        {/if}
    </button>

    {#if showActions && (canSeeWhoIsHere || $adminDashboardActivatedStore || $inviteUserActivated)}
        <div class="flex flex-wrap gap-2 px-3 pb-3 pt-1">
            {#if canSeeWhoIsHere}
                <button
                    class="top-row-action flex items-center gap-1.5 min-h-11 m-0 px-3 rounded-full text-xs font-bold text-white bg-gradient-to-r from-primary/80 to-secondary/80 hover:from-primary hover:to-secondary"
                    on:click={openUserList}
                    data-testid="proximityTopRowSeeWhoIsHere"
                >
                    <IconUsers font-size="16" />
                    {$LL.chat.topRow.seeWhoIsHere()}
                </button>
            {/if}
            {#if $adminDashboardActivatedStore}
                <button
                    class="top-row-action flex items-center gap-1.5 min-h-11 m-0 px-3 rounded-full text-xs font-bold text-white/90 bg-white/10 hover:bg-white/20"
                    on:click={openOrbit}
                    data-testid="proximityTopRowOrbit"
                >
                    <IconWorldSearch font-size="16" />
                    {$LL.chat.topRow.exploreWithOrbit()}
                </button>
            {/if}
            {#if $inviteUserActivated}
                <button
                    class="top-row-action flex items-center gap-1.5 min-h-11 m-0 px-3 rounded-full text-xs font-bold text-white/90 bg-white/10 hover:bg-white/20"
                    on:click={openInvite}
                    data-testid="proximityTopRowInvite"
                >
                    <IconUserPlus font-size="16" />
                    {$LL.chat.topRow.inviteSomeone()}
                </button>
            {/if}
        </div>
    {/if}
</div>

<style>
    .top-row-live {
        background-image: linear-gradient(to right, rgb(134 41 252 / 0.16), rgb(65 86 246 / 0.08) 60%, transparent);
    }

    :global([dir="rtl"]) .top-row-live {
        background-image: linear-gradient(to left, rgb(134 41 252 / 0.16), rgb(65 86 246 / 0.08) 60%, transparent);
    }

    .top-row-ellipsis span {
        display: inline-block;
    }

    @media (prefers-reduced-motion: no-preference) {
        .top-row-live-ping {
            animation: top-row-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
        }

        .top-row-ellipsis span {
            animation: top-row-ellipsis 1.2s infinite ease-in-out;
        }

        .top-row-ellipsis span:nth-child(2) {
            animation-delay: 0.15s;
        }

        .top-row-ellipsis span:nth-child(3) {
            animation-delay: 0.3s;
        }
    }

    @keyframes top-row-ping {
        75%,
        100% {
            transform: scale(2.2);
            opacity: 0;
        }
    }

    @keyframes top-row-ellipsis {
        0%,
        60%,
        100% {
            opacity: 0.25;
            transform: translateY(0);
        }
        30% {
            opacity: 1;
            transform: translateY(-2px);
        }
    }
</style>
