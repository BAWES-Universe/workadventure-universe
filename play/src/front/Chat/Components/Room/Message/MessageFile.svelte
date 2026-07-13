<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import { IconFile } from "@wa-icons";

    export let content: Readable<ChatMessageContent>;
</script>

<a
    href={$content.url}
    target="_blank"
    rel="noopener noreferrer"
    download
    class="flex items-center text-white hover:bg-white/10 px-2 py-2 rounded-md hover:no-underline hover:text-white font-bold cursor-pointer"
>
    <div class="flex items-center justify-center p-2 bg-white/10 rounded-full">
        <IconFile font-size="20" />
    </div>
    <div class="px-4 truncate">
        {$content.body}
    </div>
</a>
