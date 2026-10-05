<script lang="ts">
    import { broadcastInboxStore, broadcastPanelOpenStore } from "../../Stores/BroadcastStore";
    import BroadcastReceivedCard from "./BroadcastReceivedCard.svelte";

    // Escape dismisses the newest card only, one per press; while the Broadcast card is open, Escape closes that.
    function onKeyDown(event: KeyboardEvent) {
        if (event.key !== "Escape" || $broadcastPanelOpenStore) return;
        const newest = $broadcastInboxStore[0];
        if (newest) broadcastInboxStore.dismiss(newest.id);
    }
</script>

<svelte:window on:keydown={onKeyDown} />

{#if $broadcastInboxStore.length > 0}
    <!-- Received broadcasts stack at the top of the screen (under the Live pill when you are live yourself), the
         newest first, each until its Got it. -->
    <div
        class="fixed z-[1090] pointer-events-none inset-x-3 top-3 flex flex-col gap-2 lg:inset-x-auto lg:right-4 lg:top-20 lg:w-[380px]"
        data-testid="broadcast-inbox"
    >
        {#each $broadcastInboxStore as card (card.id)}
            <BroadcastReceivedCard {card} on:dismiss={() => broadcastInboxStore.dismiss(card.id)} />
        {/each}
    </div>
{/if}
