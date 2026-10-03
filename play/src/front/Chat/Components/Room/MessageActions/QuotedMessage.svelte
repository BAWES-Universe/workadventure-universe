<script lang="ts">
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import LL from "../../../../../i18n/i18n-svelte";
    import { summarizeForReply } from "./messageActions";
    import { IconFile } from "@wa-icons";

    /** The quote at the top of a reply: who wrote the original and what it was, in one or two lines. */
    export let message: ChatMessage;
    export let onJump: () => void;

    const content = message.content;
    const isDeleted = message.isDeleted;

    $: summary = summarizeForReply(message.type, $content);
    $: name = message.isMyMessage ? $LL.chat.messageActions.you() : message.sender?.username ?? "";
    $: description = $isDeleted
        ? $LL.chat.messageDeleted()
        : summary.kind === "text"
        ? summary.text
        : summary.kind === "photos"
        ? summary.caption ??
          (summary.count > 1
              ? $LL.chat.messageActions.photos({ count: summary.count })
              : $LL.chat.messageActions.photo())
        : summary.kind === "files"
        ? summary.caption ??
          (summary.count > 1 ? $LL.chat.messageActions.files({ count: summary.count }) : summary.name)
        : summary.caption ??
          (summary.kind === "video" ? $LL.chat.messageActions.video() : $LL.chat.messageActions.audio());

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onJump();
        }
    }
</script>

<div
    class="quote"
    role="button"
    tabindex="0"
    title={$LL.chat.messageActions.jumpToOriginal()}
    on:click|stopPropagation={onJump}
    on:keydown={onKeyDown}
    data-testid="quotedMessage"
>
    {#if !$isDeleted && summary.kind === "photos" && summary.thumbnail}
        <img class="thumb" src={summary.thumbnail} alt="" draggable="false" />
    {:else if !$isDeleted && summary.kind === "files"}
        <span class="thumb file" aria-hidden="true"><IconFile font-size={14} /></span>
    {/if}
    <span class="text">
        <span class="who">{name}</span>
        <span class="what">{description}</span>
    </span>
</div>

<style lang="scss">
    .quote {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 4px 4px 0;
        padding: 5px 8px;
        border-left: 2px solid rgb(255 255 255 / 0.55);
        border-radius: 6px;
        background: rgb(0 0 0 / 0.18);
        cursor: pointer;
        min-width: 0;
    }

    .quote:hover,
    .quote:focus-visible {
        background: rgb(0 0 0 / 0.28);
        outline: none;
    }

    .thumb {
        width: 32px;
        height: 32px;
        flex: none;
        border-radius: 5px;
        object-fit: cover;
    }

    .thumb.file {
        display: grid;
        place-items: center;
        background: rgb(255 255 255 / 0.1);
    }

    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
    }

    .who {
        font-size: 11px;
        font-weight: 700;
    }

    .what {
        font-size: 12px;
        opacity: 0.8;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        overflow-wrap: anywhere;
    }
</style>
