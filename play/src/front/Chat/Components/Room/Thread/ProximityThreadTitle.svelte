<script lang="ts">
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ProximityChatRoom } from "../../../Connection/Proximity/ProximityChatRoom";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import { formatPeopleNames, resolveTopRowState } from "../../TopRow/TopRowSummary";
    import { IconMessageCircle2 } from "@wa-icons";

    /**
     * Header title of the nearby (proximity) chat: the wokas and names of who you're with, and a live line while
     * the bubble lasts. One timeline across every group, so it always names who a message sent now goes to.
     */
    export let room: ProximityChatRoom;

    const MAX_STACKED_AVATARS = 3;

    const participants = room.participants;
    const spaceKind = room.spaceKind;
    const spaceName = room.name;

    // Only what the proximity chat itself is connected to: that is where a message sent now goes.
    $: state = resolveTopRowState({
        spaceKind: $spaceKind,
        spaceName: $spaceName,
        participants: $participants,
        areas: [],
    });
    $: people = state.kind === "withPeople" ? state.people : [];
    $: stackedPeople = people.slice(0, MAX_STACKED_AVATARS);
    $: names = formatPeopleNames(
        people.map((person) => person.name),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );
    $: isLive = state.kind === "withPeople";
    $: title =
        state.kind === "withPeople"
            ? state.areaName ?? names
            : state.kind === "alone"
            ? $LL.chat.nearby.title()
            : state.areaName;
    $: subtitle = isLive
        ? $LL.chat.nearby.talkingNow() +
          $LL.chat.topRow.separator() +
          (state.kind === "withPeople" && state.areaName ? names : $LL.chat.nearby.title())
        : state.kind === "meetingAlone"
        ? $LL.chat.topRow.onlyYouHere()
        : state.kind === "alone"
        ? $LL.chat.nearby.idle()
        : $LL.chat.nearby.title();
</script>

<div
    class="flex min-w-0 max-w-full items-center justify-center gap-2.5"
    data-testid="threadNow"
    data-state={state.kind}
>
    <div class="relative flex shrink-0 items-center" aria-hidden="true">
        {#if stackedPeople.length > 0}
            {#each stackedPeople as person, index (person.id)}
                <span class={index === 0 ? "" : "-ms-3"} style:z-index={MAX_STACKED_AVATARS - index}>
                    <TopRowAvatar pictureStore={person.pictureStore} name={person.name} />
                </span>
            {/each}
            {#if isLive}
                <span class="thread-live-ring absolute -inset-1 rounded-full border-2 border-solid border-success" />
            {/if}
        {:else}
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70">
                <IconMessageCircle2 font-size="16" />
            </span>
        {/if}
    </div>
    <div class="flex min-w-0 flex-col items-start">
        <div class="max-w-full truncate text-md font-bold leading-5" data-testid="roomName">{title}</div>
        <div class="flex max-w-full items-center gap-1.5 text-xs text-white/60" data-testid="threadNowLabel">
            {#if isLive}
                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
            {/if}
            <span class="truncate">{subtitle}</span>
        </div>
    </div>
</div>

<style>
    .thread-live-ring {
        opacity: 0.5;
    }

    @media (prefers-reduced-motion: no-preference) {
        .thread-live-ring {
            animation: thread-live-ring 2.2s ease-out infinite;
        }
    }

    @keyframes thread-live-ring {
        0% {
            transform: scale(0.94);
            opacity: 0.6;
        }
        100% {
            transform: scale(1.18);
            opacity: 0;
        }
    }
</style>
