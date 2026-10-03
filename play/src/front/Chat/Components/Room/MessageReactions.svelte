<script lang="ts">
    import type { ChatMessageReaction } from "../../Connection/ChatConnection";
    import Reaction from "./Reaction.svelte";
    export let reactions: ChatMessageReaction[];
    export let classes = "";
</script>

<div class="reactions-bar empty:hidden absolute -bottom-4 flex flex-row flex-nowrap gap-1 {classes}">
    {#each reactions as reaction (reaction.key)}
        <Reaction {reaction} />
    {/each}
</div>
