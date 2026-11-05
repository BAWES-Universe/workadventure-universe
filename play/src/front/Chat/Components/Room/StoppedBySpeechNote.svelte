<script lang="ts">
    import type { Readable } from "svelte/store";
    import LL from "../../../../i18n/i18n-svelte";

    /** Whether a voice bot's voice stopped part-way through the reply above because someone spoke over it (#1665). */
    export let stopped: Readable<boolean>;
</script>

{#if $stopped}
    <div class="note" data-testid="stoppedBySpeech">{$LL.chat.voiceDraft.stopped()}</div>
{/if}

<style>
    /* Under the cut-off message, in line with its words: small and grey */
    .note {
        margin: 2px 0 6px 52px;
        font-size: 11.5px;
        color: rgb(255 255 255 / 0.5);
    }
</style>
