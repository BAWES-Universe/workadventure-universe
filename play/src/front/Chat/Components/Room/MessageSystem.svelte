<script lang="ts">
    import { locale } from "../../../../i18n/i18n-svelte";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import { chatTime } from "./MessageTime";

    export let message: Pick<ChatMessage, "date" | "content">;

    $: ({ date, content } = message);
</script>

<div class="message group flex flex-col justify-center items-center mb-3">
    <span class="px-3 py-1.5 m-0 text-xs text-center border border-solid border-white/10 rounded-2xl">
        <span class="messageTextBody text-white/80 group-hover:text-white/100">
            {$content.body}
        </span>
        {#if date}<span class="text-white/40">{chatTime(date, $locale)}</span>{/if}
    </span>
</div>

<style>
    .message {
        overflow-wrap: anywhere;
    }
</style>
