<script lang="ts">
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ProximityChatRoom } from "../../../Connection/Proximity/ProximityChatRoom";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import { formatPeopleNames, resolveTopRowState } from "../../TopRow/TopRowSummary";

    /** The proximity chat: one timeline across every group, so the header says who you're with now. */
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
    $: label =
        state.kind === "withPeople"
            ? state.areaName ??
              formatPeopleNames(
                  people.map((person) => person.name),
                  { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
              )
            : state.kind === "alone"
            ? $LL.chat.thread.nobodyNearby()
            : state.areaName;
    $: isLive = state.kind === "withPeople";
</script>

<div
    class="flex min-w-0 items-center justify-center gap-1.5 text-xs {isLive ? 'text-white/85' : 'text-white/50'}"
    data-testid="threadNow"
    data-state={state.kind}
>
    {#if stackedPeople.length > 0}
        <span class="flex shrink-0 items-center scale-75 -my-1" aria-hidden="true">
            {#each stackedPeople as person, index (person.id)}
                <span class={index === 0 ? "" : "-ms-3"} style:z-index={MAX_STACKED_AVATARS - index}>
                    <TopRowAvatar pictureStore={person.pictureStore} name={person.name} />
                </span>
            {/each}
        </span>
    {:else}
        <span class="h-1.5 w-1.5 shrink-0 rounded-full {isLive ? 'bg-success' : 'bg-white/30'}" aria-hidden="true" />
    {/if}
    <span class="truncate" data-testid="threadNowLabel">{$LL.chat.thread.now({ label })}</span>
</div>
