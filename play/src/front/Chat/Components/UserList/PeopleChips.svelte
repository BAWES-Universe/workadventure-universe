<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import type { PeopleView } from "../../Stores/ChatStore";
    import { peopleViewStore } from "../../Stores/ChatStore";

    /**
     * Everyone | Friends | Requests above the People list. Requests only shows while a request is open either way,
     * with a gold count of the ones waiting for you.
     */
    export let friendsCount: number;
    export let incomingCount: number;
    export let showRequests: boolean;

    $: chips = [
        { view: "everyone" as PeopleView, label: $LL.chat.friends.everyone(), count: undefined },
        { view: "friends" as PeopleView, label: $LL.chat.friends.friends(), count: friendsCount || undefined },
        ...(showRequests
            ? [
                  {
                      view: "requests" as PeopleView,
                      label: $LL.chat.friends.requests(),
                      count: incomingCount || undefined,
                  },
              ]
            : []),
    ];
</script>

<div
    class="flex items-center gap-1.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]"
    role="group"
    aria-label={$LL.chat.friends.chipsLabel()}
    data-testid="peopleChips"
>
    {#each chips as chip (chip.view)}
        <button
            type="button"
            class="people-chip m-0 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition-colors {$peopleViewStore ===
            chip.view
                ? 'u-cta text-white'
                : 'u-glass text-white/80 hover:bg-white/10 hover:text-white'}"
            aria-pressed={$peopleViewStore === chip.view}
            data-testid={`peopleChip-${chip.view}`}
            on:click={() => peopleViewStore.set(chip.view)}
        >
            <span>{chip.label}</span>
            {#if chip.count !== undefined}
                {#if chip.view === "requests"}
                    <span
                        class="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#E9C74C] px-1.5 text-[11px] font-bold tabular-nums text-[#0A0814]"
                        aria-label={$LL.chat.friends.requestsWaiting({ count: chip.count })}>{chip.count}</span
                    >
                {:else}
                    <span class="u-count">{chip.count}</span>
                {/if}
            {/if}
        </button>
    {/each}
</div>
