<script lang="ts">
    import { chatVisibilityStore } from "../../../Stores/ChatStore";
    import CallBarHost from "./CallBarHost.svelte";
    import { botCallStore, callBarInChatStore } from "./CallStore";

    /**
     * The call bar on screen when the call's own chat is not the one in view: another chat is open, or the chat is closed,
     * on phone and computer (#2004). Exactly one bar for one call: this one shows only while the one in the chat does not.
     */
    $: inView = $callBarInChatStore && $chatVisibilityStore;
</script>

{#if $botCallStore && !inView}
    <CallBarHost floating />
{/if}
