<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";

    export let content: Readable<ChatMessageContent>;

    $: hasCaption = $content.body && $content.body.trim();
</script>

{#if $content.url !== undefined}
    <!-- svelte-ignore a11y-media-has-caption -->
    <video controls class="w-full block rounded">
        <source src={$content.url} />
    </video>
{/if}

{#if hasCaption}
    <div class="px-2 py-1 text-sm text-white/90">{$content.body}</div>
{/if}
