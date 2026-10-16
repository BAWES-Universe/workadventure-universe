<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import type { BroadcastReach } from "../../Stores/BroadcastStore";
    import { broadcastReachInfoStore } from "../../Stores/BroadcastStore";
    import { reachDetail, reachTitle } from "./reach";
    import { IconDoor, IconInfoCircle, IconRocket, IconWorld } from "@wa-icons";

    /** The reaches this player may use for what they chose, in order. */
    export let reaches: BroadcastReach[] = [];
    export let reach: BroadcastReach | undefined = undefined;

    const dispatch = createEventDispatcher<{ next: void }>();
</script>

<h3 class="m-0 text-base font-semibold">{$LL.broadcast.who.title()}</h3>
<div class="flex flex-col gap-2" role="radiogroup" aria-label={$LL.broadcast.who.title()}>
    {#each reaches as candidate (candidate)}
        <button
            type="button"
            class="u-option"
            class:u-selected={reach === candidate}
            role="radio"
            aria-checked={reach === candidate}
            on:click={() => (reach = candidate)}
            data-testid="broadcast-reach-{candidate}"
        >
            <span class="u-option-tile" aria-hidden="true">
                {#if candidate === "ROOM"}
                    <IconDoor />
                {:else if candidate === "WORLD"}
                    <IconWorld />
                {:else}
                    <IconRocket />
                {/if}
            </span>
            <span class="u-option-text">
                <span class="u-option-title block">{reachTitle($LL, candidate)}</span>
                {#if reachDetail($LL, candidate, $broadcastReachInfoStore)}
                    <span class="u-option-desc block">{reachDetail($LL, candidate, $broadcastReachInfoStore)}</span>
                {/if}
            </span>
            <span class="u-radio" aria-hidden="true" />
        </button>
    {/each}
</div>
<p class="m-0 flex items-center gap-2 text-xs text-white/60">
    <IconInfoCircle font-size="16" class="flex-none" aria-hidden="true" />
    {$LL.broadcast.who.onlyAllowed()}
</p>
<button
    type="button"
    class="u-cta rounded-full w-full py-3.5 text-base font-bold"
    disabled={reach === undefined}
    on:click={() => dispatch("next")}
    data-testid="broadcast-next"
>
    {$LL.broadcast.next()}
</button>
