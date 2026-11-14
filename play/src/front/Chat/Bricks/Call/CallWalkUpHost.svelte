<script lang="ts">
    import { botCallStore } from "./CallStore";
    import { callRuntime } from "./CallHost";
    import WalkUpCard from "./WalkUpCard.svelte";

    /**
     * The card for someone who walked up while the person is on a call (game #2004). Shown on every screen, because the
     * call follows the person: it is the same card wherever they are. Its two actions are the call's own, never the
     * Busy card's, so nothing here touches the person's status.
     */
    $: walkUp = $botCallStore?.state.walkUp;
    $: botName = $botCallStore?.botName ?? "";
</script>

{#if walkUp}
    <WalkUpCard
        name={walkUp.name}
        {botName}
        onHoldAndTalk={() => callRuntime.holdAndTalk()}
        onNotNow={() => callRuntime.notNow()}
    />
{/if}
