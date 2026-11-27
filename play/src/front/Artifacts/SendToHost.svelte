<script lang="ts">
    import { closeSendTo, sendToRequest } from "./sendToStore";
    import SendToSheet from "./SendToSheet.svelte";

    /**
     * Draws the "Send to…" sheet when a document, the file viewer or a file card in a chat asks for it. Mounted once, with the
     * game's own toasts, so the sheet is the same wherever it was asked from. A new request starts the sheet afresh.
     */
</script>

{#if $sendToRequest}
    {#key $sendToRequest}
        <SendToSheet request={$sendToRequest} onClose={closeSendTo} />
    {/key}
{/if}
