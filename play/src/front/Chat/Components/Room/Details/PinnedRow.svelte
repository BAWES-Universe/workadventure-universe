<script lang="ts">
    import { readable } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import { badgeOfKind, fileKindOf } from "../../../../FileViewer/fileKinds";
    import { sentLabel } from "./SharedItems";
    import { sharedSender } from "./sharedSender";
    import { pinnedText } from "./PinnedSummaryText";

    /**
     * One pinned message in a chat's details: a picture's thumbnail, a file's badge, or the text itself, with who sent
     * it and when. A tap goes to it in the conversation.
     */
    export let message: ChatMessage | undefined;

    const empty = { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined };
    $: content = message?.content ?? readable(empty);
    $: text = message ? pinnedText(message, $content, $LL) : $LL.chat.details.pinnedLoading();
    $: isPicture = message?.type === "image" || message?.type === "video";
    $: isFile = message?.type === "file" || message?.type === "audio";
    $: fileName = message?.sharedFile?.name ?? "";
    $: kind = fileKindOf(fileName);
    $: badge = kind ? badgeOfKind(kind, fileName) : { color: "#757575", label: "FILE", kindName: "File" };
    $: by = message
        ? $LL.chat.details.sentBy({
              name: sharedSender(message, $LL.chat.details.you()),
              when: sentLabel(message.date, $locale),
          })
        : "";
</script>

<button type="button" class="u-menu-row !m-0" on:click data-testid="pinnedRow">
    {#if isPicture && $content.url && message?.type === "image"}
        <img class="h-9 w-9 shrink-0 rounded-md object-cover" src={$content.url} alt="" draggable="false" />
    {:else if isPicture}
        <span class="h-9 w-9 shrink-0 rounded-md bg-white/10" aria-hidden="true" />
    {:else if isFile}
        <span
            class="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[9px] font-bold tracking-wide text-white"
            style="background: {badge.color};"
            aria-hidden="true">{badge.label}</span
        >
    {:else}
        <span class="h-9 w-[3px] shrink-0 rounded-full bg-white/40" aria-hidden="true" />
    {/if}
    <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm text-white/90">{text}</span>
        {#if by}
            <span class="truncate text-[11px] font-normal text-white/45">{by}</span>
        {/if}
    </span>
</button>
