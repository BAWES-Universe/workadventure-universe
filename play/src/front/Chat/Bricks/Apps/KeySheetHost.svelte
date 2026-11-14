<script lang="ts">
    import { onMount } from "svelte";
    import { closeKeyFormSheet, isActiveHost, keyFormHosts, keyFormOpen, mountHost } from "./KeyFormLink";
    import KeySheet from "./KeySheet.svelte";

    /**
     * Draws the key sheet when a Brick's link or "Replace key" opens it (game #2044). It is mounted where such a request can
     * come from (the chat, the Apps page); when both are on screen, only the latest one draws, so the sheet is never doubled.
     */
    const me = Symbol("key-sheet-host");
    onMount(() => mountHost(me));
    $: active = isActiveHost(me, $keyFormHosts);
</script>

{#if $keyFormOpen && active}
    {#key $keyFormOpen}
        <KeySheet formId={$keyFormOpen} onClose={closeKeyFormSheet} />
    {/key}
{/if}
