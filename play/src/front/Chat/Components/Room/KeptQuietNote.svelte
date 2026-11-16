<script lang="ts">
    import type { Readable } from "svelte/store";
    import LL from "../../../../i18n/i18n-svelte";
    import type { KeptQuiet } from "../../Connection/ChatConnection";

    /**
     * Why a voice bot's reply above, written for this person alone, was not heard to its end (#1993): its voice would
     * have reached someone else too, so it was not said out loud, or it stopped part-way. The reply is there in full.
     */
    export let keptQuiet: Readable<KeptQuiet>;
</script>

{#if $keptQuiet === "unsaid"}
    <div class="note" data-testid="keptQuiet">{$LL.chat.voiceDraft.unsaidForOthers()}</div>
{:else if $keptQuiet === "stopped"}
    <div class="note" data-testid="keptQuiet">{$LL.chat.voiceDraft.stoppedForOthers()}</div>
{/if}

<style>
    /* Under the reply, in line with its words: small and grey, like the line for a reply someone spoke over */
    .note {
        margin: 2px 0 6px 52px;
        font-size: 11.5px;
        color: rgb(255 255 255 / 0.5);
    }
</style>
