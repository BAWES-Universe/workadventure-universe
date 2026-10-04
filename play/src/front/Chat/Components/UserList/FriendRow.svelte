<script lang="ts">
    import type { Readable } from "svelte/store";
    import * as Sentry from "@sentry/svelte";
    import { AvailabilityStatus } from "@workadventure/messages";
    import type { FriendSession } from "@workadventure/messages";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import { getColorHexOfStatus } from "../../../Utils/AvailabilityStatus";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { openDirectChatRoom } from "../../Utils";
    import { canOpenOrbit, openOrbitProfile } from "../../../external-modules/admin-api/index";
    import { adminDashboardActivatedStore } from "../../../Stores/MenuStore";
    import PersonActionButton from "./PersonActionButton.svelte";
    import FriendAvatar from "./FriendAvatar.svelte";
    import FriendMenuButton from "./FriendMenuButton.svelte";
    import type { PlacedFriend } from "./Friends";
    import { isOnline, relativeTime } from "./Friends";
    import { statusLabel } from "./PersonStatus";
    import { goToPersonRoom, walkToPerson } from "./PersonNavigation";
    import { runFriendAction } from "./FriendActions";
    import {
        IconChevronDown,
        IconDoorIn,
        IconForbid,
        IconMessage,
        IconUserCircle,
        IconUserMinus,
        IconWalk,
    } from "@wa-icons";

    /**
     * One friend in the Friends view: where they are (or that they hide it, or when they were last seen) and how
     * to reach them. Walk to when they're here, Go when they're elsewhere and say where, Message otherwise.
     */
    export let entry: PlacedFriend;
    /** Their woka, when they are in this world. */
    export let picture: Readable<string | undefined> | undefined = undefined;
    export let color: string | undefined = undefined;
    export let isMatrixChatEnabled = true;
    /** Where friends are can't be checked right now. */
    export let presenceUnavailable = false;
    export let highlighted = false;

    $: friend = entry.friend;
    $: online = isOnline(entry.status);
    $: session = entry.session;
    $: canReach = online && !!session && !entry.locationUnknown;
    $: canWalk = canReach && entry.group === "here";
    $: canGo = canReach && entry.group !== "here";
    $: canMessage = isMatrixChatEnabled && !!friend.chatId;
    $: canViewProfile = $adminDashboardActivatedStore && canOpenOrbit();
    $: otherSessions = !entry.locationUnknown ? (friend.presence?.sessions ?? []).filter((s) => s !== session) : [];
    let sessionsOpen = false;

    function placeOf(s: FriendSession | undefined, group: PlacedFriend["group"]): string {
        if (!s) return "";
        const room = s.roomName || s.worldName;
        if (group === "here") return $LL.chat.friends.placeHere({ room });
        const where = s.worldName && s.worldName !== room ? s.worldName : s.universeName;
        return where ? $LL.chat.friends.place({ room, world: where }) : room;
    }

    $: line = ((): string => {
        if (!online) {
            if (presenceUnavailable) return $LL.chat.friends.statusUnavailable();
            const when = relativeTime(friend.lastSeenAt || undefined, Date.now(), $locale);
            return when ? $LL.chat.friends.lastSeen({ when }) : $LL.chat.friends.offline();
        }
        const status = entry.status === AvailabilityStatus.ONLINE ? "" : statusLabel(entry.status, $LL);
        if (entry.locationUnknown)
            return status ? `${status} · ${$LL.chat.friends.online()}` : $LL.chat.friends.locationHidden();
        const place = placeOf(session, entry.group);
        return [status, place].filter(Boolean).join(" · ") || $LL.chat.friends.online();
    })();

    function walk() {
        if (!session) return;
        analyticsClient.goToUser();
        walkToPerson({ uuid: friend.uuid, playUri: session.playUri });
    }

    function go(target: FriendSession | undefined = session) {
        if (!target) return;
        analyticsClient.goToUser();
        goToPersonRoom({ uuid: friend.uuid, playUri: target.playUri });
    }

    function message() {
        openDirectChatRoom(friend.chatId).catch((error) => {
            console.error("Error opening direct chat room:", error);
            Sentry.captureException(error);
        });
        analyticsClient.sendMessageFromUserList();
    }

    $: menuItems = [
        ...(canViewProfile
            ? [
                  {
                      key: "profile",
                      label: $LL.chat.userList.viewProfile(),
                      icon: IconUserCircle,
                      act: () => openOrbitProfile(friend.uuid),
                  },
              ]
            : []),
        {
            key: "remove",
            label: $LL.chat.friends.removeFriend(),
            icon: IconUserMinus,
            danger: true,
            act: () => runFriendAction(friend.uuid, friend.name, "remove").catch((e) => console.error(e)),
        },
        {
            key: "block",
            label: $LL.chat.friends.block(),
            icon: IconForbid,
            danger: true,
            act: () => runFriendAction(friend.uuid, friend.name, "block").catch((e) => console.error(e)),
        },
    ];
</script>

<div class="flex flex-col px-2 pb-2" data-testid={`friend-${friend.name}`} data-friend={friend.uuid}>
    <div
        class="flex items-center gap-2 rounded px-2 py-2 transition-colors hover:bg-white/10"
        class:friend-highlight={highlighted}
    >
        <FriendAvatar {picture} {color} dim={!online} />
        <div class="ms-1 flex min-w-0 flex-auto flex-col" class:opacity-60={!online}>
            <span class="truncate text-sm font-bold" title={friend.name}>{friend.name}</span>
            <span class="flex min-w-0 items-center gap-1 text-xs text-white/70">
                {#if online}
                    <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        style="background:{getColorHexOfStatus(entry.status)}"
                        aria-hidden="true"
                    />
                {/if}
                <span class="truncate">{line}</span>
            </span>
            {#if otherSessions.length > 0}
                <button
                    type="button"
                    class="m-0 mt-1 flex w-fit items-center gap-1 rounded border-0 bg-white/10 px-1.5 py-0.5 text-xxs font-semibold text-white/80 hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                    aria-expanded={sessionsOpen}
                    aria-label={sessionsOpen
                        ? $LL.chat.peopleTab.hideSessions({ userName: friend.name })
                        : $LL.chat.peopleTab.showSessions({ userName: friend.name, count: otherSessions.length + 1 })}
                    on:click|stopPropagation={() => (sessionsOpen = !sessionsOpen)}
                >
                    {$LL.chat.peopleTab.sessions({ count: otherSessions.length + 1 })}
                    <IconChevronDown
                        font-size="12"
                        class="transition-transform {sessionsOpen ? '' : '-rotate-90 rtl:rotate-90'}"
                    />
                </button>
            {/if}
        </div>
        <div class="flex shrink-0 items-center gap-1">
            {#if canWalk}
                <PersonActionButton
                    primary
                    label={$LL.chat.userList.walkTo()}
                    ariaLabel={$LL.chat.userList.walkToUser({ userName: friend.name })}
                    testId={`friend-walk-${friend.name}`}
                    on:click={walk}
                >
                    <IconWalk font-size="20" />
                </PersonActionButton>
            {:else if canGo}
                <PersonActionButton
                    primary
                    label={$LL.chat.friends.go()}
                    ariaLabel={$LL.chat.friends.goToFriend({ userName: friend.name })}
                    testId={`friend-go-${friend.name}`}
                    on:click={() => go()}
                >
                    <IconDoorIn font-size="20" />
                </PersonActionButton>
            {/if}
            {#if canMessage}
                <PersonActionButton
                    label={$LL.chat.userList.message()}
                    ariaLabel={$LL.chat.userList.messageUser({ userName: friend.name })}
                    testId={`friend-message-${friend.name}`}
                    on:click={message}
                >
                    <IconMessage font-size="20" />
                </PersonActionButton>
            {/if}
            <FriendMenuButton
                label={$LL.chat.userList.moreActions({ userName: friend.name })}
                testId={`friend-more-${friend.name}`}
                items={menuItems}
            />
        </div>
    </div>
    {#if sessionsOpen && otherSessions.length > 0}
        <ul class="m-0 list-none p-0 ps-11">
            {#each otherSessions as other, index (other.playUri + index)}
                <li class="flex items-center gap-2 px-2 py-1 text-xs text-white/70">
                    <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        style="background:{getColorHexOfStatus(other.availabilityStatus)}"
                        aria-hidden="true"
                    />
                    <span class="min-w-0 flex-auto truncate">{placeOf(other, "otherWorlds")}</span>
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold"
                        on:click={() => go(other)}
                    >
                        <IconDoorIn font-size="14" />
                        {$LL.chat.friends.go()}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .friend-highlight {
        background: rgba(134, 41, 252, 0.18);
        transition: background-color 1.2s ease;
    }
</style>
