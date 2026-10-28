<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import { singlePlayback } from "../../../../Utils/SinglePlayback";
    import { getMediaCaption } from "../MessageActions/messageActions";

    export let content: Readable<ChatMessageContent>;

    // The file name a Matrix video carries as its body is not a caption.
    $: caption = getMediaCaption($content);
</script>

{#if $content.url !== undefined}
    <!-- svelte-ignore a11y-media-has-caption -->
    <video controls use:singlePlayback class="w-full block rounded">
        <source src={$content.url} />
    </video>
{/if}

{#if caption}
    <div class="px-2 py-1 text-sm text-white/90">{caption}</div>
{/if}
