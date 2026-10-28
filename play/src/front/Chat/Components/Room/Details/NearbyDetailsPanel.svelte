<script lang="ts">
    import LL from "../../../../../i18n/i18n-svelte";
    import type { ProximityChatRoom } from "../../../Connection/Proximity/ProximityChatRoom";
    import { openRoomDetailsIdStore } from "../../../Stores/ChatDetailsStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import { formatPeopleNames, resolveTopRowState } from "../../TopRow/TopRowSummary";
    import { nearbyTitleLines } from "../Thread/nearbyTitle";
    import SharedSummary from "./SharedSummary.svelte";
    import { IconChevronLeft, IconChevronRight, IconMessageCircle2 } from "@wa-icons";

    /**
     * The proximity chat's details, over the conversation: who is here now and what was shared in it. It has no pins
     * and no settings. Back returns to the conversation.
     */
    export let room: ProximityChatRoom;

    const MAX_STACKED_AVATARS = 3;
    const participants = room.participants;
    const spaceKind = room.spaceKind;
    const spaceName = room.name;
    const direction = document.documentElement.getAttribute("dir") || "ltr";

    // The same people as the chat's header: those a message sent now goes to.
    $: state = resolveTopRowState({
        spaceKind: $spaceKind,
        spaceName: $spaceName,
        participants: $participants,
        areas: [],
    });
    $: people = state.kind === "withPeople" ? state.people : [];
    $: names = formatPeopleNames(
        people.map((person) => person.name),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );
    $: ({ title, subtitle, isLive } = nearbyTitleLines(state, names, $LL));

    function close() {
        openRoomDetailsIdStore.set(undefined);
    }
</script>

<div class="nearby-details absolute inset-0 z-[100] flex flex-col" data-testid="nearbyDetailsPanel">
    <div class="p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10">
        <button
            type="button"
            class="p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12 shrink-0"
            data-testid="nearbyDetailsBack"
            aria-label={$LL.chat.details.title()}
            on:click={close}
        >
            {#if direction === "rtl"}
                <IconChevronRight font-size="20" />
            {:else}
                <IconChevronLeft font-size="20" />
            {/if}
        </button>
        <div class="px-2 text-md font-bold">{$LL.chat.details.title()}</div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex flex-col items-center gap-1.5 pt-1 text-center">
            <div class="mb-1.5 flex items-center" aria-hidden="true">
                {#if people.length > 0}
                    {#each people.slice(0, MAX_STACKED_AVATARS) as person, index (person.id)}
                        <span class={index === 0 ? "" : "-ms-8"} style:z-index={MAX_STACKED_AVATARS - index}>
                            <TopRowAvatar pictureStore={person.pictureStore} name={person.name} size="xl" />
                        </span>
                    {/each}
                {:else}
                    <span class="grid h-[88px] w-[88px] place-items-center rounded-full bg-white/10 text-white/70">
                        <IconMessageCircle2 font-size="32" />
                    </span>
                {/if}
            </div>
            <div class="max-w-full break-words text-lg font-bold leading-6" data-testid="nearbyDetailsName">
                {title}
            </div>
            <div class="flex max-w-full items-center gap-1.5 text-xs text-white/60">
                {#if isLive}
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
                {/if}
                <span class="truncate">{subtitle}</span>
            </div>
        </div>

        <SharedSummary {room} note={$LL.chat.details.keptOnAccount()} />

        <div class="details-group" data-testid="nearbyDetailsHereNow">
            <div class="details-heading">{$LL.chat.details.hereNow()} · {people.length}</div>
            {#each people as person (person.id)}
                <div class="u-menu-row !m-0 cursor-default">
                    <TopRowAvatar pictureStore={person.pictureStore} name={person.name} ring={false} />
                    <span class="u-menu-label truncate">{person.name}</span>
                </div>
            {:else}
                <p class="m-0 px-2 pb-2 pt-1 text-sm text-white/60">{subtitle}</p>
            {/each}
        </div>
    </div>
</div>

<style>
    .details-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .details-heading {
        padding: 0.4rem 0.5rem 0.2rem;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
</style>
